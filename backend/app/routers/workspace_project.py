"""Project planning and collaboration APIs. All internal reads are project-scoped."""
import hashlib
import os
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Annotated
from urllib.parse import quote

from app.services import workspace_archive as archive
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select

from app.routers.workspace import _require_project_access, _require_task_access, _can
from app.dependencies import require_any_permission
from app.routers.workspace_board import DB, Reader, Manager, BoardVersion, _lock_board, require_stages
from app.services import workspace_project as rules
from db.models.profile import Profile
Planner = Annotated[Profile, Depends(require_any_permission("workspace:manage", "workspace:create_wo"))]
from db.models.workspace import WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskStatus
from db.models.workspace_board import WorkspaceBoard
from app.routers.workspace_board import _place_unassigned
from db.models.workspace_project import (
    WorkspaceMilestone, WorkspaceTaskPlan, WorkspaceTaskAssignee, WorkspaceTaskDependency,
    WorkspaceTag, WorkspaceTaskTag, WorkspaceComment, WorkspaceAttachment, WorkspaceTimeEntry,
    WorkspaceEvent, WorkspaceNotification, WorkspaceProjectUpdate, WorkspaceRecurrence,
    WorkspacePortalShare, WorkspaceSalesOrder,
)


def require_suite():
    require_stages()
    if not rules.enabled():
        raise HTTPException(503, "Fitur Project lanjutan belum diaktifkan; migrasi diperlukan.")


router = APIRouter(dependencies=[Depends(require_suite)])
public_router = APIRouter(dependencies=[Depends(require_suite)])


class CleanName(BaseModel):
    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def trimmed(cls, value):
        if not value.strip():
            raise ValueError("Nama wajib diisi")
        return value.strip()


class TaskPlanIn(BoardVersion):
    parent_id: uuid.UUID | None = None
    milestone_id: uuid.UUID | None = None
    priority: int = Field(default=0, ge=0, le=3)
    estimated_minutes: int = Field(default=0, ge=0, le=1000000)
    portal_visible: bool = False
    assignee_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    dependency_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)


class MilestoneIn(CleanName, BoardVersion):
    deadline: date | None = None
    reached: bool = False


class TagIn(CleanName, BoardVersion):
    name: str = Field(min_length=1, max_length=60)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    external: bool = False
    mention_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class TimeIn(BaseModel):
    request_id: uuid.UUID
    work_date: date
    minutes: int = Field(ge=1, le=1440)
    description: str = Field(min_length=1, max_length=1000)


class UpdateIn(BaseModel):
    health: Literal["on_track", "at_risk", "off_track", "on_hold", "done"]
    summary: str = Field(min_length=1, max_length=5000)
    external: bool = False


class RecurrenceIn(BoardVersion):
    unit: Literal["daily", "weekly", "monthly"] = "weekly"
    interval: int = Field(default=1, ge=1, le=365)
    next_date: date
    end_date: date | None = None
    active: bool = True


class ShareIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    expires_in_days: int = Field(default=7, ge=1, le=90)


class SubtaskIn(CleanName, BoardVersion):
    pass


async def _task(db, profile, task_id, lock=False):
    stmt = select(WorkspaceTask).where(WorkspaceTask.id == task_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    task = await db.scalar(stmt)
    if not task:
        raise HTTPException(404, "WO tidak ditemukan")
    await _require_task_access(db, profile, task)
    return task


async def _tasks(db, project_id):
    return (await db.scalars(select(WorkspaceTask).join(WorkspacePhase)
        .where(WorkspacePhase.project_id == project_id).order_by(WorkspaceTask.order, WorkspaceTask.id))).all()


def _row(row, keys):
    result = {}
    for key in keys.split():
        value = getattr(row, key)
        result[key] = str(value) if isinstance(value, uuid.UUID) else value
    return result


async def _touch(db, board, profile, project_id, action, task_id=None, payload=None):
    board.version += 1
    await rules.record_event(db, project_id, profile.id, action, task_id, payload)
    await db.flush()


@router.get("/projects/{project_id}/planning")
async def project_planning(project_id: uuid.UUID, db: DB, profile: Reader):
    project = await _require_project_access(db, profile, project_id)
    board = await db.get(WorkspaceBoard, project_id)
    tasks = await _tasks(db, project_id)
    milestones = (await db.scalars(select(WorkspaceMilestone).where(WorkspaceMilestone.project_id == project_id)
        .order_by(WorkspaceMilestone.deadline.asc().nullslast(), WorkspaceMilestone.name))).all()
    tags = (await db.scalars(select(WorkspaceTag).where(WorkspaceTag.project_id == project_id).order_by(WorkspaceTag.name))).all()
    people = (await db.scalars(select(Profile).where(Profile.is_active.is_(True)).order_by(Profile.full_name))).all()
    phases = (await db.scalars(select(WorkspacePhase).where(WorkspacePhase.project_id == project_id).order_by(WorkspacePhase.order))).all()
    members = set((await db.scalars(select(WorkspaceTaskAssignee.profile_id).where(WorkspaceTaskAssignee.task_id.in_([t.id for t in tasks])))).all())
    members |= {t.assigned_to for t in tasks} | {project.manager_id}
    return {"version": board.version if board else 0, "recurrence_worker_enabled": os.getenv("WORKSPACE_RECURRENCE_WORKER_ENABLED") == "1", "tasks": [{"id": str(t.id), "name": t.name, "status": t.status.value} for t in tasks],
        "people": [{"id": str(p.id), "name": p.full_name} for p in people], "member_ids": [str(key) for key in members if key],
        "phases": [{"id": str(p.id), "name": p.name} for p in phases],
        "milestones": [_row(m, "id name deadline reached_at") for m in milestones], "tags": [_row(t, "id name") for t in tags]}


@router.put("/tasks/{task_id}/planning")
async def save_task_plan(task_id: uuid.UUID, body: TaskPlanIn, db: DB, profile: Planner):
    task = await _task(db, profile, task_id)
    project_id = await rules.task_project_id(db, task)
    board = await _lock_board(db, project_id, body.expected_version)
    task = await _task(db, profile, task_id, lock=True)
    previous_assignees = await rules.task_assignees(db, task)
    tasks = {t.id: t for t in await _tasks(db, project_id)}
    linked = set(body.dependency_ids) | ({body.parent_id} if body.parent_id else set())
    if not linked.issubset(tasks) or task.id in linked:
        raise HTTPException(422, "Tugas induk dan prasyarat harus berbeda dan berada di proyek yang sama")
    if task.status == TaskStatus.done and any(tasks[key].status != TaskStatus.done for key in body.dependency_ids):
        raise HTTPException(409, "WO selesai tidak boleh diberi prasyarat yang belum selesai")
    if body.parent_id and tasks[body.parent_id].status == TaskStatus.done and task.status != TaskStatus.done:
        raise HTTPException(409, "Tidak dapat menambahkan subtugas terbuka pada WO induk yang sudah selesai")
    if body.milestone_id:
        milestone = await db.get(WorkspaceMilestone, body.milestone_id)
        if not milestone or milestone.project_id != project_id:
            raise HTTPException(422, "Milestone bukan milik proyek ini")
        if milestone.reached_at and task.status != TaskStatus.done:
            raise HTTPException(409, "Milestone yang sudah tercapai tidak boleh mendapat tugas terbuka")
    assignees = list(dict.fromkeys(body.assignee_ids))
    active_ids = set((await db.scalars(select(Profile.id).where(Profile.id.in_(assignees), Profile.is_active.is_(True)))).all())
    if set(assignees) != active_ids:
        raise HTTPException(422, "Penanggung jawab harus pengguna aktif")
    tag_ids = set(body.tag_ids)
    owned_tags = set((await db.scalars(select(WorkspaceTag.id).where(WorkspaceTag.id.in_(tag_ids), WorkspaceTag.project_id == project_id))).all())
    if tag_ids != owned_tags:
        raise HTTPException(422, "Tag bukan milik proyek ini")
    dependencies = (await db.execute(select(WorkspaceTaskDependency.task_id, WorkspaceTaskDependency.predecessor_id)
        .where(WorkspaceTaskDependency.task_id.in_(tasks)))).all()
    parents = (await db.execute(select(WorkspaceTaskPlan.parent_id, WorkspaceTaskPlan.task_id)
        .where(WorkspaceTaskPlan.task_id.in_(tasks), WorkspaceTaskPlan.parent_id.is_not(None)))).all()
    edges = [(a, b) for a, b in dependencies if a != task.id] + [(a, b) for a, b in parents if b != task.id]
    edges += [(task.id, key) for key in set(body.dependency_ids)]
    if body.parent_id:
        edges.append((body.parent_id, task.id))
    rules.validate_graph(edges)
    plan = await db.get(WorkspaceTaskPlan, task.id)
    if not plan:
        plan = WorkspaceTaskPlan(task_id=task.id)
        db.add(plan)
    for key in ("parent_id", "milestone_id", "priority", "estimated_minutes", "portal_visible"):
        setattr(plan, key, getattr(body, key))
    for model in (WorkspaceTaskAssignee, WorkspaceTaskDependency, WorkspaceTaskTag):
        await db.execute(delete(model).where(model.task_id == task.id))
    db.add_all([WorkspaceTaskAssignee(task_id=task.id, profile_id=key) for key in assignees])
    db.add_all([WorkspaceTaskDependency(task_id=task.id, predecessor_id=key) for key in set(body.dependency_ids)])
    db.add_all([WorkspaceTaskTag(task_id=task.id, tag_id=key) for key in tag_ids])
    task.assigned_to = assignees[0] if assignees else None
    await _touch(db, board, profile, project_id, "Perencanaan WO diubah", task.id, {"name": task.name})
    if previous_assignees != set(assignees):
        project = await db.get(WorkspaceProject, project_id)
        await rules.record_event(db, project_id, profile.id, "Penanggung jawab WO diperbarui", task.id,
            {"name": task.name}, set(assignees) | {project.manager_id})
    return {"version": board.version}


@router.post("/tasks/{task_id}/subtasks", status_code=201)
async def create_subtask(task_id: uuid.UUID, body: SubtaskIn, db: DB, profile: Planner):
    parent = await _task(db, profile, task_id)
    project_id = await rules.task_project_id(db, parent)
    board = await _lock_board(db, project_id, body.expected_version)
    parent = await _task(db, profile, task_id, lock=True)
    if parent.status == TaskStatus.done:
        raise HTTPException(409, "Tidak dapat menambahkan subtugas pada WO yang sudah selesai")
    child = WorkspaceTask(phase_id=parent.phase_id, name=body.name, assigned_to=parent.assigned_to,
        status=TaskStatus.todo, order=parent.order + 1)
    db.add(child)
    await db.flush()
    db.add(WorkspaceTaskPlan(task_id=child.id, parent_id=parent.id))
    db.add_all([WorkspaceTaskAssignee(task_id=child.id, profile_id=key) for key in await rules.task_assignees(db, parent)])
    await _place_unassigned(db, project_id)
    await _touch(db, board, profile, project_id, "Subtugas dibuat", child.id, {"name": child.name})
    return {"id": str(child.id), "version": board.version}


@router.post("/projects/{project_id}/milestones", status_code=201)
async def create_milestone(project_id: uuid.UUID, body: MilestoneIn, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    if body.reached:
        raise HTTPException(422, "Buat milestone terlebih dahulu sebelum menandainya tercapai")
    milestone = WorkspaceMilestone(project_id=project_id, name=body.name, deadline=body.deadline)
    db.add(milestone)
    await _touch(db, board, profile, project_id, "Milestone dibuat", payload={"name": body.name})
    return _row(milestone, "id name deadline reached_at")


@router.put("/projects/{project_id}/milestones/{milestone_id}")
async def update_milestone(project_id: uuid.UUID, milestone_id: uuid.UUID, body: MilestoneIn, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    milestone = await db.get(WorkspaceMilestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone tidak ditemukan")
    if body.reached:
        open_task = await db.scalar(select(WorkspaceTask.id).join(WorkspaceTaskPlan, WorkspaceTaskPlan.task_id == WorkspaceTask.id)
            .where(WorkspaceTaskPlan.milestone_id == milestone.id, WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled])).limit(1))
        if open_task:
            raise HTTPException(409, "Masih ada WO milestone yang belum selesai")
    milestone.name, milestone.deadline = body.name, body.deadline
    milestone.reached_at = (milestone.reached_at or datetime.now(timezone.utc)) if body.reached else None
    await _touch(db, board, profile, project_id, "Milestone diubah", payload={"name": body.name})
    return _row(milestone, "id name deadline reached_at")


@router.delete("/projects/{project_id}/milestones/{milestone_id}")
async def delete_milestone(project_id: uuid.UUID, milestone_id: uuid.UUID, expected_version: int, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, expected_version)
    milestone = await db.get(WorkspaceMilestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone tidak ditemukan")
    if await db.scalar(select(WorkspaceTaskPlan.task_id).where(WorkspaceTaskPlan.milestone_id == milestone_id).limit(1)):
        raise HTTPException(409, "Lepaskan semua WO dari milestone sebelum menghapusnya")
    await db.delete(milestone)
    await _touch(db, board, profile, project_id, "Milestone dihapus")
    return {"version": board.version}


@router.post("/projects/{project_id}/tags", status_code=201)
async def create_tag(project_id: uuid.UUID, body: TagIn, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    if await db.scalar(select(WorkspaceTag.id).where(WorkspaceTag.project_id == project_id, func.lower(WorkspaceTag.name) == body.name.lower())):
        raise HTTPException(409, "Tag sudah ada")
    tag = WorkspaceTag(project_id=project_id, name=body.name)
    db.add(tag)
    await _touch(db, board, profile, project_id, "Tag dibuat", payload={"name": body.name})
    return _row(tag, "id name")


@router.get("/tasks/{task_id}/details")
async def task_details(task_id: uuid.UUID, db: DB, profile: Reader):
    task = await _task(db, profile, task_id)
    project_id = await rules.task_project_id(db, task)
    planning = await project_planning(project_id, db, profile)
    metadata = (await rules.planning_map(db, project_id))[task_id]
    comments = (await db.execute(select(WorkspaceComment, Profile.full_name).outerjoin(Profile, WorkspaceComment.author_id == Profile.id)
        .where(WorkspaceComment.task_id == task_id).order_by(WorkspaceComment.created_at.desc()).limit(100))).all()
    attachments = (await db.execute(select(WorkspaceAttachment.id, WorkspaceAttachment.name,
        WorkspaceAttachment.content_type, WorkspaceAttachment.external, WorkspaceAttachment.created_at,
        archive.attachment_size().label("bytes")).where(WorkspaceAttachment.task_id == task_id)
        .order_by(WorkspaceAttachment.created_at.desc()).limit(100))).mappings().all()
    entries = (await db.execute(select(WorkspaceTimeEntry, Profile.full_name).join(Profile, WorkspaceTimeEntry.profile_id == Profile.id)
        .where(WorkspaceTimeEntry.task_id == task_id).order_by(WorkspaceTimeEntry.work_date.desc(), WorkspaceTimeEntry.created_at.desc()).limit(100))).all()
    events = (await db.execute(select(WorkspaceEvent, Profile.full_name).outerjoin(Profile, WorkspaceEvent.actor_id == Profile.id)
        .where(WorkspaceEvent.task_id == task_id).order_by(WorkspaceEvent.created_at.desc()).limit(100))).all()
    recurrence = await db.scalar(select(WorkspaceRecurrence).where(WorkspaceRecurrence.task_id == task_id))
    subtasks = (await db.execute(select(WorkspaceTask.id, WorkspaceTask.name, WorkspaceTask.status)
        .join(WorkspaceTaskPlan, WorkspaceTaskPlan.task_id == WorkspaceTask.id).where(WorkspaceTaskPlan.parent_id == task_id))).all()
    return {"project_id": str(project_id), "planning": planning, "metadata": metadata,
        "comments": [{**_row(c, "id body external created_at author_id"), "author_name": name} for c, name in comments],
        "attachments": [dict(a) for a in attachments],
        "time_entries": [{**_row(e, "id profile_id work_date minutes description"), "name": name} for e, name in entries],
        "events": [{**_row(e, "id action payload created_at"), "actor_name": name} for e, name in events],
        "recurrence": _row(recurrence, "id unit interval next_date end_date active") if recurrence else None,
        "subtasks": [{"id": str(key), "name": name, "status": status.value} for key, name, status in subtasks]}


@router.post("/tasks/{task_id}/comments", status_code=201)
async def add_comment(task_id: uuid.UUID, body: CommentIn, db: DB, profile: Reader):
    task = await _task(db, profile, task_id)
    if not body.body.strip():
        raise HTTPException(422, "Komentar tidak boleh kosong")
    if body.external and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Hanya pengelola yang boleh membagikan komentar ke pelanggan")
    project_id = await rules.task_project_id(db, task)
    project = await db.get(WorkspaceProject, project_id)
    tasks = await _tasks(db, project_id)
    eligible = set((await db.scalars(select(WorkspaceTaskAssignee.profile_id).where(WorkspaceTaskAssignee.task_id.in_([t.id for t in tasks])))).all())
    eligible |= {t.assigned_to for t in tasks} | {project.manager_id}
    if not set(body.mention_ids).issubset(eligible):
        raise HTTPException(422, "Mention hanya boleh ditujukan kepada anggota proyek")
    comment = WorkspaceComment(task_id=task_id, author_id=profile.id, body=body.body.strip(), external=body.external)
    db.add(comment)
    recipients = await rules.task_assignees(db, task)
    recipients |= set(body.mention_ids) | {project.manager_id}
    await rules.record_event(db, project_id, profile.id, "Komentar ditambahkan", task_id, {"name": task.name}, recipients)
    await db.flush()
    return _row(comment, "id body external created_at")


async def _execute_allowed(db, profile, task):
    if not await rules.is_assignee(db, task, profile) and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Hanya penanggung jawab atau pengelola WO yang boleh melakukan tindakan ini")


@router.post("/tasks/{task_id}/attachments", status_code=201)
async def upload_attachment(task_id: uuid.UUID, db: DB, profile: Reader, file: UploadFile = File(...), external: bool = Form(False), archive_department: str | None = Form(None), request_id: uuid.UUID | None = Form(None)):
    task = await _task(db, profile, task_id)
    await _execute_allowed(db, profile, task)
    if external and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Hanya pengelola yang boleh membagikan lampiran ke pelanggan")
    content = await file.read(5 * 1024 * 1024 + 1)
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Ukuran lampiran harus 1 byte sampai 5 MB")
    types = archive.UPLOAD_MIMES
    if file.content_type not in types:
        raise HTTPException(415, "Lampiran harus PDF, PNG, JPEG, atau teks biasa")
    name = (file.filename or "attachment").replace("\\", "/").split("/")[-1]
    name = "".join(c for c in name if ord(c) >= 32 and ord(c) != 127)[:180] or "attachment"
    attachment = WorkspaceAttachment(id=request_id or uuid.uuid4(), task_id=task_id, uploaded_by=profile.id, name=name,
        content_type=file.content_type, data=content, sha256=hashlib.sha256(content).hexdigest(), external=external)
    db.add(attachment)
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Lampiran ditambahkan", task_id, {"name": name})
    await db.flush()
    if os.getenv("WORKSPACE_COORDINATION_ENABLED") == "1":
        from app.services.workspace_links import register_attachment
        await register_attachment(db, task, profile, attachment, len(content), department=archive_department)
    return _row(attachment, "id name content_type external created_at")


async def _download(db, attachment):
    return Response(await archive.attachment_content(db, attachment), media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(attachment.name, safe='')}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.get("/attachments/{attachment_id}")
async def download_attachment(attachment_id: uuid.UUID, db: DB, profile: Reader):
    attachment = await db.get(WorkspaceAttachment, attachment_id)
    if not attachment:
        raise HTTPException(404, "Lampiran tidak ditemukan")
    await _task(db, profile, attachment.task_id)
    return await _download(db, attachment)


@router.delete("/attachments/{attachment_id}")
async def delete_attachment(attachment_id: uuid.UUID, db: DB, profile: Reader):
    attachment = await db.get(WorkspaceAttachment, attachment_id)
    if not attachment:
        raise HTTPException(404, "Lampiran tidak ditemukan")
    task = await _task(db, profile, attachment.task_id)
    if attachment.uploaded_by != profile.id and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Tidak boleh menghapus lampiran pengguna lain")
    if os.getenv("WORKSPACE_COORDINATION_ENABLED") == "1":
        from db.models.workspace_coordination import WorkspaceDocument
        if await db.scalar(select(WorkspaceDocument.id).where(WorkspaceDocument.attachment_id == attachment_id)):
            raise HTTPException(409, "Lampiran ini menjadi dokumen proyek dan riwayatnya harus tetap tersimpan")
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Lampiran dihapus", task.id, {"name": attachment.name})
    await db.delete(attachment)
    return {"deleted": True}


async def _validate_time(db, profile_id, body, exclude_id=None):
    if body.work_date > rules.local_today() or body.work_date < date(2010, 1, 1):
        raise HTTPException(422, "Tanggal timesheet harus antara 2010 dan hari ini")
    if not body.description.strip():
        raise HTTPException(422, "Deskripsi pekerjaan wajib diisi")
    # NO KEY UPDATE serializes the daily budget without blocking foreign-key
    # KEY SHARE checks from concurrent WO events owned by the same person.
    await db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update(key_share=True))
    stmt = select(func.coalesce(func.sum(WorkspaceTimeEntry.minutes), 0)).where(
        WorkspaceTimeEntry.profile_id == profile_id, WorkspaceTimeEntry.work_date == body.work_date)
    if exclude_id:
        stmt = stmt.where(WorkspaceTimeEntry.id != exclude_id)
    if (await db.scalar(stmt)) + body.minutes > 1440:
        raise HTTPException(409, "Total waktu harian tidak boleh melebihi 24 jam")


@router.post("/tasks/{task_id}/time-entries", status_code=201)
async def log_time(task_id: uuid.UUID, body: TimeIn, db: DB, profile: Reader):
    task = await _task(db, profile, task_id)
    await _execute_allowed(db, profile, task)
    # A client retry with the same request ID must not double-count time.
    await db.scalar(select(Profile).where(Profile.id == profile.id).with_for_update(key_share=True))
    existing = await db.get(WorkspaceTimeEntry, body.request_id)
    if existing:
        if existing.task_id != task_id or existing.profile_id != profile.id:
            raise HTTPException(409, "ID pencatatan waktu sudah digunakan")
        if (existing.work_date != body.work_date or existing.minutes != body.minutes
                or existing.description != body.description.strip()):
            raise HTTPException(409, "Permintaan ini sudah tercatat. Gunakan Ubah untuk memperbaiki catatan waktu.")
        return _row(existing, "id work_date minutes description")
    await _validate_time(db, profile.id, body)
    entry = WorkspaceTimeEntry(id=body.request_id, task_id=task_id, profile_id=profile.id,
        work_date=body.work_date, minutes=body.minutes, description=body.description.strip())
    db.add(entry)
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Waktu dicatat", task_id,
        {"name": task.name, "minutes": body.minutes})
    await db.flush()
    return _row(entry, "id work_date minutes description")


@router.put("/time-entries/{entry_id}")
async def update_time(entry_id: uuid.UUID, body: TimeIn, db: DB, profile: Reader):
    entry = await db.get(WorkspaceTimeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Catatan waktu tidak ditemukan")
    task = await _task(db, profile, entry.task_id)
    if entry.profile_id != profile.id and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Tidak boleh mengubah waktu pengguna lain")
    await _validate_time(db, entry.profile_id, body, exclude_id=entry.id)
    entry = await db.scalar(select(WorkspaceTimeEntry).where(WorkspaceTimeEntry.id == entry_id)
        .with_for_update().execution_options(populate_existing=True))
    if not entry:
        raise HTTPException(409, "Catatan waktu sudah dihapus. Muat ulang sebelum melanjutkan.")
    entry.work_date, entry.minutes, entry.description = body.work_date, body.minutes, body.description.strip()
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Catatan waktu diubah", task.id, {"name": task.name})
    await db.flush()
    return _row(entry, "id work_date minutes description")


@router.delete("/time-entries/{entry_id}")
async def delete_time(entry_id: uuid.UUID, db: DB, profile: Reader):
    entry = await db.get(WorkspaceTimeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Catatan waktu tidak ditemukan")
    task = await _task(db, profile, entry.task_id)
    if entry.profile_id != profile.id and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Tidak boleh menghapus waktu pengguna lain")
    await db.scalar(select(Profile).where(Profile.id == entry.profile_id).with_for_update(key_share=True))
    entry = await db.scalar(select(WorkspaceTimeEntry).where(WorkspaceTimeEntry.id == entry_id)
        .with_for_update().execution_options(populate_existing=True))
    if not entry:
        return {"deleted": True}
    await db.delete(entry)
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Catatan waktu dihapus", task.id, {"name": task.name})
    return {"deleted": True}


@router.put("/tasks/{task_id}/recurrence")
async def save_recurrence(task_id: uuid.UUID, body: RecurrenceIn, db: DB, profile: Manager):
    task = await _task(db, profile, task_id)
    project_id = await rules.task_project_id(db, task)
    board = await _lock_board(db, project_id, body.expected_version)
    if body.next_date < rules.local_today() - timedelta(days=90) or body.next_date.year > rules.local_today().year + 10:
        raise HTTPException(422, "Tanggal berikutnya harus dalam rentang 90 hari lalu sampai 10 tahun mendatang")
    if body.end_date and (body.end_date < body.next_date or body.end_date.year > rules.local_today().year + 10):
        raise HTTPException(422, "Tanggal akhir harus setelah tanggal berikutnya, maksimal 10 tahun")
    schedule = await db.scalar(select(WorkspaceRecurrence).where(WorkspaceRecurrence.task_id == task_id))
    if not schedule:
        schedule = WorkspaceRecurrence(task_id=task_id)
        db.add(schedule)
    for key in ("unit", "interval", "next_date", "end_date", "active"):
        setattr(schedule, key, getattr(body, key))
    schedule.anchor_day = body.next_date.day
    await _touch(db, board, profile, project_id, "Jadwal WO diubah", task_id, {"name": task.name})
    return _row(schedule, "id unit interval next_date end_date active")


@router.post("/projects/{project_id}/recurrences/run")
async def run_recurrences(project_id: uuid.UUID, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    from app.services.workspace_recurrence import generate_due
    return {"generated": await generate_due(db, project_id, actor_id=profile.id)}


@router.get("/projects/{project_id}/shares")
async def get_shares(project_id: uuid.UUID, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    shares = (await db.scalars(select(WorkspacePortalShare).where(WorkspacePortalShare.project_id == project_id)
        .order_by(WorkspacePortalShare.created_at.desc()).limit(100))).all()
    return [_row(share, "id label expires_at revoked_at") for share in shares]


@router.post("/projects/{project_id}/shares", status_code=201)
async def create_share(project_id: uuid.UUID, body: ShareIn, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    if not body.label.strip():
        raise HTTPException(422, "Nama penerima wajib diisi")
    token = secrets.token_urlsafe(32)
    share = WorkspacePortalShare(project_id=project_id, label=body.label.strip(),
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_in_days))
    db.add(share)
    await rules.record_event(db, project_id, profile.id, "Akses pelanggan dibuat", payload={"name": body.label.strip()})
    await db.flush()
    return {"token": token, "share": _row(share, "id label expires_at revoked_at")}


@router.delete("/projects/{project_id}/shares/{share_id}")
async def revoke_share(project_id: uuid.UUID, share_id: uuid.UUID, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    share = await db.get(WorkspacePortalShare, share_id)
    if not share or share.project_id != project_id:
        raise HTTPException(404, "Akses pelanggan tidak ditemukan")
    share.revoked_at = datetime.now(timezone.utc)
    await rules.record_event(db, project_id, profile.id, "Akses pelanggan dicabut", payload={"name": share.label})
    return {"revoked": True}


async def _portal_share(db, token):
    if not 40 <= len(token) <= 100:
        raise HTTPException(404, "Tautan tidak berlaku atau telah kedaluwarsa")
    share = await db.scalar(select(WorkspacePortalShare).where(
        WorkspacePortalShare.token_hash == hashlib.sha256(token.encode()).hexdigest(),
        WorkspacePortalShare.revoked_at.is_(None), WorkspacePortalShare.expires_at > datetime.now(timezone.utc)))
    if not share:
        raise HTTPException(404, "Tautan tidak berlaku atau telah kedaluwarsa")
    return share


@public_router.get("/{token}")
async def portal_project(token: str, db: DB, response: Response):
    share = await _portal_share(db, token)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    project = await db.get(WorkspaceProject, share.project_id)
    rows = (await db.execute(select(WorkspaceTask, WorkspaceTaskPlan.milestone_id)
        .join(WorkspacePhase).join(WorkspaceTaskPlan, WorkspaceTaskPlan.task_id == WorkspaceTask.id)
        .where(WorkspacePhase.project_id == project.id, WorkspaceTaskPlan.portal_visible.is_(True))
        .order_by(WorkspaceTask.deadline.asc().nullslast(), WorkspaceTask.name))).all()
    ids = [task.id for task, _ in rows]
    milestone_ids = {key for _, key in rows if key}
    comments = (await db.scalars(select(WorkspaceComment).where(WorkspaceComment.task_id.in_(ids),
        WorkspaceComment.external.is_(True)).order_by(WorkspaceComment.created_at.desc()).limit(100))).all()
    attachments = (await db.execute(select(WorkspaceAttachment.id, WorkspaceAttachment.task_id, WorkspaceAttachment.name)
        .where(WorkspaceAttachment.task_id.in_(ids), WorkspaceAttachment.external.is_(True)).limit(100))).all()
    updates = (await db.scalars(select(WorkspaceProjectUpdate).where(WorkspaceProjectUpdate.project_id == project.id,
        WorkspaceProjectUpdate.external.is_(True)).order_by(WorkspaceProjectUpdate.created_at.desc()).limit(50))).all()
    milestones = (await db.scalars(select(WorkspaceMilestone).where(WorkspaceMilestone.id.in_(milestone_ids)))).all()
    done = sum(task.status == TaskStatus.done for task, _ in rows)
    return {"name": project.name, "customer": project.client_name, "status": project.status.value,
        "deadline": project.deadline, "progress": round(done * 100 / len(rows), 1) if rows else 0,
        "tasks": [{"id": str(task.id), "name": task.name, "deadline": task.deadline, "status": task.status.value} for task, _ in rows],
        "milestones": [_row(m, "id name deadline reached_at") for m in milestones],
        "comments": [_row(c, "id task_id body created_at") for c in comments],
        "attachments": [{"id": str(key), "task_id": str(task_id), "name": name} for key, task_id, name in attachments],
        "updates": [_row(u, "id health summary created_at") for u in updates]}


@public_router.get("/{token}/attachments/{attachment_id}")
async def portal_attachment(token: str, attachment_id: uuid.UUID, db: DB):
    share = await _portal_share(db, token)
    attachment = await db.scalar(select(WorkspaceAttachment).join(WorkspaceTask,
        WorkspaceAttachment.task_id == WorkspaceTask.id).join(WorkspacePhase)
        .join(WorkspaceTaskPlan, WorkspaceTaskPlan.task_id == WorkspaceTask.id)
        .where(WorkspaceAttachment.id == attachment_id, WorkspaceAttachment.external.is_(True),
            WorkspaceTaskPlan.portal_visible.is_(True), WorkspacePhase.project_id == share.project_id))
    if not attachment:
        raise HTTPException(404, "Lampiran tidak tersedia")
    return await _download(db, attachment)
