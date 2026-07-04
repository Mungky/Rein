"""Digital Library — folder rename, move, gdrive-link, delete, create.

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
# PATCH /api/library/folders/{folder_id}/rename  (admin only)
# ---------------------------------------------------------------------------

class RenameFolderRequest(BaseModel):
    name: str


@router.patch("/folders/{folder_id}/rename")
async def rename_folder(
    folder_id: uuid.UUID,
    body: RenameFolderRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Rename a folder. Allowed: admin OR user with can_rename_folder on the dept."""
    folder_result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")

    if profile.role != AppRole.admin and not await _can_rename_folder_in(db, profile, folder):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tidak memiliki izin rename folder ini")

    # Department root folders should not be renamed (they map to fixed dept slugs)
    if folder.folder_type == FolderType.department and folder.parent_id is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Folder departemen induk tidak dapat di-rename",
        )

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nama folder tidak boleh kosong")

    old_path = folder.path
    folder.name = new_name
    if " / " in old_path:
        folder.path = old_path.rsplit(" / ", 1)[0] + " / " + new_name
    else:
        folder.path = new_name

    if folder.gdrive_folder_id:
        from app.services import gdrive as gdrive_svc
        try:
            await gdrive_svc.rename_folder(folder.gdrive_folder_id, new_name)
        except Exception as exc:
            logger.warning("Drive rename failed for folder %s: %s", folder_id, exc)

    await _write_log(
        db, profile, "rename_folder", "folder", folder_id,
        metadata={"old_path": old_path, "new_path": folder.path},
    )
    await db.commit()
    return {"id": str(folder.id), "name": folder.name, "path": folder.path}


# ---------------------------------------------------------------------------
# PATCH /api/library/folders/{folder_id}/move
# ---------------------------------------------------------------------------

class MoveFolderRequest(BaseModel):
    # None = move to the department root level (no parent).
    target_parent_id: str | None = None


@router.patch("/folders/{folder_id}/move")
async def move_folder(
    folder_id: uuid.UUID,
    body: MoveFolderRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Re-parent a folder within the same department.

    Allowed: admin OR (can_rename_folder on source AND can_create_folder on target).
    Department root folders cannot be moved. A folder cannot be moved into itself
    or any of its descendants (cycle guard). Drive is synced when both folders are
    linked.
    """
    result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")

    if folder.folder_type == FolderType.department and folder.parent_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Folder departemen induk tidak dapat dipindahkan")

    # Resolve target parent (None = department root)
    target: LibraryFolder | None = None
    if body.target_parent_id:
        target_result = await db.execute(
            select(LibraryFolder).where(
                LibraryFolder.id == uuid.UUID(body.target_parent_id),
                LibraryFolder.is_active.is_(True),
            )
        )
        target = target_result.scalar_one_or_none()
        if not target:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tujuan tidak ditemukan")
        if target.department != folder.department:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Folder hanya bisa dipindah dalam departemen yang sama",
            )

    # No-op guard
    target_parent_uuid = target.id if target else None
    if folder.parent_id == target_parent_uuid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Folder sudah berada di lokasi tujuan")

    # Permission: admin OR (can_rename_folder source AND can_create_folder target)
    if profile.role != AppRole.admin:
        check_target = target if target else LibraryFolder(department=folder.department, name="", path="")
        if not (await _can_rename_folder_in(db, profile, folder)
                and await _can_create_folder_in(db, profile, check_target)):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Tidak memiliki izin memindahkan folder ini",
            )

    # Collect descendant ids (cycle guard: target must not be self or descendant)
    async def _collect_descendant_ids(fid: uuid.UUID) -> list[uuid.UUID]:
        ids: list[uuid.UUID] = [fid]
        children_result = await db.execute(
            select(LibraryFolder.id).where(
                LibraryFolder.parent_id == fid,
                LibraryFolder.is_active.is_(True),
            )
        )
        for (child_id,) in children_result.all():
            ids.extend(await _collect_descendant_ids(child_id))
        return ids

    descendant_ids = await _collect_descendant_ids(folder_id)
    if target_parent_uuid and target_parent_uuid in descendant_ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Folder tidak bisa dipindah ke dalam dirinya sendiri",
        )

    old_path = folder.path
    new_base = (target.path + " / ") if target else ""
    new_path = new_base + folder.name

    # Update this folder
    folder.parent_id = target_parent_uuid
    folder.path = new_path

    # Rewrite descendant paths (replace old prefix with new prefix)
    if descendant_ids[1:]:
        desc_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.id.in_(descendant_ids[1:]))
        )
        for desc in desc_result.scalars().all():
            if desc.path.startswith(old_path):
                desc.path = new_path + desc.path[len(old_path):]

    # Sync Drive (best-effort)
    drive_moved = False
    if folder.gdrive_folder_id and target and target.gdrive_folder_id:
        from app.services import gdrive as gdrive_svc
        try:
            await gdrive_svc.move_folder(folder.gdrive_folder_id, target.gdrive_folder_id)
            drive_moved = True
        except Exception as exc:
            logger.warning("Drive move failed for folder %s: %s", folder_id, exc)

    await _write_log(
        db, profile, "move_folder", "folder", folder_id,
        metadata={"old_path": old_path, "new_path": new_path, "drive_moved": drive_moved},
    )
    await db.commit()
    return {"id": str(folder.id), "path": folder.path, "drive_moved": drive_moved}


# ---------------------------------------------------------------------------
# PATCH /api/library/admin/folders/{folder_id}/gdrive-link  (admin only)
# ---------------------------------------------------------------------------

class FolderGDriveLinkRequest(BaseModel):
    gdrive_folder_id: str | None = None


@router.patch("/admin/folders/{folder_id}/gdrive-link", dependencies=[Depends(require_role(AppRole.admin))])
async def link_folder_to_drive(
    folder_id: uuid.UUID,
    body: FolderGDriveLinkRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Admin: set or clear the Google Drive folder ID linked to a library folder."""
    result = await db.execute(
        select(LibraryFolder).where(LibraryFolder.id == folder_id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")

    drive_id = body.gdrive_folder_id.strip() if body.gdrive_folder_id else None
    folder.gdrive_folder_id = drive_id or None
    await db.commit()
    return {"id": str(folder.id), "gdrive_folder_id": folder.gdrive_folder_id}


# ---------------------------------------------------------------------------
# DELETE /api/library/folders/{folder_id}   (admin only)
# ---------------------------------------------------------------------------

@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    cascade: bool = Query(False, description="Hapus juga semua file aktif di dalam folder"),
):
    """Soft-delete a non-department folder + move to Drive Trash.

    Allowed: admin OR user with can_delete_folder on the dept.
    If cascade=true, all active files inside are also trashed (recoverable via Drive Trash).
    Department root folders cannot be deleted.
    """
    result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")
    if folder.folder_type == FolderType.department and folder.parent_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Folder departemen induk tidak dapat dihapus")

    if profile.role != AppRole.admin and not await _can_delete_folder_in(db, profile, folder):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tidak memiliki izin menghapus folder ini")

    # Count active files across folder + all descendants
    async def _collect_descendant_ids(fid: uuid.UUID) -> list[uuid.UUID]:
        ids: list[uuid.UUID] = [fid]
        children_result = await db.execute(
            select(LibraryFolder.id).where(
                LibraryFolder.parent_id == fid,
                LibraryFolder.is_active.is_(True),
            )
        )
        for (child_id,) in children_result.all():
            ids.extend(await _collect_descendant_ids(child_id))
        return ids

    all_folder_ids = await _collect_descendant_ids(folder_id)

    active_files_result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.folder_id.in_(all_folder_ids),
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
    )
    active_files = active_files_result.scalars().all()

    if active_files and not cascade:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"Folder masih memiliki {len(active_files)} file aktif. "
                "Hapus file dulu atau gunakan cascade=true."
            ),
        )

    # Trash all files in Drive first (best-effort)
    from app.services import gdrive
    trashed_count = 0
    for lib_file in active_files:
        if lib_file.gdrive_file_id:
            try:
                await gdrive.trash_file(lib_file.gdrive_file_id)
                trashed_count += 1
            except Exception as exc:
                logger.warning("Failed to trash Drive file %s: %s", lib_file.gdrive_file_id, exc)
        lib_file.is_deleted = True
        lib_file.upload_status = LibraryFileStatus.archived

    # Trash Drive folder (recursive — Drive moves all contents to trash with it)
    folder_drive_trashed = False
    if folder.gdrive_folder_id:
        try:
            await gdrive.trash_folder(folder.gdrive_folder_id)
            folder_drive_trashed = True
        except Exception as exc:
            logger.warning("Failed to trash Drive folder %s: %s", folder.gdrive_folder_id, exc)

    # Soft-delete folder + all descendants
    for fid in all_folder_ids:
        f_result = await db.execute(select(LibraryFolder).where(LibraryFolder.id == fid))
        f = f_result.scalar_one_or_none()
        if f:
            f.is_active = False

    await _write_log(
        db, profile, "delete_folder", "folder", folder_id,
        metadata={
            "name": folder.name, "path": folder.path,
            "files_trashed": trashed_count,
            "drive_folder_trashed": folder_drive_trashed,
            "cascade": cascade,
        },
    )
    await db.commit()
    return {
        "id": str(folder_id),
        "deleted": True,
        "files_trashed": trashed_count,
        "drive_folder_trashed": folder_drive_trashed,
    }



# ---------------------------------------------------------------------------
# POST /api/library/folders   (admin + manager)
# ---------------------------------------------------------------------------

class CreateFolderRequest(BaseModel):
    name: str
    department: str
    folder_type: str = "custom"
    parent_id: str | None = None


@router.post("/folders", status_code=201)
async def create_folder(
    body: CreateFolderRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a sub-folder. Allowed: admin OR user with can_create_folder on the dept."""
    parent = None
    parent_path = ""
    if body.parent_id:
        parent_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.id == uuid.UUID(body.parent_id))
        )
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Parent folder tidak ditemukan")
        parent_path = parent.path + " / "

    # Permission check: admin OR can_create_folder on the dept
    if profile.role != AppRole.admin:
        check_folder = parent if parent else LibraryFolder(department=body.department, name="", path="")
        if not await _can_create_folder_in(db, profile, check_folder):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Tidak memiliki izin membuat folder di departemen ini",
            )

    folder = LibraryFolder(
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        department=body.department,
        name=body.name,
        folder_type=body.folder_type,
        path=parent_path + body.name,
        created_by=profile.id,
    )
    db.add(folder)
    await db.flush()  # get folder.id before commit

    # Auto-create matching GDrive folder if parent is linked to Drive
    if body.parent_id and parent and parent.gdrive_folder_id:
        from app.services import gdrive as gdrive_svc
        try:
            drive_id = await gdrive_svc.find_or_create_folder(body.name, parent.gdrive_folder_id)
            folder.gdrive_folder_id = drive_id
        except Exception as exc:
            logger.warning("Failed to create GDrive folder for '%s': %s", body.name, exc)

    await _write_log(
        db, profile, LOG_FOLDER_CREATE, "folder", folder.id,
        metadata={
            "name": body.name,
            "department": body.department,
            "path": folder.path,
            "parent_path": parent.path if parent else None,
        },
    )
    await db.commit()

    return {"id": str(folder.id), "path": folder.path, "gdrive_folder_id": folder.gdrive_folder_id}


