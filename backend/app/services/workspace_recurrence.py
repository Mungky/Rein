"""Idempotent recurring WO generation, sharing the project's write lock."""
import asyncio
import logging
import uuid

from sqlalchemy import select

from app.services import workspace_project as rules
from db.models.workspace import WorkspaceTask, WorkspacePhase, WorkspaceProject, TaskStatus
from db.models.workspace_project import (WorkspaceTaskPlan, WorkspaceTaskAssignee, WorkspaceTaskDependency,
    WorkspaceTaskTag, WorkspaceMilestone, WorkspaceRecurrence, WorkspaceRecurrenceRun)

logger = logging.getLogger(__name__)


async def generate_due(db, project_id, *, actor_id=None, today=None):
    # Import at call time avoids a router/service import cycle.
    from app.routers.workspace_board import _lock_board, _place_unassigned
    today = today or rules.local_today()
    board = await _lock_board(db, project_id, None)
    schedules = (await db.scalars(select(WorkspaceRecurrence).join(WorkspaceTask,
        WorkspaceRecurrence.task_id == WorkspaceTask.id).join(WorkspacePhase)
        .where(WorkspacePhase.project_id == project_id, WorkspaceRecurrence.active.is_(True), WorkspaceRecurrence.next_date <= today)
        .order_by(WorkspaceRecurrence.next_date, WorkspaceRecurrence.id).with_for_update(of=WorkspaceRecurrence))).all()
    count = 0
    project = await db.get(WorkspaceProject, project_id)
    for schedule in schedules:
        original = await db.get(WorkspaceTask, schedule.task_id)
        if original.status == TaskStatus.cancelled:
            schedule.active = False
            continue
        plan = await db.get(WorkspaceTaskPlan, original.id)
        while schedule.next_date <= today and schedule.active and count < 25:
            day = schedule.next_date
            if schedule.end_date and day > schedule.end_date:
                schedule.active = False
                break
            if not await db.get(WorkspaceRecurrenceRun, (schedule.id, day)):
                task = WorkspaceTask(phase_id=original.phase_id, name=f"{original.name[:235]} · {day}",
                    description=original.description, location=original.location, estimated_days=original.estimated_days,
                    assigned_to=original.assigned_to, deadline=day, status=TaskStatus.todo, order=original.order)
                db.add(task)
                await db.flush()
                milestone_id = plan.milestone_id if plan else None
                if milestone_id:
                    milestone = await db.get(WorkspaceMilestone, milestone_id)
                    if milestone and milestone.reached_at:
                        milestone_id = None
                db.add(WorkspaceTaskPlan(task_id=task.id, priority=plan.priority if plan else 0,
                    estimated_minutes=plan.estimated_minutes if plan else 0, milestone_id=milestone_id, portal_visible=False))
                assignees = await rules.task_assignees(db, original)
                db.add_all([WorkspaceTaskAssignee(task_id=task.id, profile_id=key) for key in assignees])
                tags = (await db.scalars(select(WorkspaceTaskTag.tag_id).where(WorkspaceTaskTag.task_id == original.id))).all()
                db.add_all([WorkspaceTaskTag(task_id=task.id, tag_id=key) for key in tags])
                dependencies = (await db.scalars(select(WorkspaceTaskDependency.predecessor_id).where(WorkspaceTaskDependency.task_id == original.id))).all()
                db.add_all([WorkspaceTaskDependency(task_id=task.id, predecessor_id=key) for key in dependencies])
                db.add(WorkspaceRecurrenceRun(recurrence_id=schedule.id, scheduled_for=day, generated_task_id=task.id))
                await rules.record_event(db, project_id, actor_id, "WO berulang dibuat", task.id,
                    {"name": task.name, "status": "todo", "scheduled_for": str(day)}, assignees | {project.manager_id})
                count += 1
            schedule.next_date = rules.next_occurrence(day, schedule.unit, schedule.interval, schedule.anchor_day)
            if schedule.end_date and schedule.next_date > schedule.end_date:
                schedule.active = False
    if schedules:
        board.version += 1
        await _place_unassigned(db, project_id)
        await db.flush()
    return count


async def recurrence_loop(sessions):
    while True:
        try:
            async with sessions() as db:
                project_ids = (await db.scalars(select(WorkspacePhase.project_id)
                    .join(WorkspaceTask, WorkspaceTask.phase_id == WorkspacePhase.id)
                    .join(WorkspaceRecurrence, WorkspaceRecurrence.task_id == WorkspaceTask.id)
                    .where(WorkspaceRecurrence.active.is_(True), WorkspaceRecurrence.next_date <= rules.local_today())
                    .distinct().limit(25))).all()
            for project_id in project_ids:
                async with sessions.begin() as db:
                    await generate_due(db, project_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Project recurrence processing failed; transaction rolled back")
        await asyncio.sleep(60)
