"""Digital Library router — folder tree, propose/confirm upload, view requests."""

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

router = APIRouter()
logger = logging.getLogger(__name__)

# Approved link validity
LINK_TTL_MINUTES = 30

ALLOWED_EXTENSIONS = {".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ---------------------------------------------------------------------------
# Dependency helpers
# ---------------------------------------------------------------------------

async def _has_folder_perm(
    db: AsyncSession,
    profile: Profile,
    folder: LibraryFolder,
    field: str,
) -> bool:
    """Check folder_permissions for a given field. Admin always allowed.

    Permission is granted on the *root* dept folder and applies to all
    children of that department.
    """
    if profile.role == AppRole.admin:
        return True
    col = getattr(FolderPermission, field)
    result = await db.execute(
        select(FolderPermission)
        .join(LibraryFolder, FolderPermission.folder_id == LibraryFolder.id)
        .where(
            LibraryFolder.department == folder.department,
            LibraryFolder.parent_id.is_(None),
            FolderPermission.role == profile.role,
            col.is_(True),
        )
    )
    return result.scalar_one_or_none() is not None


async def _can_view_dept(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_view")


async def _can_upload_to(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_upload")


async def _can_download_from(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_download")


async def _can_rename_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_rename")


async def _can_delete_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_delete")


async def _can_move_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_move")


async def _can_create_folder_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_create_folder")


async def _can_rename_folder_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_rename_folder")


async def _can_delete_folder_in(db, profile, folder) -> bool:
    return await _has_folder_perm(db, profile, folder, "can_delete_folder")


def _is_librarian(profile: Profile) -> bool:
    """Pustakawan = anyone in LIBRARIAN_ROLES (director, manager) + admin.

    Used to gate view-request approval endpoints. Admin always counts.
    """
    return profile.role.value in LIBRARIAN_ROLES or profile.role == AppRole.admin


async def _write_log(
    db: AsyncSession,
    actor: Profile,
    action: str,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    entry = LibraryAuditLog(
        actor_id=actor.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        log_metadata=metadata,
    )
    db.add(entry)


def _file_meta(f: LibraryFile) -> dict:
    """Return metadata-only dict (no drive link — content is locked)."""
    return {
        "id": str(f.id),
        "file_name": f.file_name or f.original_name,
        "original_name": f.original_name,
        "doc_type": f.doc_type,
        "doc_number": f.doc_number,
        "title": f.title,
        "client_code": f.client_code,
        "client_name": f.client_name,
        "project_code": f.project_code,
        "project_name": f.project_name,
        "note": f.note,
        "file_size": f.file_size,
        "mime_type": f.mime_type,
        "uploader_id": str(f.uploader_id),
        "upload_status": f.upload_status.value,
        "created_at": f.created_at.isoformat(),
    }



def _redact_email(email: str) -> str:
    """Show 'b**i@gmail.com' instead of full email."""
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return local + "@" + domain
    return local[0] + "*" * (len(local) - 2) + local[-1] + "@" + domain



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_filename(
    doc_type: str | None,
    archive_number: str,
    title: str,
    note: str | None,
    ext: str,
) -> str:
    def clean(s: str) -> str:
        return s.replace("/", "-").replace("\\", "-").strip()

    middle = clean(title) if title else "Untitled"
    suffix = f"-{clean(note)}" if note else ""
    if doc_type:
        return f"{doc_type.upper()}-{archive_number}-{middle}{suffix}{ext}"
    return f"{middle}{suffix}{ext}"


def _sanitize_filename(name: str) -> str:
    """Strip path separators and Windows-illegal chars; collapse runs of spaces."""
    bad = '\\/:*?"<>|'
    cleaned = "".join("-" if c in bad else c for c in name).strip()
    while "  " in cleaned:
        cleaned = cleaned.replace("  ", " ")
    return cleaned or "Untitled"


def _strip_ext(filename: str) -> str:
    if "." in filename:
        return filename.rsplit(".", 1)[0]
    return filename


def _html_page(title: str, body: str, error: bool = False) -> str:
    color = "#e53e3e" if error else "#38a169"
    return f"""<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><title>{title} — REIN Library</title>
<style>
  body{{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;min-height:100vh;margin:0;background:#f7fafc}}
  .card{{background:#fff;border-radius:12px;padding:2.5rem 3rem;max-width:440px;
         box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}}
  h1{{color:{color};font-size:1.4rem;margin-bottom:.75rem}}
  p{{color:#4a5568;line-height:1.6}}
  small{{color:#a0aec0;display:block;margin-top:1.5rem}}
</style></head>
<body>
<div class="card">
  <h1>{title}</h1>
  <p>{body}</p>
  <small>REIN Digital Library — tutup tab ini</small>
</div>
</body></html>"""
