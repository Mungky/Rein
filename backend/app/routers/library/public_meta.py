"""Digital Library — public sheets index, public list, audit log.

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
# GET /api/library/public-index/sheets
# ---------------------------------------------------------------------------

@router.get("/public-index/sheets")
async def get_public_index_sheets(
    profile: Annotated[Profile, Depends(get_current_profile)],
):
    """Return rows from the public Google Sheets index spreadsheet."""
    from app.services.gsheets import read_public_index_display
    rows = await read_public_index_display()
    headers: list[str] = list(rows[0].keys()) if rows else []
    return {"headers": headers, "rows": rows}


# ---------------------------------------------------------------------------
# GET /api/library/public-list   (all authenticated users)
# ---------------------------------------------------------------------------

@router.get("/public-list")
async def get_public_list(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all passed files: name, uploader, timestamp. No sensitive metadata."""
    from db.models.profile import Profile as ProfileModel
    result = await db.execute(
        select(
            LibraryFile.id,
            LibraryFile.file_name,
            LibraryFile.original_name,
            LibraryFile.created_at,
            ProfileModel.full_name,
        )
        .join(ProfileModel, LibraryFile.uploader_id == ProfileModel.id)
        .where(
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
        .order_by(LibraryFile.created_at.desc())
        .limit(1000)
    )
    rows = result.all()
    return {
        "files": [
            {
                "id": str(r.id),
                "file_name": r.file_name or r.original_name,
                "uploaded_by": r.full_name,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


# ---------------------------------------------------------------------------
# GET /api/library/log   (admin only)
# ---------------------------------------------------------------------------

@router.get("/log", dependencies=[Depends(require_role(AppRole.admin))])
async def get_audit_log(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    """Full activity log — admin only."""
    offset = (page - 1) * page_size
    result = await db.execute(
        select(LibraryAuditLog)
        .order_by(LibraryAuditLog.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    entries = result.scalars().all()

    total_result = await db.execute(select(func.count(LibraryAuditLog.id)))
    total = total_result.scalar() or 0

    return {
        "entries": [
            {
                "id": e.id,
                "actor_id": str(e.actor_id) if e.actor_id else None,
                "action": e.action,
                "target_type": e.target_type,
                "target_id": str(e.target_id) if e.target_id else None,
                "metadata": e.log_metadata,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


