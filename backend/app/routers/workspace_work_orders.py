"""A WO is a brief, one PIC, a schedule and a daily logbook."""
import asyncio
import hashlib
import json
import uuid
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import delete, func, select

from app.dependencies import require_any_permission
from app.routers.workspace import _can, _enrich_task, _locked_task, _require_task_access, _require_project_access
from app.routers.workspace_board import DB, Reader, _lock_board, _place_unassigned
from app.routers.workspace_coordination import require_coordination
from app.services import workspace_coordination as ops, workspace_project as rules
from app.services.workspace_workflow import TERMINAL, status_targets
from app.services.workspace_links import register_attachment
from app.services import workspace_archive as archive
from db.models.profile import Profile, ROLE_LABELS
from db.models.workspace import WorkspacePhase, WorkspaceProject, WorkspaceTask, TaskCompletion, PhaseStatus, TaskStatus
from db.models.workspace_coordination import WorkspaceMember, WorkspaceWorkControl, WorkspaceDocument, WorkspaceIssue, MaterialRequest, MaterialItem
from db.models.workspace_project import WorkspaceAttachment, WorkspaceTaskAssignee, WorkspaceTimeEntry, WorkspaceComment, WorkspaceEvent
from db.models.workspace_logbook import WorkspaceWorkLog, WorkspaceWorkLogAttachment

router = APIRouter(dependencies=[Depends(require_coordination)])
Planner = Annotated[Profile, Depends(require_any_permission("workspace:manage", "workspace:create_wo"))]
LOCAL = ZoneInfo("Asia/Jakarta")


class BriefIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=10000)
    pic_id: uuid.UUID | None = None
    pic_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    archive_department: str | None = Field(default=None, max_length=50)
    attachment_kind: str = Field(default="Lampiran WO", min_length=1, max_length=80)
    start_date: date
    end_date: date
    expected_updated_at: datetime | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("Tanggal selesai tidak boleh sebelum mulai")
        self.pic_ids = list(dict.fromkeys(([self.pic_id] if self.pic_id else []) + self.pic_ids))
        if not self.pic_ids:
            raise ValueError("Pilih minimal satu PIC pekerjaan")
        self.pic_id = self.pic_ids[0]
        return self


class LogIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: uuid.UUID
    work_date: date
    body: str = Field(min_length=1, max_length=10000)
    minutes: int = Field(default=0, ge=0, le=1440)
    archive_department: str | None = Field(default=None, max_length=50)
    is_issue: bool = False

    @model_validator(mode="after")
    def valid_date(self):
        if self.work_date > rules.local_today() or self.work_date < date(2010, 1, 1):
            raise ValueError("Tanggal logbook harus antara 2010 dan hari ini")
        if self.is_issue and len(self.body) < 3:
            raise ValueError("Jelaskan kendala minimal 3 karakter")
        return self


class StatusIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: TaskStatus
    expected_updated_at: datetime
    note: str = Field(default="", max_length=2000)


class ScheduleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    end_date: date = Field(ge=date(2010, 1, 1), le=date(2100, 12, 31))
    expected_updated_at: datetime


async def writable_task(db, task):
    project = await db.get(WorkspaceProject, await rules.task_project_id(db, task))
    if project.archived_at or project.status.value in {"on_hold", "completed"}:
        raise HTTPException(409, "Proyek sedang ditunda, selesai atau diarsipkan")
    return project


async def permissions(db, profile, task):
    manage = await _can(db, profile, "workspace:manage")
    return dict(manage=manage,
        edit=manage or await _can(db, profile, "workspace:create_wo"),
        execute=manage or (await _can(db, profile, "workspace:execute_wo") and await rules.is_assignee(db, task, profile)),
        review=manage or await _can(db, profile, "workspace:review_wo"))


def parse_input(model, raw):
    try:
        return model.model_validate_json(raw)
    except ValidationError as err:
        raise HTTPException(422, json.loads(err.json()))


async def read_files(files):
    if len(files) > 8:
        raise HTTPException(422, "Maksimal 8 lampiran dalam satu kiriman")
    allowed = archive.UPLOAD_MIMES
    result, total = [], 0
    for file in files:
        data = await file.read(10 * 1024 * 1024 + 1)
        total += len(data)
        if not data or len(data) > 10 * 1024 * 1024 or total > 25 * 1024 * 1024:
            raise HTTPException(413, "Maksimal 10 MB per lampiran dan 25 MB per kiriman")
        mime = file.content_type or "application/octet-stream"
        if mime not in allowed:
            raise HTTPException(415, "Gunakan foto, PDF, dokumen Office, teks atau berkas CAD")
        name = (file.filename or "lampiran").replace("\\", "/").split("/")[-1]
        name = "".join(c for c in name if 32 <= ord(c) != 127)[:180] or "lampiran"
        sha256_hash = await asyncio.to_thread(lambda b: hashlib.sha256(b).hexdigest(), data)
        result.append(dict(name=name, content_type=mime, data=data, sha256=sha256_hash))
    return result


def fingerprint(body, files):
    value = {"body": body.model_dump(mode="json", exclude={"archive_department"} if body.archive_department is None else set()), "files": [{k:v for k,v in f.items() if k != "data"} for f in files]}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


async def store_files(db, task, profile, files, log_id=None, kind="Lampiran WO", department=None, request_id=None):
    if files and archive.enabled():
        department = archive.department_for(profile, department)
    for index, values in enumerate(files):
        attachment = WorkspaceAttachment(id=uuid.uuid5(request_id or log_id or task.id, f"{index}:{values['sha256']}:attachment"), task_id=task.id, uploaded_by=profile.id, external=False, **values)
        db.add(attachment)
        await db.flush()
        if log_id:
            db.add(WorkspaceWorkLogAttachment(log_id=log_id, attachment_id=attachment.id))
        await register_attachment(db, task, profile, attachment, len(values["data"]), kind="Dokumentasi Proses" if log_id else kind, department=department)



async def set_brief(db, task, body, person):
    task.name, task.description, task.assigned_to = body.name, body.description, person.id
    task.deadline = body.end_date
    task.estimated_days = (body.end_date-body.start_date).days + 1
    await db.execute(delete(WorkspaceTaskAssignee).where(WorkspaceTaskAssignee.task_id == task.id))
    db.add_all([WorkspaceTaskAssignee(task_id=task.id, profile_id=key) for key in body.pic_ids])
    control = await db.get(WorkspaceWorkControl, task.id)
    if not control:
        control = WorkspaceWorkControl(task_id=task.id)
        db.add(control)
    control.pic_id = person.id
    control.division = ROLE_LABELS.get(person.role, person.role.value)
    control.planned_start = datetime.combine(body.start_date, time.min, LOCAL)
    control.planned_end = datetime.combine(body.end_date + timedelta(days=1), time.min, LOCAL) - timedelta(seconds=1)
    control.drawing_required = control.material_required = False
    task.updated_at = ops.now()
    return control


async def active_person(db, person_id):
    person = await db.get(Profile, person_id)
    if not person or not person.is_active:
        raise HTTPException(422, "PIC harus pengguna yang aktif")
    return person


async def execute_allowed(db, profile, task):
    if not await _can(db, profile, "workspace:manage") and not (
        await _can(db, profile, "workspace:execute_wo") and await rules.is_assignee(db, task, profile)):
        raise HTTPException(403, "Hanya PIC atau pengelola yang dapat memperbarui pekerjaan")
    project = await db.get(WorkspaceProject, await rules.task_project_id(db, task))
    if project.archived_at or project.status.value in {"on_hold", "completed"}:
        raise HTTPException(409, "Proyek sedang ditunda, selesai atau diarsipkan")


@router.get("/projects/{project_id}/work-order-people")
async def work_order_people(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db,profile,project_id)
    rows = (await db.execute(select(Profile.id,Profile.full_name).where(Profile.is_active.is_(True)).order_by(Profile.full_name))).all()
    return [{"id":str(key),"name":name} for key,name in rows]


@router.post("/projects/{project_id}/work-orders", status_code=201)
async def create_work_order(project_id: uuid.UUID, db: DB, profile: Planner,
    metadata: str = Form(...), files: list[UploadFile] = File(default=[])):
    body = parse_input(BriefIn, metadata)
    uploads = await read_files(files)
    await ops.writable_project(db, profile, project_id)
    digest = fingerprint(body, uploads)
    old = await db.get(WorkspaceTask, body.request_id)
    if old:
        control = await db.get(WorkspaceWorkControl, old.id)
        if await rules.task_project_id(db, old) != project_id or not control or control.creation_hash != digest:
            raise HTTPException(409, "ID pembuatan sudah digunakan untuk WO berbeda")
        return await _enrich_task(db, old)
    person = await active_person(db, body.pic_id)
    for person_id in body.pic_ids:
        await active_person(db, person_id)
    phase = await db.scalar(select(WorkspacePhase).where(WorkspacePhase.project_id == project_id).order_by(WorkspacePhase.order, WorkspacePhase.id).limit(1))
    if not phase:
        phase = WorkspacePhase(project_id=project_id, name="Pekerjaan", order=1, status=PhaseStatus.pending)
        db.add(phase)
        await db.flush()
    task = WorkspaceTask(id=body.request_id, phase_id=phase.id, name=body.name, status=TaskStatus.todo,
        order=(await db.scalar(select(func.coalesce(func.max(WorkspaceTask.order),0)).where(WorkspaceTask.phase_id == phase.id)))+1)
    db.add(task)
    await db.flush()
    control = await set_brief(db, task, body, person)
    control.creation_hash = digest
    await store_files(db, task, profile, uploads, kind=body.attachment_kind, department=body.archive_department, request_id=body.request_id)
    await _place_unassigned(db, project_id)
    await rules.task_event(db, task, profile, "WO dibuat")
    await db.flush()
    return await _enrich_task(db, task)


@router.put("/tasks/{task_id}/work-order")
async def edit_work_order(task_id: uuid.UUID, db: DB, profile: Planner,
    metadata: str = Form(...), files: list[UploadFile] = File(default=[])):
    body = parse_input(BriefIn, metadata)
    uploads = await read_files(files)
    task = await _locked_task(db, profile, task_id)
    project_id = await rules.task_project_id(db, task)
    project = await db.get(WorkspaceProject, project_id)
    if project.archived_at or task.status in TERMINAL:
        raise HTTPException(409, "WO selesai atau diarsipkan tidak dapat diubah")
    if not body.expected_updated_at or task.updated_at != body.expected_updated_at:
        raise HTTPException(409, "WO berubah. Muat ulang sebelum mengedit")
    person = await active_person(db, body.pic_id)
    for person_id in body.pic_ids:
        await active_person(db, person_id)
    await set_brief(db, task, body, person)
    await store_files(db, task, profile, uploads, kind=body.attachment_kind, department=body.archive_department, request_id=body.request_id)
    await rules.task_event(db, task, profile, "WO diubah")
    await db.flush()
    return await _enrich_task(db, task)


def file_out(row):
    return {"id": str(row.id), "name": row.name, "content_type": row.content_type, "bytes": row.bytes}


@router.get("/tasks/{task_id}/work-order")
async def work_order_detail(task_id: uuid.UUID, db: DB, profile: Reader, offset: int = 0):
    if offset < 0:
        raise HTTPException(422, "Halaman logbook tidak valid")
    task = await db.get(WorkspaceTask, task_id)
    if not task:
        raise HTTPException(404, "WO tidak ditemukan")
    await _require_task_access(db, profile, task)
    project = await db.get(WorkspaceProject, await rules.task_project_id(db, task))
    control = await db.get(WorkspaceWorkControl, task_id)
    start = control.planned_start.astimezone(LOCAL).date() if control and control.planned_start else (
        task.deadline - timedelta(days=max(0,(task.estimated_days or 1)-1)) if task.deadline else None)
    end = control.planned_end.astimezone(LOCAL).date() if control and control.planned_end else task.deadline
    columns = (WorkspaceAttachment.id, WorkspaceAttachment.name, WorkspaceAttachment.content_type,
        archive.attachment_size().label("bytes"))
    brief_files = (await db.execute(select(*columns).outerjoin(WorkspaceWorkLogAttachment,
        WorkspaceWorkLogAttachment.attachment_id == WorkspaceAttachment.id)
        .where(WorkspaceAttachment.task_id == task_id, WorkspaceWorkLogAttachment.log_id.is_(None))
        .order_by(WorkspaceAttachment.created_at))).all()
    total = await db.scalar(select(func.count()).select_from(WorkspaceWorkLog).where(WorkspaceWorkLog.task_id == task_id))
    logs = (await db.execute(select(WorkspaceWorkLog, Profile.full_name, Profile.is_active).join(Profile, WorkspaceWorkLog.author_id == Profile.id)
        .where(WorkspaceWorkLog.task_id == task_id).order_by(WorkspaceWorkLog.work_date.desc(), WorkspaceWorkLog.created_at.desc(), WorkspaceWorkLog.id.desc())
        .offset(offset).limit(30))).all()
    log_files = (await db.execute(select(WorkspaceWorkLogAttachment.log_id,*columns).join(WorkspaceAttachment,
        WorkspaceWorkLogAttachment.attachment_id == WorkspaceAttachment.id)
        .where(WorkspaceWorkLogAttachment.log_id.in_([log.id for log,_,_ in logs])))).all()
    minutes = await db.scalar(select(func.coalesce(func.sum(WorkspaceTimeEntry.minutes),0)).where(WorkspaceTimeEntry.task_id == task_id))
    legacy = (await db.execute(select(TaskCompletion, Profile.full_name).join(Profile, TaskCompletion.submitted_by == Profile.id)
        .where(TaskCompletion.task_id == task_id).order_by(TaskCompletion.completed_at.desc()).limit(20))).all()
    comments = (await db.execute(select(WorkspaceComment, Profile.full_name).outerjoin(Profile, WorkspaceComment.author_id == Profile.id)
        .where(WorkspaceComment.task_id == task_id).order_by(WorkspaceComment.created_at.desc()).limit(20))).all()
    access = await permissions(db, profile, task)
    writable = not project.archived_at and project.status.value not in {"on_hold", "completed"}
    history = (await db.execute(select(WorkspaceEvent, Profile.full_name).outerjoin(Profile, WorkspaceEvent.actor_id == Profile.id)
        .where(WorkspaceEvent.task_id == task_id, WorkspaceEvent.action == "Status WO diperbarui")
        .order_by(WorkspaceEvent.created_at.desc()).limit(20))).all()
    linked_docs = (await db.scalars(select(WorkspaceDocument).where(WorkspaceDocument.task_id == task_id))).all()
    doc_by_attachment = {doc.attachment_id: doc for doc in linked_docs if doc.attachment_id}
    assignee_ids = await rules.task_assignees(db, task)
    assignees = (await db.execute(select(Profile.id, Profile.full_name, Profile.avatar_url, Profile.is_active).where(Profile.id.in_(assignee_ids)).order_by(Profile.full_name))).all()
    issues = (await db.scalars(select(WorkspaceIssue).where(WorkspaceIssue.task_id == task_id, WorkspaceIssue.kind == "blocker"))).all()
    issue_by_log = {issue.source_log_id: issue for issue in issues if issue.source_log_id}
    materials = (await db.execute(select(MaterialRequest, MaterialItem).join(MaterialItem).where(MaterialRequest.task_id == task_id).order_by(MaterialRequest.line_number))).all()
    def linked_file(row):
        doc = doc_by_attachment.get(row.id)
        return {**file_out(row), "document_id": str(doc.id) if doc else None, "status": doc.status if doc else "review", "kind": doc.kind if doc else "Lampiran WO"}
    return {"task": (await _enrich_task(db,task)).model_dump(), "project_id": str(project.id),
        "project_name": project.name, "rpo_number": project.rpo_number, "archived": bool(project.archived_at),
        "start_date": ops.stamp(start), "end_date": ops.stamp(end), "can_edit": access["edit"], "can_execute": access["execute"] and writable,
        "can_review": access["review"] and writable,
        "allowed_statuses": [s.value for s in status_targets(task.status, **access)] if writable else [],
        "status_history": [{"id": str(event.id), "author_name": name, "created_at": ops.stamp(event.created_at), **event.payload} for event, name in history],
        "assignees": [{"id": str(key), "name": name, "avatar_url": avatar, "inactive": not is_active} for key, name, avatar, is_active in assignees],
        "materials": [{"id": str(r.id), "name": r.description or i.name, "specification": r.specification, "quantity": float(r.quantity), "unit": i.unit, "status": r.status, "notes": r.notes} for r, i in materials],
        "issues": [{"id": str(i.id), "title": i.title, "status": i.status, "source_log_id": str(i.source_log_id) if i.source_log_id else None} for i in issues],
        "attachments": [linked_file(row) for row in brief_files] + [{"id": str(doc.id), "document_id": str(doc.id), "name": doc.filename, "content_type": doc.mime, "bytes": doc.size, "status": doc.status, "kind": doc.kind} for doc in linked_docs if not doc.attachment_id], "logged_minutes": minutes,
        "log_total": total, "logs": [{"id":str(log.id), "author_id":str(log.author_id), "author_name":name, "author_inactive": not is_active,
            "work_date": str(log.work_date), "body": log.body, "minutes": log.minutes, "created_at":ops.stamp(log.created_at),
            "issue_id": str(issue_by_log[log.id].id) if log.id in issue_by_log else None,
            "issue_status": issue_by_log[log.id].status if log.id in issue_by_log else None,
            "attachments":[linked_file(row) for row in log_files if row.log_id == log.id]} for log,name,is_active in logs],
        "previous_reports":[{"id":str(report.id),"author_name":name,"created_at":ops.stamp(report.completed_at),
            "body":report.notes,"photos":[*(report.photos_before or []),*(report.photos_after or []),*([report.photo_url] if report.photo_url else [])]} for report,name in legacy],
        "previous_notes":[{"id":str(c.id),"author_name":name,"created_at":ops.stamp(c.created_at),"body":c.body} for c,name in comments]}


@router.post("/tasks/{task_id}/logbook", status_code=201)
async def add_work_log(task_id: uuid.UUID, db: DB, profile: Reader,
    metadata: str = Form(...), files: list[UploadFile] = File(default=[])):
    body = parse_input(LogIn, metadata)
    uploads = await read_files(files)
    task = await _locked_task(db, profile, task_id)
    await execute_allowed(db,profile,task)
    digest = fingerprint(body, uploads)
    old = await db.get(WorkspaceWorkLog,body.request_id)
    if old:
        if old.task_id != task_id or old.author_id != profile.id or old.request_hash != digest:
            raise HTTPException(409,"ID logbook sudah dipakai untuk catatan berbeda")
        return {"id":str(old.id)}
    if task.status != TaskStatus.in_progress:
        raise HTTPException(409,"Mulai pekerjaan terlebih dahulu untuk mengisi logbook")
    if body.minutes:
        from app.routers.workspace_project import _validate_time
        await _validate_time(db,profile.id,SimpleNamespace(work_date=body.work_date,minutes=body.minutes,description=body.body))
    log = WorkspaceWorkLog(id=body.request_id,task_id=task_id,author_id=profile.id,work_date=body.work_date,
        body=body.body,minutes=body.minutes,request_hash=digest)
    db.add(log)
    await db.flush()
    await store_files(db,task,profile,uploads,log.id,department=body.archive_department,request_id=body.request_id)
    if body.is_issue:
        db.add(WorkspaceIssue(id=log.id, project_id=await rules.task_project_id(db, task), task_id=task.id,
            source_log_id=log.id, kind="blocker", title=f"WO-{task.wo_number}: {body.body.splitlines()[0]}"[:255],
            description=body.body[:5000], pic_id=task.assigned_to or profile.id, due_date=max(task.deadline or rules.local_today(), rules.local_today()), author_id=profile.id))
        await rules.task_event(db, task, profile, "Kendala dicatat dari logbook")
    if body.minutes:
        db.add(WorkspaceTimeEntry(id=log.id,task_id=task.id,profile_id=profile.id,work_date=body.work_date,
            minutes=body.minutes,description=body.body[:1000]))
    await rules.task_event(db,task,profile,"Logbook harian ditambahkan")
    return {"id":str(log.id)}


async def change_status(db, profile, task, target, note=""):
    await writable_task(db, task)
    access = await permissions(db, profile, task)
    if target not in status_targets(task.status, **access):
        raise HTTPException(403, "Perubahan status ini tidak tersedia untuk role Anda atau status WO saat ini")
    log = await db.scalar(select(WorkspaceWorkLog).where(WorkspaceWorkLog.task_id == task.id)
        .order_by(WorkspaceWorkLog.work_date.desc(),WorkspaceWorkLog.created_at.desc()).limit(1))
    if target == TaskStatus.pending_review and not log:
        raise HTTPException(409, "Tambahkan logbook hasil pekerjaan sebelum mengirim untuk review")
    if target == TaskStatus.cancelled and not note:
        raise HTTPException(422, "Isi alasan pembatalan WO")
    previous = task.status
    task.status, task.updated_at = target, ops.now()
    if target == TaskStatus.in_progress and not task.started_at:
        task.started_at = ops.now()
    if target == TaskStatus.pending_review:
        db.add(TaskCompletion(task_id=task.id, submitted_by=profile.id, notes=log.body, completed_at=ops.now()))
    if target == TaskStatus.done:
        await rules.require_ready(db, task, completing=True)
        task.reviewed_by, task.reviewed_at, task.review_notes = profile.id, ops.now(), note or None
    if previous in TERMINAL and target == TaskStatus.todo:
        task.reviewed_by = task.reviewed_at = task.review_notes = None
    project_id = await rules.task_project_id(db, task)
    recipients = await rules.task_assignees(db, task)
    recipients.add((await db.get(WorkspaceProject, project_id)).manager_id)
    await rules.record_event(db, project_id, profile.id, "Status WO diperbarui", task.id,
        {"name": task.name, "from": previous.value, "status": target.value, "note": note},
        recipients)
    await db.flush()
    return await _enrich_task(db,task)


@router.put("/tasks/{task_id}/work-order/status")
async def update_work_order_status(task_id: uuid.UUID, body: StatusIn, db: DB, profile: Reader):
    task = await _locked_task(db, profile, task_id)
    if task.updated_at != body.expected_updated_at:
        raise HTTPException(409, "Status WO berubah. Muat ulang sebelum melanjutkan")
    return await change_status(db, profile, task, body.status, body.note)


@router.post("/tasks/{task_id}/finish")
async def finish_work_order(task_id: uuid.UUID, db: DB, profile: Reader):
    task = await _locked_task(db, profile, task_id)
    if not (await permissions(db, profile, task))["review"]:
        raise HTTPException(403, "WO harus diperiksa oleh role yang memiliki permission review")
    await writable_task(db, task)
    if task.status == TaskStatus.done:
        return await _enrich_task(db, task)
    if task.status != TaskStatus.pending_review:
        raise HTTPException(409, "Kirim WO ke Need Review sebelum Finish")
    return await change_status(db, profile, task, TaskStatus.done)


@router.put("/tasks/{task_id}/work-order/schedule")
async def reschedule_work_order(task_id: uuid.UUID, body: ScheduleIn, db: DB, profile: Planner):
    task = await _locked_task(db, profile, task_id)
    await writable_task(db, task)
    if task.status in TERMINAL:
        raise HTTPException(409, "Buka kembali WO sebelum mengubah jadwalnya")
    if task.updated_at != body.expected_updated_at:
        raise HTTPException(409, "Jadwal WO berubah. Muat ulang sebelum memindahkan kartu")
    control = await db.get(WorkspaceWorkControl, task_id)
    old_end = control.planned_end.astimezone(LOCAL).date() if control and control.planned_end else task.deadline
    old_start = control.planned_start.astimezone(LOCAL).date() if control and control.planned_start else None
    duration = max(1, (old_end - old_start).days + 1) if old_end and old_start else max(1, task.estimated_days or 1)
    if not control:
        control = WorkspaceWorkControl(task_id=task.id, pic_id=task.assigned_to, division="", drawing_required=False, material_required=False)
        db.add(control)
    start = body.end_date - timedelta(days=duration-1)
    control.planned_start = datetime.combine(start, time.min, LOCAL)
    control.planned_end = datetime.combine(body.end_date+timedelta(days=1), time.min, LOCAL)-timedelta(seconds=1)
    task.deadline, task.estimated_days, task.updated_at = body.end_date, duration, ops.now()
    await rules.record_event(db, await rules.task_project_id(db, task), profile.id, "Jadwal WO diperbarui", task.id,
        {"name": task.name, "from": ops.stamp(old_end), "end_date": str(body.end_date)}, await rules.task_assignees(db, task))
    await db.flush()
    return await _enrich_task(db, task)
