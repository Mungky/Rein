"""Digital Library — folder tree, public index, folder file listing.

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
from app.limiter import READ_LIMIT, limiter
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
# GET /api/library/tree
# ---------------------------------------------------------------------------

class FolderNode(BaseModel):
    id: str
    name: str
    department: str
    folder_type: str
    path: str
    gdrive_folder_id: str | None
    file_count: int
    children: list["FolderNode"] = []


FolderNode.model_rebuild()


@router.get("/file-types")
@limiter.limit(READ_LIMIT)
async def list_active_file_types(
    request: Request,
    _profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return active file types — consumed by the upload form to populate the doc-type dropdown."""
    result = await db.execute(
        select(FileType)
        .where(FileType.is_active.is_(True))
        .order_by(FileType.sort_order, FileType.code)
    )
    return {
        "file_types": [
            {
                "code": ft.code,
                "label": ft.label,
                "description": ft.description,
            }
            for ft in result.scalars().all()
        ]
    }


@router.get("/tree")
@limiter.limit(READ_LIMIT)
async def get_folder_tree(
    request: Request,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return folder tree filtered to depts the user has can_view on.

    Admin sees all. Others only see departments where folder_permissions
    grants them can_view on the root folder.
    """
    base_where = [LibraryFolder.is_active.is_(True)]

    if profile.role != AppRole.admin:
        fp_result = await db.execute(
            select(LibraryFolder.department)
            .join(FolderPermission, FolderPermission.folder_id == LibraryFolder.id)
            .where(
                LibraryFolder.parent_id.is_(None),
                FolderPermission.role == profile.role,
                FolderPermission.can_view.is_(True),
            )
        )
        user_depts = [row[0] for row in fp_result.all()]
        if not user_depts:
            return {"tree": []}
        base_where.append(LibraryFolder.department.in_(user_depts))

    result = await db.execute(
        select(LibraryFolder)
        .where(*base_where)
        .order_by(LibraryFolder.department, LibraryFolder.name)
    )
    all_folders = result.scalars().all()

    # File counts + last updated per folder (only passed, non-deleted files)
    stats_result = await db.execute(
        select(
            LibraryFile.folder_id,
            func.count(LibraryFile.id),
            func.max(LibraryFile.created_at),
        )
        .where(
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
        .group_by(LibraryFile.folder_id)
    )
    counts: dict[uuid.UUID, int] = {}
    last_upd: dict[uuid.UUID, str | None] = {}
    for folder_id_val, count, max_dt in stats_result.all():
        counts[folder_id_val] = count
        last_upd[folder_id_val] = max_dt.isoformat() if max_dt else None

    # Build tree
    folder_map: dict[uuid.UUID, dict] = {}
    for f in all_folders:
        folder_map[f.id] = {
            "id": str(f.id),
            "name": f.name,
            "department": f.department,
            "dept_label": DEPT_LABELS.get(f.department, f.department),
            "folder_type": f.folder_type.value,
            "path": f.path,
            "gdrive_folder_id": f.gdrive_folder_id,
            "file_count": counts.get(f.id, 0),
            "last_updated": last_upd.get(f.id),
            "parent_id": str(f.parent_id) if f.parent_id else None,
            "children": [],
        }

    roots = []
    for fid, node in folder_map.items():
        pid = node.pop("parent_id")
        if pid and uuid.UUID(pid) in folder_map:
            folder_map[uuid.UUID(pid)]["children"].append(node)
        else:
            roots.append(node)

    # Sort: departments first, then alphabetical
    roots.sort(key=lambda n: (n["folder_type"] != "department", n["name"]))
    return {"tree": roots}


# ---------------------------------------------------------------------------
# GET /api/library/public-index
# ---------------------------------------------------------------------------

@router.get("/public-index")
@limiter.limit(READ_LIMIT)
async def get_public_index(
    request: Request,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Brochure: all departments with file titles only — no content, no metadata."""
    # Root dept folders only
    folders_result = await db.execute(
        select(LibraryFolder)
        .where(
            LibraryFolder.is_active.is_(True),
            LibraryFolder.folder_type == FolderType.department,
            LibraryFolder.parent_id.is_(None),
        )
        .order_by(LibraryFolder.department, LibraryFolder.name)
    )
    folders = folders_result.scalars().all()

    departments = []
    for folder in folders:
        # Collect file titles for this dept (all subfolders included via department match)
        files_result = await db.execute(
            select(LibraryFile.file_name, LibraryFile.doc_type)
            .join(LibraryFolder, LibraryFile.folder_id == LibraryFolder.id)
            .where(
                LibraryFolder.department == folder.department,
                LibraryFile.upload_status == LibraryFileStatus.passed,
                LibraryFile.is_deleted.is_(False),
            )
            .order_by(LibraryFile.created_at.desc())
            .limit(100)
        )
        file_rows = files_result.all()
        departments.append({
            "id": str(folder.id),
            "name": folder.name,
            "department": folder.department,
            "dept_label": DEPT_LABELS.get(folder.department, folder.department),
            "file_count": len(file_rows),
            "files": [
                {"name": row.file_name, "doc_type": row.doc_type}
                for row in file_rows
            ],
        })

    return {"departments": departments}


# ---------------------------------------------------------------------------
# GET /api/library/folders/{folder_id}/files
# ---------------------------------------------------------------------------

@router.get("/folders/{folder_id}/files")
@limiter.limit(READ_LIMIT)
async def list_folder_files(
    request: Request,
    folder_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    search: str | None = Query(None, description="Cari di file_name / original_name / doc_type"),
):
    """List file metadata in a folder (etalase — all roles can read)."""
    folder_result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")

    if not await _can_view_dept(db, profile, folder):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Anda tidak memiliki izin melihat folder ini",
        )

    offset = (page - 1) * page_size

    base_filters = [
        LibraryFile.folder_id == folder_id,
        LibraryFile.upload_status == LibraryFileStatus.passed,
        LibraryFile.is_deleted.is_(False),
    ]
    if search:
        pattern = f"%{search.lower()}%"
        base_filters.append(
            sa_text(
                "lower(coalesce(library_files.file_name, '')) LIKE :pat "
                "OR lower(coalesce(library_files.original_name, '')) LIKE :pat "
                "OR lower(coalesce(library_files.doc_type, '')) LIKE :pat "
                "OR lower(coalesce(library_files.title, '')) LIKE :pat"
            ).bindparams(pat=pattern)
        )

    files_result = await db.execute(
        select(LibraryFile)
        .where(*base_filters)
        .order_by(LibraryFile.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    files = files_result.scalars().all()

    total_result = await db.execute(
        select(func.count(LibraryFile.id)).where(*base_filters)
    )
    total = total_result.scalar() or 0

    # Compute current user's perms on this folder's dept (admin = all true)
    if profile.role == AppRole.admin:
        my_perms = {
            "can_view": True, "can_upload": True, "can_download": True,
            "can_rename": True, "can_delete": True, "can_move": True,
            "can_create_folder": True, "can_rename_folder": True, "can_delete_folder": True,
        }
    else:
        perm_result = await db.execute(
            select(FolderPermission)
            .join(LibraryFolder, FolderPermission.folder_id == LibraryFolder.id)
            .where(
                LibraryFolder.department == folder.department,
                LibraryFolder.parent_id.is_(None),
                FolderPermission.role == profile.role,
            )
        )
        perm = perm_result.scalar_one_or_none()
        my_perms = {
            "can_view": bool(perm and perm.can_view),
            "can_upload": bool(perm and perm.can_upload),
            "can_download": bool(perm and perm.can_download),
            "can_rename": bool(perm and perm.can_rename),
            "can_delete": bool(perm and perm.can_delete),
            "can_move": bool(perm and perm.can_move),
            "can_create_folder": bool(perm and perm.can_create_folder),
            "can_rename_folder": bool(perm and perm.can_rename_folder),
            "can_delete_folder": bool(perm and perm.can_delete_folder),
        }

    return {
        "folder": {
            "id": str(folder.id),
            "name": folder.name,
            "path": folder.path,
            "department": folder.department,
        },
        "files": [_file_meta(f) for f in files],
        "total": total,
        "page": page,
        "page_size": page_size,
        "my_perms": my_perms,
    }


