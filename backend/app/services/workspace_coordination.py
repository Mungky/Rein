"""One readiness calculation for the dashboard, project screen and WO execution."""
import os
from datetime import datetime, timezone
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import select

from db.models.profile import Profile
from db.models.workspace import WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskStatus
from db.models.workspace_project import WorkspaceTaskDependency, WorkspaceTaskAssignee
from db.models.workspace_coordination import (WorkspaceMember, WorkspaceWorkControl, WorkspaceDocument,
    WorkspaceDocumentReceipt, WorkspaceIssue, MaterialRequest, MaterialItem)
from app.services import workspace_project as planning

DRAWING_KINDS = {"Gambar Detail", "Gambar Proses", "Wiring Diagram", "Gambar Fabrikasi"}


def enabled():
    return os.getenv("WORKSPACE_COORDINATION_ENABLED") == "1"


def stamp(value):
    return value.isoformat() if value else None


async def project_records(db, project_id):
    return (await records_for_projects(db, [project_id]))[project_id]


async def records_for_projects(db, project_ids):
    projects = (await db.scalars(select(WorkspaceProject).where(WorkspaceProject.id.in_(project_ids)))).all()
    rows = (await db.execute(select(WorkspaceTask, WorkspacePhase.project_id).join(WorkspacePhase).where(WorkspacePhase.project_id.in_(project_ids)))).all()
    tasks = [t for t, _ in rows]
    task_projects = {t.id: key for t, key in rows}
    controls = {r.task_id: r for r in (await db.scalars(select(WorkspaceWorkControl).where(WorkspaceWorkControl.task_id.in_([t.id for t in tasks])))).all()}
    docs = (await db.scalars(select(WorkspaceDocument).where(WorkspaceDocument.project_id.in_(project_ids))
        .order_by(WorkspaceDocument.code, WorkspaceDocument.revision.desc()))).all()
    latest = {}
    for doc in docs:
        latest.setdefault((doc.project_id, doc.code), doc)
    receipts = defaultdict(list)
    for row in (await db.scalars(select(WorkspaceDocumentReceipt).where(WorkspaceDocumentReceipt.document_id.in_([d.id for d in docs])))).all():
        receipts[row.document_id].append(row)
    issues = (await db.scalars(select(WorkspaceIssue).where(WorkspaceIssue.project_id.in_(project_ids)))).all()
    materials = (await db.scalars(select(MaterialRequest).where(MaterialRequest.project_id.in_(project_ids)))).all()
    dependencies = (await db.scalars(select(WorkspaceTaskDependency).where(WorkspaceTaskDependency.task_id.in_([t.id for t in tasks])))).all()
    assignments = defaultdict(set)
    for row in (await db.scalars(select(WorkspaceTaskAssignee).where(WorkspaceTaskAssignee.task_id.in_([t.id for t in tasks])))).all():
        assignments[row.task_id].add(row.profile_id)
    for task in tasks:
        if task.assigned_to:
            assignments[task.id].add(task.assigned_to)
    return {p.id: dict(project=p, tasks=[t for t in tasks if task_projects[t.id] == p.id], controls=controls,
        documents=[d for d in docs if d.project_id == p.id], latest=[d for d in latest.values() if d.project_id == p.id],
        receipts=receipts, issues=[i for i in issues if i.project_id == p.id], materials=[m for m in materials if m.project_id == p.id],
        dependencies=dependencies, states={t.id:t.status for t in tasks}, assignments=assignments) for p in projects}


def legacy_readiness(task, records):
    control = records["controls"].get(task.id)
    reasons = []
    if not records["assignments"][task.id]:
        reasons.append("Pelaksana belum ditetapkan")
    if any(d.task_id == task.id and records["states"].get(d.predecessor_id) != TaskStatus.done for d in records["dependencies"]):
        reasons.append("Pekerjaan prasyarat belum selesai")
    if records["project"].archived_at:
        reasons.append("Proyek diarsipkan")
    if records["project"].status.value in {"on_hold", "completed"}:
        reasons.append("Proyek ditunda atau sudah selesai")
    if not control:
        reasons.append("PIC, jadwal dan persyaratan kerja belum diatur")
    else:
        if not control.pic_id:
            reasons.append("PIC belum ditetapkan")
        if not control.planned_start or not control.planned_end:
            reasons.append("Jadwal mulai dan selesai belum ditetapkan")
        applicable = [d for d in records["latest"] if d.task_id in (None, task.id)]
        if control.drawing_required:
            drawings = [d for d in applicable if d.kind in DRAWING_KINDS]
            if not drawings:
                reasons.append("Gambar acuan belum diterbitkan")
            elif any(d.status != "approved" or not d.client_approved for d in drawings):
                reasons.append("Revisi gambar terbaru belum disetujui internal dan klien")
            if any(records["assignments"][task.id] - {r.profile_id for r in records["receipts"][d.id]} for d in drawings):
                reasons.append("Gambar acuan belum ditujukan ke semua pelaksana pekerjaan")
        pending = [r for d in applicable if d.status == "approved" for r in records["receipts"][d.id] if not r.acknowledged_at]
        if pending:
            reasons.append(f"{len(pending)} tanda terima dokumen belum dikonfirmasi")
        if control.material_required:
            needed = [m for m in records["materials"] if m.task_id in (None, task.id)]
            if not needed:
                reasons.append("Kebutuhan material belum dicatat")
            elif any(m.reserved + m.issued < m.quantity for m in needed):
                reasons.append("Material belum lengkap / belum dialokasikan gudang")
    blockers = [i for i in records["issues"] if i.kind == "blocker" and i.status != "verified" and i.task_id in (None, task.id)]
    if blockers:
        reasons.append(f"{len(blockers)} kendala belum diverifikasi selesai")
    released = bool(control and control.released_at)
    return {"task_id": str(task.id), "can_release": not reasons, "released": released,
        "ready": not reasons and released, "reasons": reasons + ([] if released else ["Belum ada izin mulai pekerjaan"]),
        "state": "Selesai" if task.status == TaskStatus.done else "Pemeriksaan" if task.status == TaskStatus.pending_review
            else "Terhambat" if reasons else "Dikerjakan" if task.status == TaskStatus.in_progress else "Siap Dikerjakan" if released else "Belum Siap"}


def readiness(task, records):
    reasons = []
    project = records["project"]
    if not records["assignments"][task.id]:
        reasons.append("PIC belum ditetapkan")
    if project.archived_at:
        reasons.append("Proyek diarsipkan")
    if project.status.value in {"on_hold", "completed"}:
        reasons.append("Proyek ditunda atau sudah selesai")
    state = {"todo": "To Do", "overdue": "To Do", "in_progress": "On Progress",
        "pending_review": "Need Review", "done": "Finish", "cancelled": "Cancelled"}[task.status.value]
    return {"task_id": str(task.id), "can_release": not reasons, "released": not reasons,
        "ready": not reasons, "reasons": reasons, "state": state}


async def require_operational_ready(db, task, *, completing=False):
    if not enabled():
        return
    project_id = await planning.task_project_id(db, task)
    records = await project_records(db, project_id)
    state = readiness(task, records)
    if not state["ready"]:
        raise HTTPException(409, "; ".join(state["reasons"]))


async def active_member(db, project_id, profile_id):
    profile = await db.get(Profile, profile_id)
    if not profile or not profile.is_active:
        raise HTTPException(422, "Pengguna tidak ditemukan atau tidak aktif")
    project = await db.get(WorkspaceProject, project_id)
    if project.manager_id == profile_id or await db.get(WorkspaceMember, (project_id, profile_id)):
        return profile
    assigned = await db.scalar(select(WorkspaceTask.id).join(WorkspacePhase)
        .where(WorkspacePhase.project_id == project_id, planning.assignment_filter(profile_id)).limit(1))
    if not assigned:
        raise HTTPException(422, "Tambahkan pengguna sebagai anggota proyek terlebih dahulu")
    return profile


async def invalidate_releases(db, project_id, task_id=None):
    from sqlalchemy import update
    ids = select(WorkspaceTask.id).join(WorkspacePhase).where(WorkspacePhase.project_id == project_id)
    if task_id:
        ids = ids.where(WorkspaceTask.id == task_id)
    await db.execute(update(WorkspaceWorkControl).where(WorkspaceWorkControl.task_id.in_(ids))
        .values(released_by=None, released_at=None))


async def writable_project(db, profile, project_id):
    from app.routers.workspace import _require_project_access
    from app.routers.workspace_board import _lock_board
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, None)
    project = await db.get(WorkspaceProject, project_id, populate_existing=True)
    if project.archived_at:
        raise HTTPException(409, "Pulihkan proyek dari arsip sebelum mengubah data")
    board.version += 1
    return project


async def event(db, project_id, profile, action, task_id=None, payload=None, recipients=()):
    await planning.record_event(db, project_id, profile.id, action, task_id, payload, recipients)


def now():
    return datetime.now(timezone.utc)
