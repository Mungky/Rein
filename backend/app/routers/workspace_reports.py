"""Project health, notifications, reporting and paginated task search."""
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, func, select
from sqlalchemy.orm import aliased

from app.routers.workspace import _require_project_access
from app.routers.workspace_board import DB, Reader, Manager
from app.routers.workspace_project import require_suite, UpdateIn, _tasks, _row
from app.services import workspace_project as rules
from db.models.profile import Profile
from db.models.workspace import WorkspaceTask, WorkspacePhase, TaskStatus
from db.models.workspace_project import (WorkspaceTaskPlan, WorkspaceTaskDependency,
    WorkspaceTaskAssignee, WorkspaceTaskTag, WorkspaceEvent, WorkspaceProjectUpdate,
    WorkspaceNotification, WorkspaceTimeEntry, WorkspaceMilestone)

router = APIRouter(dependencies=[Depends(require_suite)])


@router.get("/projects/{project_id}/updates")
async def get_updates(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    rows = (await db.execute(select(WorkspaceProjectUpdate, Profile.full_name)
        .outerjoin(Profile, WorkspaceProjectUpdate.author_id == Profile.id)
        .where(WorkspaceProjectUpdate.project_id == project_id).order_by(WorkspaceProjectUpdate.created_at.desc()).limit(100))).all()
    return [{**_row(row, "id health summary external created_at"), "author_name": name} for row, name in rows]


@router.post("/projects/{project_id}/updates", status_code=201)
async def add_update(project_id: uuid.UUID, body: UpdateIn, db: DB, profile: Manager):
    project = await _require_project_access(db, profile, project_id)
    if not body.summary.strip():
        raise HTTPException(422, "Ringkasan wajib diisi")
    update = WorkspaceProjectUpdate(project_id=project_id, author_id=profile.id, health=body.health,
        summary=body.summary.strip(), external=body.external)
    db.add(update)
    tasks = await _tasks(db, project_id)
    recipients = set((await db.scalars(select(WorkspaceTaskAssignee.profile_id).where(WorkspaceTaskAssignee.task_id.in_([t.id for t in tasks])))).all())
    recipients |= {t.assigned_to for t in tasks} | {project.manager_id}
    await rules.record_event(db, project_id, profile.id, "Status proyek diperbarui", payload={"name": project.name}, recipients=recipients)
    await db.flush()
    return _row(update, "id health summary external created_at")


@router.get("/projects/{project_id}/notifications")
async def get_notifications(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    rows = (await db.scalars(select(WorkspaceNotification).where(WorkspaceNotification.project_id == project_id,
        WorkspaceNotification.profile_id == profile.id).order_by(WorkspaceNotification.created_at.desc()).limit(100))).all()
    return [_row(row, "id message read_at created_at") for row in rows]


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: uuid.UUID, db: DB, profile: Reader):
    notification = await db.get(WorkspaceNotification, notification_id)
    if not notification or notification.profile_id != profile.id:
        raise HTTPException(404, "Notifikasi tidak ditemukan")
    await _require_project_access(db, profile, notification.project_id)
    notification.read_at = notification.read_at or datetime.now(timezone.utc)
    return {"read": True}


@router.get("/projects/{project_id}/task-search")
async def search_tasks(project_id: uuid.UUID, db: DB, profile: Reader, q: str = Query(default="", max_length=200),
        status: Literal["todo", "in_progress", "pending_review", "done", "overdue"] | None = None,
        assignee_id: uuid.UUID | None = None, tag_id: uuid.UUID | None = None,
        milestone_id: uuid.UUID | None = None, priority: int | None = Query(default=None, ge=0, le=3),
        blocked: bool | None = None, overdue: bool | None = None,
        offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200)):
    await _require_project_access(db, profile, project_id)
    stmt = select(WorkspaceTask).join(WorkspacePhase).outerjoin(WorkspaceTaskPlan, WorkspaceTaskPlan.task_id == WorkspaceTask.id)
    filters = [WorkspacePhase.project_id == project_id]
    if q.strip():
        filters.append(WorkspaceTask.name.ilike("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", escape="\\"))
    if status:
        filters.append(WorkspaceTask.status == TaskStatus(status))
    if assignee_id:
        filters.append(rules.assignment_filter(assignee_id))
    if tag_id:
        filters.append(exists(select(WorkspaceTaskTag.task_id).where(WorkspaceTaskTag.task_id == WorkspaceTask.id, WorkspaceTaskTag.tag_id == tag_id)))
    if milestone_id:
        filters.append(WorkspaceTaskPlan.milestone_id == milestone_id)
    if priority is not None:
        filters.append(func.coalesce(WorkspaceTaskPlan.priority, 0) == priority)
    if blocked is not None:
        predecessor = aliased(WorkspaceTask)
        condition = exists(select(WorkspaceTaskDependency.task_id).join(predecessor,
            WorkspaceTaskDependency.predecessor_id == predecessor.id).where(WorkspaceTaskDependency.task_id == WorkspaceTask.id,
            predecessor.status.notin_([TaskStatus.done, TaskStatus.cancelled])))
        condition = condition & WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled])
        filters.append(condition if blocked else ~condition)
    if overdue is not None:
        condition = (WorkspaceTask.deadline < rules.local_today()) & (WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]))
        filters.append(condition if overdue else (WorkspaceTask.deadline.is_(None) | ~condition))
    stmt = stmt.where(*filters)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    tasks = (await db.scalars(stmt.order_by(func.coalesce(WorkspaceTaskPlan.priority, 0).desc(),
        WorkspaceTask.deadline.asc().nullslast(), WorkspaceTask.id).offset(offset).limit(limit))).all()
    return {"total": total, "offset": offset, "limit": limit,
        "items": [{**_row(t, "id name phase_id deadline"), "status": t.status.value} for t in tasks]}


@router.get("/projects/{project_id}/report")
async def project_report(project_id: uuid.UUID, db: DB, profile: Reader, days: int = Query(default=30, ge=1, le=90)):
    await _require_project_access(db, profile, project_id)
    tasks = await _tasks(db, project_id)
    metadata = await rules.planning_map(db, project_id)
    ids = [t.id for t in tasks]
    entries = (await db.execute(select(WorkspaceTimeEntry.profile_id, func.sum(WorkspaceTimeEntry.minutes))
        .where(WorkspaceTimeEntry.task_id.in_(ids)).group_by(WorkspaceTimeEntry.profile_id))).all()
    logged = dict(entries)
    names = {p.id: p.full_name for p in (await db.scalars(select(Profile).where(Profile.id.in_(logged)))).all()}
    people = {}
    for task in tasks:
        for person in metadata[task.id]["assignees"]:
            item = people.setdefault(person["id"], {"id": person["id"], "name": person["name"], "tasks": 0, "done": 0, "minutes": int(logged.get(uuid.UUID(person["id"]), 0))})
            item["tasks"] += 1
            item["done"] += task.status == TaskStatus.done
    for person_id, minutes in logged.items():
        people.setdefault(str(person_id), {"id": str(person_id), "name": names.get(person_id, "Pengguna"), "tasks": 0, "done": 0, "minutes": int(minutes)})
    milestone_rows = (await db.scalars(select(WorkspaceMilestone).where(WorkspaceMilestone.project_id == project_id))).all()
    milestones = []
    for milestone in milestone_rows:
        members = [t for t in tasks if metadata[t.id]["milestone_id"] == str(milestone.id)]
        milestones.append({**_row(milestone, "id name deadline reached_at"), "tasks": len(members), "done": sum(t.status == TaskStatus.done for t in members)})
    events = (await db.scalars(select(WorkspaceEvent).where(WorkspaceEvent.project_id == project_id,
        WorkspaceEvent.action == "WO disetujui").order_by(WorkspaceEvent.created_at))).all()
    closed_dates = {event.task_id: event.created_at.astimezone(rules.ZoneInfo("Asia/Jakarta")).date() for event in events}
    for task in tasks:
        if task.status == TaskStatus.done and task.reviewed_at:
            closed_dates[task.id] = task.reviewed_at.astimezone(rules.ZoneInfo("Asia/Jakarta")).date()
    today = rules.local_today()
    burndown = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        count = sum(t.created_at.astimezone(rules.ZoneInfo("Asia/Jakarta")).date() <= day and
            not (t.id in closed_dates and closed_dates[t.id] <= day) for t in tasks)
        if day == today:
            count = sum(t.status not in {TaskStatus.done, TaskStatus.cancelled} for t in tasks)
        burndown.append({"date": str(day), "remaining": count})
    done = sum(t.status == TaskStatus.done for t in tasks)
    return {"total": len(tasks), "done": done, "progress": round(done * 100 / len(tasks), 1) if tasks else 0,
        "overdue": sum(meta["overdue"] for meta in metadata.values()), "blocked": sum(meta["blocked"] for meta in metadata.values()),
        "estimated_minutes": sum(meta["estimated_minutes"] for meta in metadata.values()), "logged_minutes": sum(logged.values()),
        "status_counts": dict(Counter(t.status.value for t in tasks)), "assignees": list(people.values()),
        "burndown": burndown, "milestones": milestones,
        "history_complete": all(t.status != TaskStatus.done or t.id in closed_dates for t in tasks)}
