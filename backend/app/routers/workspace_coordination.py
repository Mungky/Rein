"""Cross-division workspace: controlled documents, work release, issues and staffing."""
import hashlib
import uuid
from datetime import date, datetime
from pathlib import PurePosixPath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, func, or_, delete
from urllib.parse import quote

from app.dependencies import require_permission
from app.routers.workspace import _can, _require_project_access, _visible_project_ids, _project_to_out, _project_progress
from app.routers.workspace_board import DB, Reader, Manager
from app.services import workspace_archive as archive
from app.services import workspace_coordination as ops
from app.services import workspace_project as planning
from db.models.profile import Profile, ROLE_LABELS
from db.models.workspace import WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskStatus
from db.models.workspace_coordination import (WorkspaceMember, WorkspaceWorkControl, WorkspaceDocument,
    WorkspaceDocumentReceipt, WorkspaceIssue, MaterialRequest, MaterialItem, StockBalance, StockMovement)
from db.models.workspace_project import WorkspaceTimeEntry, WorkspaceTaskAssignee, WorkspaceTaskPlan, WorkspaceEvent, WorkspaceAttachment
from db.models.workspace_logbook import WorkspaceWorkLog, WorkspaceWorkLogAttachment
from db.models.workspace_board import WorkspaceTaskStage, WorkspaceTaskPlacement


def require_coordination():
    if not ops.enabled():
        raise HTTPException(503, "Koordinasi proyek belum diaktifkan. Jalankan migrasi database.")


router = APIRouter(dependencies=[Depends(require_coordination)])
Publisher = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:publish_document"))]
Approver = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:approve_document"))]
Releaser = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:release_work"))]
Verifier = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:verify_issue"))]
Archiver = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:archive"))]


class OperationalInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class MemberIn(OperationalInput):
    profile_id: uuid.UUID
    division: str = Field(min_length=1, max_length=80)


class ControlIn(OperationalInput):
    division: str = Field(min_length=1, max_length=80)
    pic_id: uuid.UUID
    planned_start: datetime
    planned_end: datetime
    drawing_required: bool = True
    material_required: bool = True

    @model_validator(mode="after")
    def dates(self):
        if not self.planned_start.tzinfo or not self.planned_end.tzinfo or self.planned_end <= self.planned_start:
            raise ValueError("Jadwal harus menyertakan zona waktu dan selesai setelah mulai")
        return self


class ReleaseIn(OperationalInput):
    note: str = Field(min_length=5, max_length=2000)
    release: bool = True


class ApprovalIn(OperationalInput):
    decision: Literal["approved", "rejected"]
    client_approved: bool = False
    evidence: str = Field(min_length=5, max_length=3000)


class RecipientsIn(OperationalInput):
    profile_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class TaskLinkIn(OperationalInput):
    task_id: uuid.UUID | None = None


class IssueIn(OperationalInput):
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    kind: Literal["blocker", "punch"]
    task_id: uuid.UUID | None = None
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(max_length=5000, default="")
    pic_id: uuid.UUID
    due_date: date


class ResolutionIn(OperationalInput):
    resolution: str = Field(min_length=5, max_length=5000)
    evidence: str = Field(min_length=3, max_length=3000)


async def project_task(db, project_id, task_id):
    if task_id is None:
        return None
    task = await db.get(WorkspaceTask, task_id)
    if not task or await planning.task_project_id(db, task) != project_id:
        raise HTTPException(422, "Pekerjaan tidak termasuk proyek ini")
    return task


def document_out(doc, receipts, names, latest, log_id=None):
    return {"id": str(doc.id), "task_id": str(doc.task_id) if doc.task_id else None, "code": doc.code,
        "title": doc.title, "kind": doc.kind, "revision": doc.revision, "status": doc.status,
        "filename": doc.filename, "size": doc.size, "client_approved": doc.client_approved,
        "approval_evidence": doc.approval_evidence, "approved_at": ops.stamp(doc.approved_at),
        "approved_by": names.get(doc.approved_by), "author": names.get(doc.author_id), "author_id": str(doc.author_id), "current": latest,
        "created_at": ops.stamp(doc.created_at), "attachment_id": str(doc.attachment_id) if doc.attachment_id else None,
        "source": "logbook" if log_id else "work_order" if doc.attachment_id else "documents", "log_id": str(log_id) if log_id else None,
        "receipts": [{"profile_id": str(r.profile_id), "name": names.get(r.profile_id, "Pengguna"),
            "acknowledged_at": ops.stamp(r.acknowledged_at)} for r in receipts]}


@router.get("/projects/{project_id}/coordination")
async def project_coordination(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    records = await ops.project_records(db, project_id)
    people = (await db.scalars(select(Profile).order_by(Profile.full_name))).all()
    names = {p.id: p.full_name for p in people}
    members = (await db.scalars(select(WorkspaceMember).where(WorkspaceMember.project_id == project_id))).all()
    member_rows = [{"profile_id": str(m.profile_id), "name": names.get(m.profile_id), "division": m.division} for m in members]
    manager_id = records["project"].manager_id
    if manager_id and not any(m.profile_id == manager_id for m in members):
        member_rows.insert(0, {"profile_id": str(manager_id), "name": names.get(manager_id), "division": "Manajer Proyek"})
    by_person = {row["profile_id"]: row for row in member_rows}
    people_by_id = {person.id: person for person in people}
    for task in records["tasks"]:
        for key in records["assignments"][task.id]:
            person = people_by_id.get(key)
            if not person:
                continue
            row = by_person.get(str(key))
            if row is None:
                row = {"profile_id": str(key), "name": person.full_name, "division": ROLE_LABELS.get(person.role, person.role.value), "source": "work_order"}
                by_person[str(key)] = row
                member_rows.append(row)
            row.setdefault("work_orders", []).append({"id": str(task.id), "name": task.name, "wo_number": task.wo_number, "status": task.status.value})
    log_sources = dict((await db.execute(select(WorkspaceWorkLogAttachment.attachment_id, WorkspaceWorkLogAttachment.log_id)
        .where(WorkspaceWorkLogAttachment.attachment_id.in_([doc.attachment_id for doc in records["documents"] if doc.attachment_id])))).all())
    latest_ids = {d.id for d in records["latest"]}
    task_ids = [t.id for t in records["tasks"]]
    logged = dict((await db.execute(select(WorkspaceTimeEntry.task_id, func.sum(WorkspaceTimeEntry.minutes))
        .where(WorkspaceTimeEntry.task_id.in_(task_ids)).group_by(WorkspaceTimeEntry.task_id))).all())
    updates = (await db.execute(select(WorkspaceWorkLog.task_id, func.max(WorkspaceWorkLog.work_date), func.count())
        .where(WorkspaceWorkLog.task_id.in_(task_ids)).group_by(WorkspaceWorkLog.task_id))).all()
    events = (await db.scalars(select(WorkspaceEvent).where(WorkspaceEvent.project_id == project_id)
        .order_by(WorkspaceEvent.created_at.desc()).limit(50))).all()
    controls = [{"task_id": str(c.task_id), "division": c.division, "pic_id": str(c.pic_id) if c.pic_id else None,
        "pic_name": names.get(c.pic_id), "planned_start": ops.stamp(c.planned_start), "planned_end": ops.stamp(c.planned_end),
        "drawing_required": c.drawing_required, "material_required": c.material_required,
        "released_at": ops.stamp(c.released_at), "released_by": names.get(c.released_by), "release_note": c.release_note}
        for c in records["controls"].values()]
    for row in member_rows:
        person_obj = people_by_id.get(uuid.UUID(row["profile_id"]))
        row["avatar_url"] = person_obj.avatar_url if person_obj else None
        row["inactive"] = not person_obj.is_active if person_obj else True
    stored = await archive.archive_metadata(db, records["documents"])
    return {"archive_enabled": archive.enabled(), "members": member_rows,
        "people": [{"id": str(p.id), "name": p.full_name, "role": p.role.value, "avatar_url": p.avatar_url} for p in people if p.is_active],
        "controls": controls, "readiness": [ops.readiness(t, records) for t in records["tasks"]],
        "logged_minutes": {str(k): v for k,v in logged.items()},
        "daily_updates": {str(key): {"work_date":str(day),"count":count} for key,day,count in updates},
        "events": [{"id": str(e.id), "actor": names.get(e.actor_id), "action": e.action, "payload": e.payload,
            "created_at": ops.stamp(e.created_at)} for e in events],
        "documents": [{**document_out(d, records["receipts"][d.id], names, d.id in latest_ids, log_sources.get(d.attachment_id)), **stored.get(d.id, {"storage": "database"})} for d in records["documents"]],
        "issues": [{"id": str(i.id), "task_id": str(i.task_id) if i.task_id else None, "kind": i.kind, "title": i.title,
            "description": i.description, "author_id": str(i.author_id), "source_log_id": str(i.source_log_id) if i.source_log_id else None, "pic_id": str(i.pic_id), "pic_name": names.get(i.pic_id), "pic_inactive": not people_by_id[i.pic_id].is_active if i.pic_id in people_by_id else True, "due_date": str(i.due_date),
            "status": i.status, "resolution": i.resolution, "evidence": i.evidence, "created_at": ops.stamp(i.created_at),
            "resolved_at": ops.stamp(i.resolved_at), "verified_by": names.get(i.verified_by), "verified_at": ops.stamp(i.verified_at),
            "waiting_hours": round(((i.verified_at or ops.now()) - i.created_at).total_seconds() / 3600, 1)} for i in records["issues"]]}


@router.put("/projects/{project_id}/members")
async def add_member(project_id: uuid.UUID, body: MemberIn, db: DB, profile: Manager):
    await ops.writable_project(db, profile, project_id)
    person = await db.get(Profile, body.profile_id)
    if not person or not person.is_active:
        raise HTTPException(422, "Pengguna tidak aktif")
    member = await db.get(WorkspaceMember, (project_id, body.profile_id))
    if member:
        member.division = body.division.strip()
    else:
        db.add(WorkspaceMember(project_id=project_id, profile_id=body.profile_id, division=body.division.strip()))
    await ops.event(db, project_id, profile, "Anggota proyek diperbarui", payload={"name": person.full_name, "division": body.division}, recipients=[person.id])
    return {"ok": True}


@router.get("/projects/{project_id}/activity")
async def project_activity(project_id: uuid.UUID, db: DB, profile: Reader,
    offset: int = Query(default=0, ge=0), limit: int = Query(default=25, ge=1, le=100), q: str = Query(default="", max_length=200)):
    await _require_project_access(db, profile, project_id)
    query = select(WorkspaceEvent, Profile.full_name, Profile.avatar_url).outerjoin(Profile, WorkspaceEvent.actor_id == Profile.id).where(WorkspaceEvent.project_id == project_id)
    if q.strip():
        search = q.strip().lower()
        query = query.where(func.lower(WorkspaceEvent.action).contains(search, autoescape=True) | func.lower(Profile.full_name).contains(search, autoescape=True))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.order_by(WorkspaceEvent.created_at.desc(), WorkspaceEvent.id.desc()).offset(offset).limit(limit))).all()
    return {"total": total, "items": [{"id": str(event.id), "actor": name or "Sistem", "avatar_url": avatar,
        "action": event.action, "task_id": str(event.task_id) if event.task_id else None, "payload": event.payload,
        "created_at": ops.stamp(event.created_at)} for event, name, avatar in rows]}


@router.post("/projects/{project_id}/archive")
async def archive_project(project_id: uuid.UUID, db: DB, profile: Archiver, archive: bool = True):
    from app.routers.workspace_board import _lock_board
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, None)
    project = await db.get(WorkspaceProject, project_id, populate_existing=True)
    project.archived_at = ops.now() if archive else None
    board.version += 1
    await ops.event(db, project_id, profile, "Proyek diarsipkan" if archive else "Proyek dipulihkan")
    return {"ok": True}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: uuid.UUID, db: DB, profile: Manager,
    confirmation: str = Query(min_length=1, max_length=255)):
    """Delete an explicitly confirmed archived project, preserving warehouse ledgers."""
    from app.routers.workspace_board import _lock_board
    await _require_project_access(db, profile, project_id)
    await _lock_board(db, project_id, None)
    project = await db.get(WorkspaceProject, project_id, populate_existing=True)
    if not project.archived_at:
        raise HTTPException(409, "Arsipkan proyek sebelum menghapusnya")
    if confirmation.strip() != (project.rpo_number or project.name).strip():
        raise HTTPException(422, "Konfirmasi harus sama dengan nomor RPO atau nama proyek yang ditampilkan")
    requests = select(MaterialRequest.id).where(MaterialRequest.project_id == project_id)
    if await db.scalar(select(StockMovement.id).where(or_(StockMovement.project_id == project_id,
        StockMovement.material_request_id.in_(requests))).limit(1)):
        raise HTTPException(409, "Proyek memiliki transaksi gudang. Simpan di arsip agar riwayat stok tetap utuh.")
    # A stage restricts deletion while placements reference it. Clear those
    # references first, within the same transaction and board lock.
    stages = select(WorkspaceTaskStage.id).where(WorkspaceTaskStage.project_id == project_id)
    await db.execute(delete(WorkspaceTaskPlacement).where(WorkspaceTaskPlacement.stage_id.in_(stages)))
    await db.delete(project)
    await db.flush()
    return {"ok": True}


@router.put("/projects/{project_id}/work-controls/{task_id}")
async def save_control(project_id: uuid.UUID, task_id: uuid.UUID, body: ControlIn, db: DB, profile: Releaser):
    await ops.writable_project(db, profile, project_id)
    await project_task(db, project_id, task_id)
    await ops.active_member(db, project_id, body.pic_id)
    control = await db.get(WorkspaceWorkControl, task_id)
    if not control:
        control = WorkspaceWorkControl(task_id=task_id)
        db.add(control)
    for key, value in body.model_dump().items():
        setattr(control, key, value)
    control.released_at = control.released_by = None
    await ops.event(db, project_id, profile, "Persyaratan dan jadwal kerja diperbarui", task_id,
        {"division": body.division, "pic_id": str(body.pic_id), "drawing_required": body.drawing_required,
            "material_required": body.material_required, "planned_start": body.planned_start.isoformat(), "planned_end": body.planned_end.isoformat()}, [body.pic_id])
    return {"ok": True}


@router.post("/projects/{project_id}/work-controls/{task_id}/release")
async def release_work(project_id: uuid.UUID, task_id: uuid.UUID, body: ReleaseIn, db: DB, profile: Releaser):
    await ops.writable_project(db, profile, project_id)
    task = await project_task(db, project_id, task_id)
    records = await ops.project_records(db, project_id)
    control = records["controls"].get(task_id)
    if not control:
        raise HTTPException(409, "Atur PIC dan persyaratan terlebih dahulu")
    if body.release:
        state = ops.legacy_readiness(task, records)
        if not state["can_release"]:
            raise HTTPException(409, "; ".join(state["reasons"]))
        if not await planning.task_assignees(db, task):
            raise HTTPException(409, "Tetapkan pelaksana pekerjaan terlebih dahulu")
        control.released_by, control.released_at = profile.id, ops.now()
    else:
        control.released_by = control.released_at = None
    control.release_note = body.note.strip()
    await ops.event(db, project_id, profile, "Izin mulai diberikan" if body.release else "Izin mulai dicabut", task_id,
        {"name": task.name, "note": body.note}, await planning.task_assignees(db, task))
    return {"ok": True}


@router.post("/projects/{project_id}/documents", status_code=201)
async def publish_document(project_id: uuid.UUID, db: DB, profile: Publisher,
    file: UploadFile = File(...), code: str = Form(..., min_length=1, max_length=100),
    title: str = Form(..., min_length=1, max_length=255), kind: str = Form(..., min_length=1, max_length=80),
    task_id: uuid.UUID | None = Form(None), recipient_ids: str = Form(""), request_id: uuid.UUID | None = Form(None), archive_department: str | None = Form(None)):
    await ops.writable_project(db, profile, project_id)
    await project_task(db, project_id, task_id)
    code = code.strip().upper()
    if not code or not title.strip():
        raise HTTPException(422, "Kode dan judul dokumen wajib diisi")
    try:
        recipients = {uuid.UUID(v.strip()) for v in recipient_ids.split(",") if v.strip()}
    except ValueError:
        raise HTTPException(422, "Penerima dokumen tidak valid")
    for person_id in recipients:
        await ops.active_member(db, project_id, person_id)
    data = await file.read(10 * 1024 * 1024 + 1)
    if not data or len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Berkas harus berisi data, maksimal 10 MB")
    mime = file.content_type or "application/octet-stream"
    if mime not in archive.UPLOAD_MIMES:
        raise HTTPException(415, "Gunakan PDF, gambar, TXT, DOCX, XLSX atau berkas CAD")
    digest = hashlib.sha256(data).hexdigest()
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"document-revision:{project_id}:{code}"))))
    old = await db.get(WorkspaceDocument, request_id) if request_id else None
    if old:
        if (old.project_id, old.task_id, old.code, old.title, old.kind, old.sha256, old.author_id) != (project_id, task_id, code, title.strip(), kind, digest, profile.id):
            raise HTTPException(409, "ID penerbitan sudah dipakai untuk dokumen berbeda")
        return {"id": str(old.id), "revision": old.revision}
    revision = (await db.scalar(select(func.max(WorkspaceDocument.revision)).where(WorkspaceDocument.project_id == project_id, WorkspaceDocument.code == code)) or 0) + 1
    doc = WorkspaceDocument(id=request_id or uuid.uuid4(), project_id=project_id, task_id=task_id, code=code, title=title.strip(), kind=kind,
        revision=revision, filename=PurePosixPath((file.filename or "dokumen").replace("\\", "/")).name[:255],
        mime=mime, size=len(data), content=data, sha256=digest, author_id=profile.id)
    db.add(doc)
    await db.flush()
    await archive.archive_document(db, doc, profile, data, archive_department)
    db.add_all([WorkspaceDocumentReceipt(document_id=doc.id, profile_id=key) for key in recipients])
    await ops.invalidate_releases(db, project_id, task_id)
    await ops.event(db, project_id, profile, "Dokumen diterbitkan", task_id, {"name": doc.title, "code": code, "revision": revision}, recipients)
    return {"id": str(doc.id), "revision": revision}


async def scoped_document(db, profile, document_id, write=False):
    doc = await db.get(WorkspaceDocument, document_id)
    if not doc:
        raise HTTPException(404, "Dokumen tidak ditemukan")
    if write:
        await ops.writable_project(db, profile, doc.project_id)
        doc = await db.get(WorkspaceDocument, document_id, populate_existing=True)
    else:
        await _require_project_access(db, profile, doc.project_id)
    return doc


@router.get("/projects/{project_id}/upload-destination")
async def upload_destination(project_id: uuid.UUID, db: DB, profile: Reader, document_id: uuid.UUID | None = None):
    project = await _require_project_access(db, profile, project_id)
    uploader = profile
    if document_id:
        doc = await scoped_document(db, profile, document_id)
        if doc.project_id != project_id:
            raise HTTPException(404, "Dokumen tidak termasuk proyek ini")
        uploader = await db.get(Profile, doc.author_id)
    return await archive.destination(db, uploader, project)


class ArchiveIn(BaseModel):
    department: str | None = Field(default=None, max_length=50)


@router.post("/project-documents/{document_id}/archive")
async def archive_existing_document(document_id: uuid.UUID, body: ArchiveIn, db: DB, profile: Reader):
    if not archive.enabled():
        raise HTTPException(503, "Arsip Project ke Drive belum diaktifkan")
    doc = await scoped_document(db, profile, document_id, True)
    if doc.author_id != profile.id and not (await _can(db, profile, "workspace:manage") or await _can(db, profile, "workspace:publish_document")):
        raise HTTPException(403, "Hanya penerbit atau pengelola yang dapat memindahkan lampiran")
    content = await archive.document_content(db, doc)
    uploader = await db.get(Profile, doc.author_id)
    await archive.archive_document(db, doc, uploader, content, body.department)
    await ops.event(db, doc.project_id, profile, "Dokumen disimpan ke Drive", doc.task_id, {"name": doc.title})
    return {"ok": True}


@router.post("/project-documents/{document_id}/approval")
async def approve_document(document_id: uuid.UUID, body: ApprovalIn, db: DB, profile: Approver):
    doc = await scoped_document(db, profile, document_id, True)
    latest = await db.scalar(select(func.max(WorkspaceDocument.revision)).where(WorkspaceDocument.project_id == doc.project_id, WorkspaceDocument.code == doc.code))
    if latest != doc.revision or doc.status != "review":
        raise HTTPException(409, "Hanya revisi terbaru yang menunggu persetujuan dapat diproses")
    doc.status = body.decision
    doc.approved_by, doc.approved_at = profile.id, ops.now()
    doc.client_approved = body.client_approved and body.decision == "approved"
    doc.approval_evidence = body.evidence.strip()
    recipients = (await db.scalars(select(WorkspaceDocumentReceipt.profile_id).where(WorkspaceDocumentReceipt.document_id == doc.id))).all()
    await ops.event(db, doc.project_id, profile, "Dokumen disetujui" if doc.status == "approved" else "Dokumen ditolak", doc.task_id,
        {"name": doc.title, "revision": doc.revision, "evidence": body.evidence, "client_approved": doc.client_approved}, recipients)
    return {"ok": True}


@router.post("/project-documents/{document_id}/acknowledge")
async def acknowledge_document(document_id: uuid.UUID, db: DB, profile: Reader):
    doc = await scoped_document(db, profile, document_id, True)
    receipt = await db.get(WorkspaceDocumentReceipt, (document_id, profile.id))
    if not receipt:
        raise HTTPException(403, "Anda tidak terdaftar sebagai penerima dokumen")
    if doc.status != "approved":
        raise HTTPException(409, "Tanda terima hanya untuk dokumen yang sudah disetujui")
    if not receipt.acknowledged_at:
        receipt.acknowledged_at = ops.now()
        await ops.event(db, doc.project_id, profile, "Dokumen diterima dan dibaca", doc.task_id,
            {"name": doc.title, "revision": doc.revision}, [doc.author_id])
    return {"ok": True}


@router.post("/project-documents/{document_id}/recipients")
async def add_document_recipients(document_id: uuid.UUID, body: RecipientsIn, db: DB, profile: Publisher):
    doc = await scoped_document(db, profile, document_id, True)
    latest = await db.scalar(select(func.max(WorkspaceDocument.revision)).where(WorkspaceDocument.project_id == doc.project_id, WorkspaceDocument.code == doc.code))
    if latest != doc.revision:
        raise HTTPException(409, "Tambahkan penerima pada revisi terbaru")
    added = []
    for key in set(body.profile_ids):
        await ops.active_member(db, doc.project_id, key)
        if not await db.get(WorkspaceDocumentReceipt, (doc.id, key)):
            db.add(WorkspaceDocumentReceipt(document_id=doc.id, profile_id=key))
            added.append(key)
    if added:
        await ops.invalidate_releases(db, doc.project_id, doc.task_id)
        await ops.event(db, doc.project_id, profile, "Penerima dokumen ditambahkan", doc.task_id,
            {"name": doc.title, "revision": doc.revision}, added)
    return {"ok": True}


@router.get("/project-documents/{document_id}/download")
async def download_document(document_id: uuid.UUID, db: DB, profile: Reader):
    doc = await scoped_document(db, profile, document_id)
    content = await archive.document_content(db, doc)
    return Response(content, media_type="application/octet-stream", headers={
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(doc.filename, safe=""),
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.put("/project-documents/{document_id}/work-order")
async def link_document(document_id: uuid.UUID, body: TaskLinkIn, db: DB, profile: Reader):
    doc = await scoped_document(db, profile, document_id, True)
    if doc.author_id != profile.id and not (await _can(db, profile, "workspace:publish_document") or await _can(db, profile, "workspace:manage")):
        raise HTTPException(403, "Hanya penerbit atau pengelola yang dapat menautkan dokumen")
    await project_task(db, doc.project_id, body.task_id)
    if doc.attachment_id:
        log = await db.scalar(select(WorkspaceWorkLog).join(WorkspaceWorkLogAttachment, WorkspaceWorkLogAttachment.log_id == WorkspaceWorkLog.id)
            .where(WorkspaceWorkLogAttachment.attachment_id == doc.attachment_id))
        if log and log.task_id != body.task_id:
            raise HTTPException(409, "Dokumentasi logbook mengikuti WO tempat logbook dicatat")
        attachment = await db.get(WorkspaceAttachment, doc.attachment_id)
        if body.task_id:
            attachment.task_id = body.task_id
        elif not log:
            # Keep the source bytes on the original WO; document visibility follows its explicit link.
            raise HTTPException(422, "Lampiran WO harus tetap ditautkan ke salah satu WO proyek")
    doc.task_id = body.task_id
    await archive.sync_document_reference(db, doc)
    if body.task_id:
        task = await db.get(WorkspaceTask, body.task_id)
        for key in await planning.task_assignees(db, task):
            if not await db.get(WorkspaceDocumentReceipt, (doc.id, key)):
                db.add(WorkspaceDocumentReceipt(document_id=doc.id, profile_id=key))
    await ops.event(db, doc.project_id, profile, "Dokumen ditautkan ke WO", body.task_id, {"name": doc.title})
    return {"ok": True}


@router.put("/project-issues/{issue_id}/work-order")
async def link_issue(issue_id: uuid.UUID, body: TaskLinkIn, db: DB, profile: Reader):
    issue = await scoped_issue(db, profile, issue_id)
    if profile.id not in {issue.author_id, issue.pic_id} and not (await _can(db, profile, "workspace:verify_issue") or await _can(db, profile, "workspace:manage")):
        raise HTTPException(403, "Hanya pencatat atau pengelola yang dapat menautkan kendala")
    await project_task(db, issue.project_id, body.task_id)
    if issue.source_log_id:
        log = await db.get(WorkspaceWorkLog, issue.source_log_id)
        if log.task_id != body.task_id:
            raise HTTPException(409, "Kendala dari logbook mengikuti WO asalnya")
    issue.task_id = body.task_id
    await ops.event(db, issue.project_id, profile, "Kendala ditautkan ke WO", body.task_id, {"name": issue.title})
    return {"ok": True}


@router.post("/projects/{project_id}/issues", status_code=201)
async def create_issue(project_id: uuid.UUID, body: IssueIn, db: DB, profile: Reader):
    await ops.writable_project(db, profile, project_id)
    await project_task(db, project_id, body.task_id)
    await ops.active_member(db, project_id, body.pic_id)
    old = await db.get(WorkspaceIssue, body.request_id)
    if old:
        if old.project_id != project_id or old.author_id != profile.id or any(getattr(old,k) != v for k,v in body.model_dump(exclude={"request_id"}).items()):
            raise HTTPException(409, "ID catatan sudah digunakan untuk data berbeda")
        return {"id": str(old.id)}
    issue = WorkspaceIssue(id=body.request_id, project_id=project_id, author_id=profile.id, **body.model_dump(exclude={"request_id"}))
    db.add(issue)
    if body.kind == "blocker":
        await ops.invalidate_releases(db, project_id, body.task_id)
    await ops.event(db, project_id, profile, "Kendala dicatat" if body.kind == "blocker" else "Punch List dicatat", body.task_id,
        {"name": body.title, "due_date": str(body.due_date)}, [body.pic_id])
    await db.flush()
    return {"id": str(issue.id)}


async def scoped_issue(db, profile, issue_id):
    issue = await db.get(WorkspaceIssue, issue_id)
    if not issue:
        raise HTTPException(404, "Catatan tidak ditemukan")
    await ops.writable_project(db, profile, issue.project_id)
    return await db.get(WorkspaceIssue, issue_id, populate_existing=True)


@router.post("/project-issues/{issue_id}/resolve")
async def resolve_issue(issue_id: uuid.UUID, body: ResolutionIn, db: DB, profile: Reader):
    issue = await scoped_issue(db, profile, issue_id)
    if profile.id != issue.pic_id and not await _can(db, profile, "workspace:verify_issue"):
        raise HTTPException(403, "Hanya PIC atau pemeriksa yang dapat mengisi penyelesaian")
    if issue.status != "open":
        raise HTTPException(409, "Catatan sudah diproses")
    issue.status, issue.resolved_at = "resolved", ops.now()
    issue.resolution, issue.evidence = body.resolution.strip(), body.evidence.strip()
    await ops.event(db, issue.project_id, profile, "Penyelesaian menunggu verifikasi", issue.task_id,
        {"name": issue.title, "resolution": issue.resolution, "evidence": issue.evidence})
    return {"ok": True}


@router.post("/project-issues/{issue_id}/verify")
async def verify_issue(issue_id: uuid.UUID, db: DB, profile: Verifier, accept: bool = True):
    issue = await scoped_issue(db, profile, issue_id)
    if issue.status != "resolved":
        raise HTTPException(409, "PIC harus mengisi penyelesaian dan bukti terlebih dahulu")
    issue.status = "verified" if accept else "open"
    issue.verified_by = profile.id if accept else None
    issue.verified_at = ops.now() if accept else None
    await ops.event(db, issue.project_id, profile, "Penyelesaian diverifikasi" if accept else "Penyelesaian dikembalikan", issue.task_id,
        {"name": issue.title}, [issue.pic_id])
    return {"ok": True}


async def visible_records(db, profile):
    visible = await _visible_project_ids(db, profile)
    query = select(WorkspaceProject.id).where(WorkspaceProject.archived_at.is_(None))
    if visible is not None:
        query = query.where(WorkspaceProject.id.in_(visible))
    return await ops.records_for_projects(db, (await db.scalars(query)).all())


@router.get("/operations/summary")
async def operations_summary(db: DB, profile: Reader):
    records = await visible_records(db, profile)
    names = dict((await db.execute(select(Profile.id, Profile.full_name))).all())
    today = planning.local_today()
    work, issues, documents, materials = [], [], [], []
    counts = {"active_projects": 0, "late_projects": 0, "ready": 0, "blocked": 0, "review": 0,
        "document_approvals": 0, "pending_receipts": 0, "material_shortages": 0, "open_issues": 0}
    projects = []
    for project_id, record in records.items():
        project = record["project"]
        open_project = project.status.value != "completed"
        counts["active_projects"] += open_project
        late = open_project and bool(project.deadline and project.deadline < today)
        counts["late_projects"] += late
        total = sum(t.status != TaskStatus.cancelled for t in record["tasks"])
        done = sum(t.status == TaskStatus.done for t in record["tasks"])
        projects.append({"id": str(project.id), "name": project.name, "rpo_number": project.rpo_number,
            "client_name": project.client_name, "deadline": ops.stamp(project.deadline), "late": late,
            "progress": round(done/total*100) if total else 0, "status": project.status.value})
        for task in record["tasks"]:
            if task.status in {TaskStatus.done, TaskStatus.cancelled}:
                continue
            state = ops.readiness(task, record)
            counts["review"] += task.status == TaskStatus.pending_review
            counts["ready"] += state["ready"] and task.status in {TaskStatus.todo, TaskStatus.overdue}
            counts["blocked"] += not state["ready"]
            control = record["controls"].get(task.id)
            work.append({**state, "name": task.name, "project_id": str(project_id), "project": project.name,
                "pic": names.get(task.assigned_to),
                "deadline": ops.stamp(task.deadline), "status": task.status.value})
        for issue in record["issues"]:
            if issue.kind == "blocker" and issue.status != "verified":
                counts["open_issues"] += 1
                issues.append({"id": str(issue.id), "project_id": str(project_id), "project": project.name,
                    "title": issue.title, "kind": issue.kind, "pic": names.get(issue.pic_id), "due_date": str(issue.due_date),
                    "status": issue.status, "waiting_hours": round((ops.now()-issue.created_at).total_seconds()/3600,1)})
        for doc in record["latest"]:
            pending = [r for r in record["receipts"][doc.id] if not r.acknowledged_at]
            counts["document_approvals"] += doc.status == "review"
            counts["pending_receipts"] += sum(r.profile_id == profile.id for r in pending)
            documents.append({"id": str(doc.id), "project_id": str(project_id), "project": project.name, "title": doc.title,
                "revision": doc.revision, "status": doc.status, "created_at": ops.stamp(doc.created_at), "awaiting_me": any(r.profile_id == profile.id for r in pending)})
        for material in record["materials"]:
            if material.status not in {"stock", "received"} and material.quantity > material.reserved + material.issued:
                counts["material_shortages"] += 1
                materials.append({"id": str(material.id), "project_id": str(project_id), "project": project.name,
                    "item_id": str(material.item_id), "shortage": float(material.quantity-material.reserved-material.issued),
                    "status": material.status, "eta": ops.stamp(material.eta)})
    work.sort(key=lambda t: (t["ready"], t["deadline"] or "9999"))
    issues.sort(key=lambda i: i["due_date"])
    documents.sort(key=lambda doc: doc["created_at"], reverse=True)
    projects.sort(key=lambda p: (not p["late"], p["deadline"] or "9999"))
    return {"counts": counts, "projects": projects[:12], "work": work[:12], "issues": issues[:8], "documents": documents[:8], "materials": materials[:8]}


@router.get("/operations/manpower")
async def manpower(db: DB, profile: Reader):
    records = await visible_records(db, profile)
    all_tasks = [t for r in records.values() for t in r["tasks"]]
    task_ids = [t.id for t in all_tasks]
    estimates = dict((await db.execute(select(WorkspaceTaskPlan.task_id, WorkspaceTaskPlan.estimated_minutes)
        .where(WorkspaceTaskPlan.task_id.in_(task_ids)))).all())
    logged = dict((await db.execute(select(WorkspaceTimeEntry.task_id, func.sum(WorkspaceTimeEntry.minutes))
        .where(WorkspaceTimeEntry.task_id.in_(task_ids)).group_by(WorkspaceTimeEntry.task_id))).all())
    people = (await db.scalars(select(Profile).where(Profile.is_active.is_(True)).order_by(Profile.full_name))).all()
    rows = []
    view_all = await _can(db, profile, "workspace:view_all")
    for person in people:
        jobs = []
        for project_id, record in records.items():
            for task in record["tasks"]:
                if task.status in {TaskStatus.done, TaskStatus.cancelled} or person.id not in record["assignments"][task.id]:
                    continue
                control = record["controls"].get(task.id)
                jobs.append({"task_id": str(task.id), "name": task.name, "project_id": str(project_id), "project": record["project"].name,
                    "division": control.division if control else "Belum diatur", "pic": str(control.pic_id) if control and control.pic_id else None,
                    "start": ops.stamp(control.planned_start) if control else None, "end": ops.stamp(control.planned_end) if control else None,
                    "estimated_minutes": estimates.get(task.id, 0), "actual_minutes": logged.get(task.id, 0),
                    "state": ops.readiness(task, record)["state"]})
        conflicts = set()
        for i, first in enumerate(jobs):
            for second in jobs[i+1:]:
                if first["start"] and second["start"] and first["start"] < second["end"] and second["start"] < first["end"]:
                    conflicts.update([first["task_id"], second["task_id"]])
        if jobs or view_all:
            rows.append({"id": str(person.id), "name": person.full_name, "role": person.role.value,
                "jobs": [{**j, "conflict": j["task_id"] in conflicts} for j in jobs], "conflicts": len(conflicts)})
    return rows
