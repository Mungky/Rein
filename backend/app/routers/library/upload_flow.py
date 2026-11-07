"""Digital Library — propose -> confirm -> upload -> audit status.

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
# POST /api/library/propose
# Lightweight: just detects metadata from filename, no file transferred yet
# ---------------------------------------------------------------------------

class ProposeRequest(BaseModel):
    filename: str
    file_size: int
    folder_id: str | None = None
    content_hash: str | None = None  # SHA-256 hex (64 chars) — used for duplicate detection


# Hex-only string of length 64 — guards against malformed input before DB lookup
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


@router.post("/propose")
@limiter.limit("60/minute")
async def propose_file(
    request: Request,
    body: ProposeRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Detect metadata from filename + optional duplicate check by SHA-256 hash."""
    from app.services.metadata import detect_metadata_from_filename
    from db.models.profile import Profile as ProfileModel

    detected = await detect_metadata_from_filename(body.filename, db)

    # Duplicate check (only if frontend supplied a hash and it matches the format)
    duplicate = None
    if body.content_hash and _SHA256_RE.match(body.content_hash):
        dup_result = await db.execute(
            select(LibraryFile, ProfileModel.full_name)
            .join(ProfileModel, LibraryFile.uploader_id == ProfileModel.id)
            .where(
                LibraryFile.content_hash == body.content_hash,
                LibraryFile.upload_status == LibraryFileStatus.passed,
                LibraryFile.is_deleted.is_(False),
            )
            .order_by(LibraryFile.created_at.desc())
            .limit(1)
        )
        dup_row = dup_result.first()
        if dup_row:
            existing_file, uploader_name = dup_row
            duplicate = {
                "id": str(existing_file.id),
                "file_name": existing_file.file_name or existing_file.original_name,
                "doc_number": existing_file.doc_number,
                "uploader_name": uploader_name,
                "uploaded_at": existing_file.created_at.isoformat(),
            }

    await _write_log(
        db, profile, LOG_PROPOSE,
        metadata={"filename": body.filename, "folder_id": body.folder_id},
    )
    await db.commit()

    return {
        "filename": body.filename,
        "detected": {
            "doc_type": {"value": detected.doc_type, "confidence": detected.doc_type_confidence},
            "client": {
                "value": detected.client_name,
                "code": detected.client_code,
                "confidence": detected.client_confidence,
            },
            "project": {
                "value": detected.project_name,
                "code": detected.project_code,
                "confidence": detected.project_confidence,
            },
            "folder": {"value": detected.folder_path, "confidence": detected.folder_confidence},
        },
        "duplicate": duplicate,
    }


# ---------------------------------------------------------------------------
# POST /api/library/upload   (multipart form — called after user confirms)
# ---------------------------------------------------------------------------

@router.post("/upload", status_code=201)
@limiter.limit("30/minute")
async def upload_file(
    request: Request,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    folder_id: str = Form(...),
    doc_type: str | None = Form(None),
    doc_number: str | None = Form(None),
    title: str | None = Form(None),
    note: str | None = Form(None),
    use_original_name: bool = Form(True),
):
    """
    Receive confirmed file + metadata. Upload directly to the folder's Drive location.
    Returns 201 after Drive upload completes — no background task, errors surface immediately.
    """
    import io
    from app.services import gdrive

    # ── Validate folder ────────────────────────────────────────────────────────
    folder_result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == uuid.UUID(folder_id),
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tujuan tidak ditemukan")

    if not folder.gdrive_folder_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Folder belum dihubungkan ke Google Drive. Minta admin untuk menautkan folder ini ke Drive.",
        )

    if not await _can_upload_to(db, profile, folder):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Anda tidak memiliki izin upload ke folder departemen '{folder.department}'",
        )

    # ── Validate file ──────────────────────────────────────────────────────────
    original_name = file.filename or "unnamed"
    ext = "." + original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Ekstensi '{ext}' tidak didukung",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Ukuran file melebihi batas 50 MB",
        )
    if not content:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File kosong")

    # ── Assign archive number (user-supplied or auto-increment) ───────────────
    content_hash = hashlib.sha256(content).hexdigest()
    seq_number = 0
    archive_number = ""

    if use_original_name:
        # User opted out of REIN naming format — keep filename as-is, just sanitize
        # path separators and characters Drive doesn't allow.
        doc_type = None
        doc_number = None
        file_name = _sanitize_filename(original_name)
    else:
        if doc_number and doc_number.strip():
            archive_number = doc_number.strip()
        elif doc_type:
            seq_result = await db.execute(
                sa_text(
                    "UPDATE document_sequences SET current_number = current_number + 1, "
                    "updated_at = now() WHERE doc_type = :dt RETURNING current_number"
                ),
                {"dt": doc_type},
            )
            row = seq_result.fetchone()
            if row:
                seq_number = row[0]
            else:
                await db.execute(
                    sa_text(
                        "INSERT INTO document_sequences (doc_type, current_number) "
                        "VALUES (:dt, 1) ON CONFLICT (doc_type) DO UPDATE "
                        "SET current_number = document_sequences.current_number + 1, updated_at = now() "
                        "RETURNING current_number"
                    ),
                    {"dt": doc_type},
                )
                seq_number = 1
            archive_number = str(seq_number)

        file_name = _build_filename(
            doc_type=doc_type,
            archive_number=archive_number,
            title=title or _strip_ext(original_name),
            note=note,
            ext=ext,
        )

    # Commit sequence increment (or no-op if use_original_name) before slow Drive call
    await db.commit()

    # ── Create LibraryFile FIRST (status=uploading) so failures are visible ──
    lib_file = LibraryFile(
        folder_id=uuid.UUID(folder_id),
        original_name=original_name,
        file_name=file_name,
        doc_type=doc_type,
        title=title or _strip_ext(original_name),
        note=note,
        file_size=len(content),
        mime_type=file.content_type or "application/octet-stream",
        content_hash=content_hash,
        gdrive_folder_id=folder.gdrive_folder_id,
        upload_status=LibraryFileStatus.uploading,
        uploader_id=profile.id,
        proposal_metadata={
            "doc_type": doc_type,
            "archive_number": archive_number,
            "seq_number": seq_number,
            "title": title,
            "note": note,
            "use_original_name": use_original_name,
        },
    )
    db.add(lib_file)
    await db.flush()
    file_db_id = lib_file.id
    await db.commit()  # commit early so the row is visible even if Drive hangs

    # ── Upload to Drive (with retry on SSL/5xx via gdrive._drive_call_with_retry) ──
    try:
        drive_result = await gdrive.upload_file(
            io.BytesIO(content),
            file_name,
            file.content_type or "application/octet-stream",
            folder.gdrive_folder_id,
            file_size=len(content),
        )
    except Exception as exc:
        logger.error("Drive upload failed for '%s': %s", file_name, exc)
        # Update the row to 'failed' so it appears in the admin Temp panel
        fail_result = await db.execute(
            select(LibraryFile).where(LibraryFile.id == file_db_id)
        )
        fail_row = fail_result.scalar_one_or_none()
        if fail_row:
            fail_row.upload_status = LibraryFileStatus.failed
            existing_meta = fail_row.proposal_metadata or {}
            existing_meta["error"] = str(exc)
            fail_row.proposal_metadata = existing_meta
        await _write_log(
            db, profile, LOG_UPLOAD,
            target_type="file",
            target_id=file_db_id,
            metadata={"filename": file_name, "size": len(content), "folder_id": folder_id, "error": str(exc)},
        )
        await db.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Gagal mengunggah ke Google Drive: {exc}",
        )

    # ── Drive success — update row to passed ──────────────────────────────────
    success_result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == file_db_id)
    )
    lib_file = success_result.scalar_one()
    lib_file.gdrive_file_id = drive_result.get("id")
    lib_file.gdrive_web_link = drive_result.get("webViewLink")
    lib_file.upload_status = LibraryFileStatus.passed

    await _write_log(
        db, profile, LOG_UPLOAD,
        target_type="file",
        target_id=lib_file.id,
        metadata={"filename": file_name, "size": len(content), "folder_id": folder_id},
    )
    # get_db() commits on successful return

    # ── Enqueue index update (non-fatal) ──────────────────────────────────────
    try:
        from app.services.task_queue import task_queue, TaskType
        task_queue.enqueue(TaskType.INDEX_TO_SHEETS, {
            "doc_type": doc_type or "OTHER",
            "doc_sequence": archive_number,
            "client_name": "",
            "client_code": "",
            "project_name": "",
            "file_name": file_name,
            "note": note or "",
            "folder_path": folder.path,
            "department": folder.department,
            "dept_label": DEPT_LABELS.get(folder.department, folder.department),
            "gdrive_link": drive_result.get("webViewLink", ""),
            "uploaded_by": profile.full_name,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
        })
    except Exception as enqueue_exc:
        logger.warning("INDEX_TO_SHEETS enqueue failed (non-fatal): %s", enqueue_exc)

    return {
        "file_id": str(lib_file.id),
        "file_name": file_name,
        "status": "passed",
        "gdrive_web_link": drive_result.get("webViewLink"),
    }


# ---------------------------------------------------------------------------
# GET /api/library/files/{file_id}/status
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/status")
async def get_file_status(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Poll upload/audit status for a file the user uploaded."""
    result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == file_id)
    )
    lib_file = result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    # Only uploader, admin, or director can poll status of in-progress files
    if profile.role not in (AppRole.admin, AppRole.director) and lib_file.uploader_id != profile.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Akses ditolak")

    jobs_result = await db.execute(
        select(AuditJob)
        .where(AuditJob.file_id == file_id)
        .order_by(AuditJob.layer)
    )
    jobs = jobs_result.scalars().all()

    return {
        "file_id": str(lib_file.id),
        "file_name": lib_file.file_name or lib_file.original_name,
        "upload_status": lib_file.upload_status.value,
        "audit_layers": [
            {
                "layer": j.layer,
                "layer_name": j.layer_name,
                "status": j.status,
                "result": j.result,
            }
            for j in jobs
        ],
    }


