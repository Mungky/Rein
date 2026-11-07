"""Digital Library — admin activity, maintenance, sequences, folder permissions.

Split from the original monolithic library.py; section code is verbatim.
Imports mirror the original file (superset; unused ones are harmless).
"""

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_current_profile, require_role
from app.limiter import limiter
from app.services.email import send_email
from db.models.audit_job import AuditJob, LAYER_NAMES
from db.models.library_audit_log import (
    LibraryAuditLog,
    LOG_AUDIT_FAIL,
    LOG_AUDIT_PASS,
    LOG_CANCEL,
    LOG_CONFIRM,
    LOG_FILE_DELETE,
    LOG_FOLDER_CREATE,
    LOG_PROPOSE,
    LOG_UPLOAD,
    LOG_VIEW_APPROVED,
    LOG_VIEW_DENIED,
    LOG_VIEW_EXPIRED,
    LOG_VIEW_REQUEST,
)
from db.models.file_type import FileType
from db.models.library_file import LibraryFile, LibraryFileStatus
from db.models.document_sequence import DocumentSequence, KNOWN_DOC_TYPES, DOC_TYPE_LABELS
from db.models.folder_permission import FolderPermission
from db.models.library_folder import (
    DEPT_LABELS,
    DEPT_ROLE_MAP,
    LIBRARIAN_ROLES,
    FolderType,
    LibraryFolder,
)
from db.models.profile import AppRole, Profile
from db.models.view_request import VIEW_REQUEST_TTL_SECONDS, ViewRequest
from db.session import get_db

from ._shared import (  # noqa: F401
    ALLOWED_EXTENSIONS,
    LINK_TTL_MINUTES,
    MAX_FILE_SIZE,
    logger,
    router,
    _build_filename,
    _can_create_folder_in,
    _can_delete_folder_in,
    _can_delete_in,
    _can_download_from,
    _can_move_in,
    _can_rename_folder_in,
    _can_rename_in,
    _can_upload_to,
    _can_view_dept,
    _file_meta,
    _has_folder_perm,
    _html_page,
    _is_librarian,
    _redact_email,
    _sanitize_filename,
    _strip_ext,
    _write_log,
)

# ---------------------------------------------------------------------------
# GET /api/library/admin/temp   (admin only)
# ---------------------------------------------------------------------------

@router.get("/admin/activity", dependencies=[Depends(require_role(AppRole.admin))])
async def get_admin_activity(
    db: Annotated[AsyncSession, Depends(get_db)],
    search: str | None = Query(None, description="Cari di nama file, uploader, atau username"),
    action: str | None = Query(None, description="Filter berdasarkan jenis aksi"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Merged activity timeline — replaces /admin/temp.

    Returns audit log entries enriched with actor name + current file status
    (for entries that reference a file). The frontend renders this as a single
    timeline with optional status dots for in-progress files.
    """
    offset = (page - 1) * page_size

    base_q = (
        select(LibraryAuditLog, Profile)
        .outerjoin(Profile, LibraryAuditLog.actor_id == Profile.id)
    )

    where_clauses = []
    if action:
        where_clauses.append(LibraryAuditLog.action == action)
    if search:
        pattern = f"%{search.lower()}%"
        where_clauses.append(
            sa_text(
                "lower(coalesce(library_audit_log.metadata->>'filename', '')) LIKE :pat "
                "OR lower(coalesce(profiles.full_name, '')) LIKE :pat "
                "OR lower(coalesce(profiles.username, '')) LIKE :pat"
            ).bindparams(pat=pattern)
        )
    if where_clauses:
        base_q = base_q.where(*where_clauses)

    count_q = select(func.count()).select_from(base_q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows_result = await db.execute(
        base_q.order_by(LibraryAuditLog.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    raw = rows_result.all()

    # Collect file targets to hydrate with current status + audit layers
    file_ids = [log.target_id for log, _ in raw if log.target_type == "file" and log.target_id]
    files_by_id: dict[uuid.UUID, LibraryFile] = {}
    jobs_by_file: dict[uuid.UUID, list[dict]] = {}
    if file_ids:
        files_result = await db.execute(
            select(LibraryFile).where(LibraryFile.id.in_(file_ids))
        )
        files_by_id = {f.id: f for f in files_result.scalars().all()}

        jobs_result = await db.execute(
            select(AuditJob).where(AuditJob.file_id.in_(file_ids)).order_by(AuditJob.layer)
        )
        for j in jobs_result.scalars().all():
            jobs_by_file.setdefault(j.file_id, []).append({
                "layer": j.layer,
                "layer_name": j.layer_name,
                "status": j.status,
            })

    entries = []
    for log, actor in raw:
        meta = log.log_metadata or {}
        file_for_log = files_by_id.get(log.target_id) if log.target_id else None
        entries.append({
            "id": log.id,
            "action": log.action,
            "actor_name": actor.full_name if actor else None,
            "actor_username": actor.username if actor else None,
            "actor_role": actor.role.value if actor else None,
            "target_type": log.target_type,
            "target_id": str(log.target_id) if log.target_id else None,
            "file_name": (
                file_for_log.file_name or file_for_log.original_name
                if file_for_log else meta.get("filename")
            ),
            "file_status": file_for_log.upload_status.value if file_for_log else None,
            "audit_layers": jobs_by_file.get(log.target_id, []) if log.target_id else [],
            "meta": meta,
            "created_at": log.created_at.isoformat(),
        })

    # Detect dead-letter: files stuck in uploading > 10 min (admin should reset)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    stuck_result = await db.execute(
        select(func.count(LibraryFile.id)).where(
            LibraryFile.upload_status == LibraryFileStatus.uploading,
            LibraryFile.is_deleted.is_(False),
            LibraryFile.created_at < cutoff,
        )
    )
    stuck_count = stuck_result.scalar() or 0

    # Count failed rows the admin may want to bulk-purge
    failed_result = await db.execute(
        select(func.count(LibraryFile.id)).where(
            LibraryFile.upload_status == LibraryFileStatus.failed,
            LibraryFile.is_deleted.is_(False),
        )
    )
    failed_count = failed_result.scalar() or 0

    return {
        "entries": entries,
        "total": total,
        "page": page,
        "page_size": page_size,
        "stuck_count": stuck_count,
        "failed_count": failed_count,
        "email_configured": bool(
            (settings.librarian_emails or settings.smtp_from)
            and settings.smtp_user
            and settings.smtp_password
        ),
    }


# ---------------------------------------------------------------------------
# POST /api/library/admin/reset-stuck   (admin only)
# Resets files stuck in "uploading" for longer than 15 minutes to "failed"
# ---------------------------------------------------------------------------

@router.post("/admin/reset-stuck", dependencies=[Depends(require_role(AppRole.admin))])
async def reset_stuck_uploads(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    minutes: int = Query(10, ge=1, le=1440, description="Cutoff dalam menit (default 10)"),
):
    """Mark stuck 'uploading' / 'in_audit' files older than `minutes` as 'failed'.

    Surfaces both how many were reset and which files (so admin can decide
    whether to fully delete the records via Hapus Permanen).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.upload_status.in_([
                LibraryFileStatus.uploading,
                LibraryFileStatus.in_audit,
            ]),
            LibraryFile.is_deleted.is_(False),
            LibraryFile.created_at < cutoff,
        )
    )
    stuck = result.scalars().all()
    affected = []
    for f in stuck:
        affected.append({"id": str(f.id), "file_name": f.file_name or f.original_name})
        f.upload_status = LibraryFileStatus.failed

    if stuck:
        await _write_log(
            db, profile, "reset_stuck", target_type=None, target_id=None,
            metadata={"count": len(stuck), "cutoff_minutes": minutes},
        )
    await db.commit()
    return {"reset_count": len(stuck), "files": affected}


@router.post("/admin/purge-failed", dependencies=[Depends(require_role(AppRole.admin))])
async def purge_all_failed(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Hard-remove ALL failed / stuck records from DB in one call.

    Trashes any orphan Drive files attached to those rows (best-effort; a
    Drive failure for one file does not abort the others). Use this when
    a batch upload partially failed and left behind ghost rows that show
    up in the activity log but never landed in Drive.
    """
    from app.services import gdrive

    result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.upload_status.in_([
                LibraryFileStatus.failed,
                LibraryFileStatus.uploading,
                LibraryFileStatus.in_audit,
            ]),
            LibraryFile.is_deleted.is_(False),
        )
    )
    rows = result.scalars().all()

    purged = []
    drive_trash_failed = 0
    for f in rows:
        if f.gdrive_file_id:
            try:
                await gdrive.trash_file(f.gdrive_file_id)
            except Exception as exc:
                drive_trash_failed += 1
                logger.warning(
                    "Bulk purge: failed to trash Drive file %s: %s",
                    f.gdrive_file_id, exc,
                )
        await db.execute(
            sa_text("DELETE FROM audit_jobs WHERE file_id = :fid"),
            {"fid": f.id},
        )
        purged.append({
            "id": str(f.id),
            "file_name": f.file_name or f.original_name,
            "status": f.upload_status.value,
        })
        await db.delete(f)

    if purged:
        await _write_log(
            db, profile, "purge_temp_file", target_type=None, target_id=None,
            metadata={"bulk": True, "count": len(purged), "drive_trash_failed": drive_trash_failed},
        )
    await db.commit()
    return {
        "purged_count": len(purged),
        "drive_trash_failed": drive_trash_failed,
        "files": purged,
    }


@router.delete("/admin/temp/{file_id}", dependencies=[Depends(require_role(AppRole.admin))])
async def purge_temp_file(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Hard-remove a failed/stuck record from DB (and trash any orphan Drive file).

    Use this when reset-stuck flipped a record to failed but you want it gone
    from the temp/activity list entirely.
    """
    result = await db.execute(select(LibraryFile).where(LibraryFile.id == file_id))
    lib_file = result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    if lib_file.upload_status not in (LibraryFileStatus.failed, LibraryFileStatus.uploading, LibraryFileStatus.in_audit):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Hanya record gagal / stuck yang dapat dihapus dari panel temp",
        )

    # Trash any orphan Drive file
    if lib_file.gdrive_file_id:
        from app.services import gdrive
        try:
            await gdrive.trash_file(lib_file.gdrive_file_id)
        except Exception as exc:
            logger.warning("Failed to trash orphan Drive file %s: %s", lib_file.gdrive_file_id, exc)

    # Delete audit_jobs first to satisfy FK
    await db.execute(sa_text("DELETE FROM audit_jobs WHERE file_id = :fid"), {"fid": file_id})
    await db.delete(lib_file)

    await _write_log(db, profile, "purge_temp_file", "file", file_id,
                     metadata={"filename": lib_file.file_name})
    await db.commit()
    return {"id": str(file_id), "deleted": True}


# ---------------------------------------------------------------------------
# GET /api/library/sequences   (admin only)
# ---------------------------------------------------------------------------

@router.get("/sequences", dependencies=[Depends(require_role(AppRole.admin))])
async def list_sequences(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all doc_type sequence counters."""
    result = await db.execute(
        select(DocumentSequence).order_by(DocumentSequence.doc_type)
    )
    rows = result.scalars().all()
    seqs = {r.doc_type: r.current_number for r in rows}
    # Include any known types not yet in DB
    for dt in KNOWN_DOC_TYPES:
        if dt not in seqs:
            seqs[dt] = 0
    return {
        "sequences": [
            {
                "doc_type": dt,
                "label": DOC_TYPE_LABELS.get(dt, dt),
                "current_number": num,
            }
            for dt, num in sorted(seqs.items())
        ]
    }


class SetSequenceRequest(BaseModel):
    current_number: int


@router.patch("/sequences/{doc_type}", dependencies=[Depends(require_role(AppRole.admin))])
async def set_sequence(
    doc_type: str,
    body: SetSequenceRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Admin: manually set the current sequence number for a doc_type."""
    if body.current_number < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nomor tidak boleh negatif")
    doc_type = doc_type.upper()
    await db.execute(
        sa_text(
            "INSERT INTO document_sequences (doc_type, current_number) VALUES (:dt, :n) "
            "ON CONFLICT (doc_type) DO UPDATE SET current_number = :n, updated_at = now()"
        ),
        {"dt": doc_type, "n": body.current_number},
    )
    await db.commit()
    return {"doc_type": doc_type, "current_number": body.current_number}


# ---------------------------------------------------------------------------
# GET /api/library/admin/folder-permissions   (admin only)
# ---------------------------------------------------------------------------

@router.get("/admin/folder-permissions", dependencies=[Depends(require_role(AppRole.admin))])
async def get_folder_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all active root dept folders and the full role permission matrix."""
    folders_result = await db.execute(
        select(LibraryFolder)
        .where(
            LibraryFolder.is_active.is_(True),
            LibraryFolder.parent_id.is_(None),
            LibraryFolder.department.in_(list(DEPT_LABELS.keys())),
        )
        .order_by(LibraryFolder.department)
    )
    folders = folders_result.scalars().all()

    # All permission rows
    perms_result = await db.execute(select(FolderPermission))
    perms = perms_result.scalars().all()

    return {
        "folders": [
            {
                "id": str(f.id),
                "name": f.name,
                "dept": f.department,
                "dept_label": DEPT_LABELS.get(f.department, f.department),
                "own_roles": sorted(DEPT_ROLE_MAP.get(f.department, set())),
            }
            for f in folders
        ],
        "permissions": [
            {
                "folder_id": str(p.folder_id),
                "role": p.role.value,
                "can_view": p.can_view,
                "can_upload": p.can_upload,
                "can_download": p.can_download,
                "can_rename": p.can_rename,
                "can_delete": p.can_delete,
                "can_move": p.can_move,
                "can_create_folder": p.can_create_folder,
                "can_rename_folder": p.can_rename_folder,
                "can_delete_folder": p.can_delete_folder,
            }
            for p in perms
        ],
    }


class FolderPermissionEntry(BaseModel):
    folder_id: str
    role: str
    can_view: bool
    can_upload: bool
    can_download: bool
    can_rename: bool = False
    can_delete: bool = False
    can_move: bool = False
    can_create_folder: bool = False
    can_rename_folder: bool = False
    can_delete_folder: bool = False


class SetFolderPermissionsRequest(BaseModel):
    permissions: list[FolderPermissionEntry]


@router.put("/admin/folder-permissions", dependencies=[Depends(require_role(AppRole.admin))])
async def set_folder_permissions(
    body: SetFolderPermissionsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Upsert folder permission rows (one per folder_id + role combination)."""
    for entry in body.permissions:
        folder_uuid = uuid.UUID(entry.folder_id)
        try:
            role_enum = AppRole(entry.role)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Role tidak dikenal: {entry.role}",
            )

        result = await db.execute(
            select(FolderPermission).where(
                FolderPermission.folder_id == folder_uuid,
                FolderPermission.role == role_enum,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.can_view = entry.can_view
            existing.can_upload = entry.can_upload
            existing.can_download = entry.can_download
            existing.can_rename = entry.can_rename
            existing.can_delete = entry.can_delete
            existing.can_move = entry.can_move
            existing.can_create_folder = entry.can_create_folder
            existing.can_rename_folder = entry.can_rename_folder
            existing.can_delete_folder = entry.can_delete_folder
        else:
            db.add(FolderPermission(
                folder_id=folder_uuid,
                role=role_enum,
                can_view=entry.can_view,
                can_upload=entry.can_upload,
                can_download=entry.can_download,
                can_rename=entry.can_rename,
                can_delete=entry.can_delete,
                can_move=entry.can_move,
                can_create_folder=entry.can_create_folder,
                can_rename_folder=entry.can_rename_folder,
                can_delete_folder=entry.can_delete_folder,
            ))

    await db.commit()
    return {"updated": len(body.permissions)}

