"""Shared planning rules used by every Workspace execution path."""
import calendar
from collections import defaultdict, deque
from datetime import date, datetime, timedelta
import os
import uuid
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import exists, or_, select

from db.models.workspace import WorkspacePhase, WorkspaceProject, WorkspaceTask, TaskStatus
from db.models.profile import Profile
from db.models.workspace_project import (
    WorkspaceTaskPlan, WorkspaceTaskAssignee, WorkspaceTaskDependency,
    WorkspaceTaskTag, WorkspaceTag, WorkspaceEvent, WorkspaceNotification,
)


def enabled():
    return os.getenv("WORKSPACE_PROJECT_SUITE_ENABLED") == "1"


def local_today():
    return datetime.now(ZoneInfo("Asia/Jakarta")).date()


def validate_graph(edges):
    """Validate dependencies together with implicit parent→child completion edges."""
    graph, degree = defaultdict(set), defaultdict(int)
    for source, target in edges:
        degree[source] += 0
        if target not in graph[source]:
            graph[source].add(target)
            degree[target] += 1
    ready = deque(node for node in degree if degree[node] == 0)
    visited = 0
    while ready:
        node = ready.popleft()
        visited += 1
        for target in graph[node]:
            degree[target] -= 1
            if degree[target] == 0:
                ready.append(target)
    if visited != len(degree):
        raise HTTPException(409, "Hubungan tugas membentuk siklus, termasuk hubungan induk/subtugas.")


def next_occurrence(day: date, unit: str, interval: int, anchor_day: int):
    if unit == "daily":
        return day + timedelta(days=interval)
    if unit == "weekly":
        return day + timedelta(weeks=interval)
    month = day.year * 12 + day.month - 1 + interval
    year, zero_month = divmod(month, 12)
    month = zero_month + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def assignment_filter(profile_id):
    primary = WorkspaceTask.assigned_to == profile_id
    if not enabled():
        return primary
    return or_(primary, exists(select(WorkspaceTaskAssignee.task_id).where(
        WorkspaceTaskAssignee.task_id == WorkspaceTask.id, WorkspaceTaskAssignee.profile_id == profile_id)))


async def is_assignee(db, task, profile):
    if task.assigned_to == profile.id:
        return True
    if not enabled():
        return False
    return await db.get(WorkspaceTaskAssignee, (task.id, profile.id)) is not None


async def require_ready(db, task, *, completing=False):
    if not enabled():
        return
    from app.services.workspace_coordination import enabled as simple_workflow, require_operational_ready
    if simple_workflow():
        await require_operational_ready(db, task, completing=completing)
        return
    blocker = await db.scalar(select(WorkspaceTask.id).join(WorkspaceTaskDependency,
        WorkspaceTaskDependency.predecessor_id == WorkspaceTask.id)
        .where(WorkspaceTaskDependency.task_id == task.id, WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled])).limit(1))
    if blocker:
        raise HTTPException(409, "Selesaikan tugas prasyarat terlebih dahulu.")
    if completing:
        child = await db.scalar(select(WorkspaceTask.id).join(WorkspaceTaskPlan,
            WorkspaceTaskPlan.task_id == WorkspaceTask.id)
            .where(WorkspaceTaskPlan.parent_id == task.id, WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled])).limit(1))
        if child:
            raise HTTPException(409, "Semua subtugas harus selesai sebelum WO induk disetujui.")


async def task_project_id(db, task):
    return await db.scalar(select(WorkspacePhase.project_id).where(WorkspacePhase.id == task.phase_id))


async def task_assignees(db, task):
    ids = set((await db.scalars(select(WorkspaceTaskAssignee.profile_id)
        .where(WorkspaceTaskAssignee.task_id == task.id))).all())
    if task.assigned_to:
        ids.add(task.assigned_to)
    return ids


async def record_event(db, project_id, actor_id, action, task_id=None, payload=None, recipients=()):
    if not enabled():
        return
    db.add(WorkspaceEvent(project_id=project_id, actor_id=actor_id, action=action,
        task_id=task_id, payload=payload or {}))
    for recipient in set(recipients) - {actor_id, None}:
        db.add(WorkspaceNotification(project_id=project_id, task_id=task_id, profile_id=recipient,
            message=f"{action}: {(payload or {}).get('name', 'Proyek')}"[:300]))


async def task_event(db, task, profile, action):
    if not enabled():
        return
    project_id = await task_project_id(db, task)
    project = await db.get(WorkspaceProject, project_id)
    recipients = await task_assignees(db, task)
    recipients.add(project.manager_id)
    await record_event(db, project_id, profile.id, action, task.id,
        {"name": task.name, "status": task.status.value}, recipients)


async def planning_map(db, project_id):
    """Bulk metadata for a board; no per-card queries."""
    if not enabled():
        return {}
    tasks = (await db.scalars(select(WorkspaceTask).join(WorkspacePhase)
        .where(WorkspacePhase.project_id == project_id))).all()
    ids = [t.id for t in tasks]
    if not ids:
        return {}
    plans = {p.task_id: p for p in (await db.scalars(select(WorkspaceTaskPlan).where(WorkspaceTaskPlan.task_id.in_(ids)))).all()}
    assigned = defaultdict(dict)
    assignments = (await db.execute(select(WorkspaceTaskAssignee.task_id, Profile.id, Profile.full_name, Profile.avatar_url, Profile.is_active)
        .join(Profile, WorkspaceTaskAssignee.profile_id == Profile.id).where(WorkspaceTaskAssignee.task_id.in_(ids)))).all()
    for task_id, profile_id, name, avatar, is_active in assignments:
        assigned[task_id][str(profile_id)] = {"name": name, "avatar_url": avatar, "inactive": not is_active}
    primary_ids = [t.assigned_to for t in tasks if t.assigned_to]
    primary_names = {p.id: {"name": p.full_name, "avatar_url": p.avatar_url, "inactive": not p.is_active} for p in (await db.scalars(select(Profile).where(Profile.id.in_(primary_ids)))).all()}
    tags, dependencies = defaultdict(list), defaultdict(list)
    for task_id, tag_id, name in (await db.execute(select(WorkspaceTaskTag.task_id, WorkspaceTag.id, WorkspaceTag.name)
            .join(WorkspaceTag).where(WorkspaceTaskTag.task_id.in_(ids)))).all():
        tags[task_id].append({"id": str(tag_id), "name": name})
    states = {t.id: t.status for t in tasks}
    for task_id, predecessor_id in (await db.execute(select(WorkspaceTaskDependency.task_id, WorkspaceTaskDependency.predecessor_id)
            .where(WorkspaceTaskDependency.task_id.in_(ids)))).all():
        dependencies[task_id].append(predecessor_id)
    result = {}
    for task in tasks:
        if task.assigned_to:
            assigned[task.id][str(task.assigned_to)] = primary_names.get(task.assigned_to, {"name": "Pengguna", "avatar_url": None, "inactive": True})
        plan = plans.get(task.id)
        result[task.id] = {
            "parent_id": str(plan.parent_id) if plan and plan.parent_id else None,
            "milestone_id": str(plan.milestone_id) if plan and plan.milestone_id else None,
            "priority": plan.priority if plan else 0,
            "estimated_minutes": plan.estimated_minutes if plan else 0,
            "portal_visible": plan.portal_visible if plan else False,
            "assignees": [{"id": key, **person} for key, person in assigned[task.id].items()],
            "tags": tags[task.id], "dependency_ids": [str(key) for key in dependencies[task.id]],
            "blocked": task.status not in {TaskStatus.done, TaskStatus.cancelled} and any(states.get(key) not in {TaskStatus.done, TaskStatus.cancelled} for key in dependencies[task.id]),
            "overdue": task.status not in {TaskStatus.done, TaskStatus.cancelled} and bool(task.deadline and task.deadline < local_today()),
        }
    return result
