"""Digital Library — file link, delete, move, rename.

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
# GET /api/library/files/{file_id}/link
# Returns temp link if view_request is approved and not yet expired
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/link")
async def get_file_link(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Poll for approved temp link. Frontend calls this after request_view_access."""
    # Admin: always direct
    if profile.role == AppRole.admin:
        file_result = await db.execute(
            select(LibraryFile).where(LibraryFile.id == file_id)
        )
        lib_file = file_result.scalar_one_or_none()
        if lib_file and lib_file.gdrive_web_link:
            return {"status": "approved", "temp_link": lib_file.gdrive_web_link}

    # User with can_download: direct
    file_result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == file_id)
    )
    lib_file = file_result.scalar_one_or_none()
    if lib_file:
        folder_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
        )
        folder = folder_result.scalar_one_or_none()
        if folder and lib_file.gdrive_web_link and await _can_download_from(db, profile, folder):
            return {"status": "approved", "temp_link": lib_file.gdrive_web_link}

    now = datetime.now(timezone.utc)
    req_result = await db.execute(
        select(ViewRequest)
        .where(
            ViewRequest.file_id == file_id,
            ViewRequest.requester_id == profile.id,
            ViewRequest.status == "approved",
            ViewRequest.link_expires_at > now,
        )
        .order_by(ViewRequest.approved_at.desc())
    )
    req = req_result.scalars().first()
    if req:
        return {
            "status": "approved",
            "temp_link": req.temp_link,
            "link_expires_at": req.link_expires_at.isoformat() if req.link_expires_at else None,
        }

    # Check if pending
    pending_result = await db.execute(
        select(ViewRequest).where(
            ViewRequest.file_id == file_id,
            ViewRequest.requester_id == profile.id,
            ViewRequest.status == "pending",
            ViewRequest.expires_at > now,
        )
    )
    pending = pending_result.scalars().first()
    if pending:
        return {
            "status": "pending",
            "expires_at": pending.expires_at.isoformat(),
        }

    return {"status": "none"}


# ---------------------------------------------------------------------------
# DELETE /api/library/files/{file_id}   (admin only)
# ---------------------------------------------------------------------------

@router.delete("/files/{file_id}")
async def delete_file(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Soft-delete a file + move to Drive Trash.

    Allowed: admin OR user with can_delete on the file's folder OR the original uploader.
    File goes to Drive Trash (recoverable for 30 days), not permanent delete.
    """
    file_result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == file_id)
    )
    lib_file = file_result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    folder_result = await db.execute(
        select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
    )
    folder = folder_result.scalar_one_or_none()

    is_admin = profile.role == AppRole.admin
    is_uploader = lib_file.uploader_id == profile.id
    can_delete = is_admin or is_uploader
    if not can_delete and folder:
        can_delete = await _can_delete_in(db, profile, folder)
    if not can_delete:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Anda tidak memiliki izin menghapus file ini",
        )

    # Move to Drive Trash first (recoverable). Soft-fail so DB state isn't blocked.
    drive_trashed = False
    if lib_file.gdrive_file_id:
        from app.services import gdrive
        try:
            await gdrive.trash_file(lib_file.gdrive_file_id)
            drive_trashed = True
        except Exception as exc:
            logger.warning("Drive trash failed for file %s: %s", file_id, exc)

    lib_file.is_deleted = True
    lib_file.upload_status = LibraryFileStatus.archived

    await _write_log(
        db, profile, LOG_FILE_DELETE, "file", file_id,
        metadata={
            "filename": lib_file.file_name,
            "folder_id": str(lib_file.folder_id),
            "drive_trashed": drive_trashed,
        },
    )
    await db.commit()
    return {
        "message": "File dipindahkan ke Trash Google Drive (dapat dipulihkan 30 hari)",
        "drive_trashed": drive_trashed,
    }


# ---------------------------------------------------------------------------
# PATCH /api/library/files/{file_id}/rename
# ---------------------------------------------------------------------------

class MoveFileRequest(BaseModel):
    target_folder_id: str


@router.patch("/files/{file_id}/move")
async def move_file(
    file_id: uuid.UUID,
    body: MoveFileRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Move a file to another folder.

    Allowed: admin OR user with can_move on source folder AND can_upload on
    destination folder. Drive is synced — file moves between Drive folders too.
    """
    file_result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.id == file_id,
            LibraryFile.is_deleted.is_(False),
        )
    )
    lib_file = file_result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    target_uuid = uuid.UUID(body.target_folder_id)
    if target_uuid == lib_file.folder_id:
        return {"id": str(lib_file.id), "folder_id": str(lib_file.folder_id), "moved": False}

    src_result = await db.execute(
        select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
    )
    src_folder = src_result.scalar_one_or_none()

    dst_result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == target_uuid,
            LibraryFolder.is_active.is_(True),
        )
    )
    dst_folder = dst_result.scalar_one_or_none()
    if not dst_folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tujuan tidak ditemukan")

    is_admin = profile.role == AppRole.admin
    if not is_admin:
        if src_folder and not await _can_move_in(db, profile, src_folder):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Tidak memiliki izin memindahkan file dari folder asal",
            )
        if not await _can_upload_to(db, profile, dst_folder):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Tidak memiliki izin upload ke folder tujuan",
            )

    # Drive sync (best-effort)
    drive_moved = False
    if lib_file.gdrive_file_id and dst_folder.gdrive_folder_id:
        from app.services import gdrive
        try:
            await gdrive.move_file(lib_file.gdrive_file_id, dst_folder.gdrive_folder_id)
            drive_moved = True
        except Exception as exc:
            logger.warning("Drive move failed for file %s: %s", file_id, exc)

    old_folder_id = lib_file.folder_id
    lib_file.folder_id = target_uuid
    lib_file.gdrive_folder_id = dst_folder.gdrive_folder_id

    await _write_log(
        db, profile, "move_file", "file", file_id,
        metadata={
            "filename": lib_file.file_name,
            "from_path": src_folder.path if src_folder else None,
            "to_path": dst_folder.path,
            "drive_moved": drive_moved,
        },
    )
    await db.commit()
    return {
        "id": str(lib_file.id),
        "folder_id": str(lib_file.folder_id),
        "moved": True,
        "drive_moved": drive_moved,
    }


class RenameFileRequest(BaseModel):
    file_name: str


@router.patch("/files/{file_id}/rename")
async def rename_file(
    file_id: uuid.UUID,
    body: RenameFileRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Rename a file.

    Allowed: admin OR user with can_rename on file's folder OR the uploader.
    """
    file_result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.id == file_id,
            LibraryFile.is_deleted.is_(False),
        )
    )
    lib_file = file_result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    is_admin = profile.role == AppRole.admin
    is_uploader = lib_file.uploader_id == profile.id
    can_rename = is_admin or is_uploader
    if not can_rename:
        folder_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
        )
        folder = folder_result.scalar_one_or_none()
        if folder:
            can_rename = await _can_rename_in(db, profile, folder)
    if not can_rename:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tidak memiliki izin rename file ini")

    new_name = body.file_name.strip()
    if not new_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nama file tidak boleh kosong")

    old_name = lib_file.file_name
    lib_file.file_name = new_name

    if lib_file.gdrive_file_id:
        from app.services import gdrive
        try:
            await gdrive.rename_file(lib_file.gdrive_file_id, new_name)
        except Exception as exc:
            logger.warning("Drive rename failed for file %s: %s", file_id, exc)

    folder_for_log = await db.execute(
        select(LibraryFolder.path).where(LibraryFolder.id == lib_file.folder_id)
    )
    folder_path_for_log = folder_for_log.scalar()
    await _write_log(
        db, profile, "rename_file", "file", file_id,
        metadata={
            "old_name": old_name,
            "new_name": new_name,
            "folder_path": folder_path_for_log,
        },
    )
    await db.commit()
    return {"id": str(lib_file.id), "file_name": lib_file.file_name}


