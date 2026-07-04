"""Digital Library — view-request lifecycle + librarian email approval.

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
# POST /api/library/files/{file_id}/view-request
# ---------------------------------------------------------------------------

@router.post("/files/{file_id}/view-request", status_code=201)
async def request_view_access(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Request view access to a file's content.
    Director: auto-approved. Others: email sent to all Pustakawan (Director + Manager).
    """
    # Verify file exists and is accessible
    file_result = await db.execute(
        select(LibraryFile).where(
            LibraryFile.id == file_id,
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
    )
    lib_file = file_result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    # Look up the file's folder for permission check
    folder_result = await db.execute(
        select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
    )
    file_folder = folder_result.scalar_one_or_none()

    # Admin: always direct access
    if profile.role == AppRole.admin and lib_file.gdrive_web_link:
        await _write_log(db, profile, LOG_VIEW_APPROVED, "file", file_id,
                         metadata={"direct": True, "role": "admin"})
        await db.commit()
        return {
            "status": "approved",
            "direct_access": True,
            "temp_link": lib_file.gdrive_web_link,
            "message": "Akses diberikan sebagai Administrator",
        }

    # User with can_download on this dept: direct access (no approval needed)
    if file_folder and lib_file.gdrive_web_link and await _can_download_from(db, profile, file_folder):
        await _write_log(db, profile, LOG_VIEW_APPROVED, "file", file_id,
                         metadata={"direct": True, "role": profile.role.value})
        await db.commit()
        return {
            "status": "approved",
            "direct_access": True,
            "temp_link": lib_file.gdrive_web_link,
            "message": "Akses langsung berdasarkan izin download folder",
        }

    # Check existing pending request (avoid duplicates)
    existing_result = await db.execute(
        select(ViewRequest).where(
            ViewRequest.file_id == file_id,
            ViewRequest.requester_id == profile.id,
            ViewRequest.status == "pending",
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return {
            "status": "pending",
            "request_id": str(existing.id),
            "expires_at": existing.expires_at.isoformat(),
            "message": "Permintaan akses sudah dikirim dan menunggu persetujuan",
        }

    # Create view request
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=VIEW_REQUEST_TTL_SECONDS)
    view_req = ViewRequest(
        file_id=file_id,
        requester_id=profile.id,
        status="pending",
        approve_token=token,
        expires_at=expires_at,
    )
    db.add(view_req)

    await _write_log(db, profile, LOG_VIEW_REQUEST, "file", file_id,
                     metadata={"filename": lib_file.file_name})
    await db.commit()

    # Send email to configured Pustakawan email addresses
    from app.services.task_queue import task_queue, TaskType

    # LIBRARIAN_EMAILS env var: comma-separated real emails for Directors/Managers
    # Falls back to SMTP_FROM (admin email) so at least one person gets notified
    raw_emails = settings.librarian_emails or settings.smtp_from
    recipient_emails = [e.strip() for e in raw_emails.split(",") if e.strip()]

    approve_url = (
        f"{settings.frontend_url}/api/library/view-requests/{token}/approve"
    )
    deny_url = (
        f"{settings.frontend_url}/api/library/view-requests/{token}/deny"
    )
    subject = f"[REIN Library] Permintaan Akses: {lib_file.file_name or lib_file.original_name}"
    body = (
        f"{profile.full_name} ({profile.role.value}) meminta akses ke:\n"
        f"  {lib_file.file_name or lib_file.original_name}\n\n"
        f"Klik untuk menyetujui (berlaku {VIEW_REQUEST_TTL_SECONDS // 60} menit):\n"
        f"  {approve_url}\n\n"
        f"Klik untuk menolak:\n"
        f"  {deny_url}\n\n"
        f"REIN Digital Library"
    )

    for email in recipient_emails:
        task_queue.enqueue(TaskType.SEND_EMAIL, {
            "to": email,
            "subject": subject,
            "body": body,
        })

    return {
        "status": "pending",
        "request_id": str(view_req.id),
        "expires_at": expires_at.isoformat(),
        "message": (
            f"Permintaan dikirim ke {len(recipient_emails)} penerima. "
            f"Persetujuan pertama membuka akses (berlaku {VIEW_REQUEST_TTL_SECONDS // 60} menit)."
        ),
    }


# ---------------------------------------------------------------------------
# GET /api/library/view-requests/{token}/approve   (one-click from email)
# ---------------------------------------------------------------------------

@router.get("/view-requests/{token}/approve")
async def approve_view_request(
    token: str,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """One-click approval from email link. Any Pustakawan can approve."""
    if not _is_librarian(profile):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Hanya Pustakawan (Director/Manager) yang dapat menyetujui",
        )

    req_result = await db.execute(
        select(ViewRequest).where(ViewRequest.approve_token == token)
    )
    req = req_result.scalar_one_or_none()
    if not req:
        return HTMLResponse(_html_page("Token Tidak Valid", "Link persetujuan tidak valid.", error=True))

    now = datetime.now(timezone.utc)

    if req.status == "approved":
        return HTMLResponse(_html_page("Sudah Disetujui", "Akses untuk file ini sudah disetujui sebelumnya."))

    if req.status in ("denied", "expired") or req.expires_at < now:
        req.status = "expired"
        await db.commit()
        return HTMLResponse(_html_page("Kedaluwarsa", "Permintaan akses ini sudah kedaluwarsa atau ditolak.", error=True))

    # Approve
    file_result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == req.file_id)
    )
    lib_file = file_result.scalar_one_or_none()

    req.status = "approved"
    req.approved_by = profile.id
    req.approved_at = now
    req.temp_link = lib_file.gdrive_web_link if lib_file else None
    req.link_expires_at = now + timedelta(minutes=LINK_TTL_MINUTES)

    await _write_log(
        db, profile, LOG_VIEW_APPROVED, "view_request", req.id,
        metadata={"file_id": str(req.file_id), "requester_id": str(req.requester_id)},
    )
    await db.commit()

    return HTMLResponse(_html_page(
        "Akses Disetujui",
        f"Anda telah menyetujui permintaan akses.<br>"
        f"Pengguna dapat mengakses file selama {LINK_TTL_MINUTES} menit.",
    ))


# ---------------------------------------------------------------------------
# GET /api/library/view-requests/{token}/deny
# ---------------------------------------------------------------------------

@router.get("/view-requests/{token}/deny")
async def deny_view_request(
    token: str,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not _is_librarian(profile):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Akses ditolak")

    req_result = await db.execute(
        select(ViewRequest).where(ViewRequest.approve_token == token)
    )
    req = req_result.scalar_one_or_none()
    if not req or req.status not in ("pending",):
        return HTMLResponse(_html_page("Tidak Valid", "Permintaan ini tidak dapat diproses.", error=True))

    req.status = "denied"
    req.approved_by = profile.id
    req.approved_at = datetime.now(timezone.utc)
    await _write_log(db, profile, LOG_VIEW_DENIED, "view_request", req.id,
                     metadata={"file_id": str(req.file_id)})
    await db.commit()

    return HTMLResponse(_html_page("Ditolak", "Permintaan akses telah ditolak."))


# ---------------------------------------------------------------------------
# GET /api/library/view-requests/inbox   (Pustakawan: list pending)
# ---------------------------------------------------------------------------

@router.get("/view-requests/inbox")
async def list_view_request_inbox(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Pustakawan inbox: list pending view requests + recently resolved."""
    if not _is_librarian(profile):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Hanya Pustakawan yang dapat melihat inbox permintaan",
        )

    now = datetime.now(timezone.utc)
    # Auto-expire stale pending
    stale_result = await db.execute(
        select(ViewRequest).where(
            ViewRequest.status == "pending",
            ViewRequest.expires_at < now,
        )
    )
    for r in stale_result.scalars().all():
        r.status = "expired"

    pending_result = await db.execute(
        select(ViewRequest, LibraryFile, Profile)
        .join(LibraryFile, ViewRequest.file_id == LibraryFile.id)
        .join(Profile, ViewRequest.requester_id == Profile.id)
        .where(ViewRequest.status == "pending", ViewRequest.expires_at >= now)
        .order_by(ViewRequest.created_at.desc())
    )
    pending = pending_result.all()

    recent_result = await db.execute(
        select(ViewRequest, LibraryFile, Profile)
        .join(LibraryFile, ViewRequest.file_id == LibraryFile.id)
        .join(Profile, ViewRequest.requester_id == Profile.id)
        .where(ViewRequest.status.in_(("approved", "denied", "expired")))
        .order_by(ViewRequest.approved_at.desc().nullslast(), ViewRequest.created_at.desc())
        .limit(50)
    )
    recent = recent_result.all()

    await db.commit()

    def _shape(req: ViewRequest, lib_file: LibraryFile, requester: Profile) -> dict:
        return {
            "id": str(req.id),
            "status": req.status,
            "file_id": str(lib_file.id),
            "file_name": lib_file.file_name or lib_file.original_name,
            "doc_type": lib_file.doc_type,
            "requester_name": requester.full_name,
            "requester_username": requester.username,
            "requester_role": requester.role.value,
            "created_at": req.created_at.isoformat(),
            "expires_at": req.expires_at.isoformat() if req.expires_at else None,
            "approved_at": req.approved_at.isoformat() if req.approved_at else None,
        }

    return {
        "pending": [_shape(*row) for row in pending],
        "recent": [_shape(*row) for row in recent],
    }


@router.post("/view-requests/{req_id}/decide")
async def decide_view_request(
    req_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    action: str = Query(..., pattern="^(approve|deny)$"),
):
    """Approve or deny a view request via UI (Pustakawan only)."""
    if not _is_librarian(profile):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Akses ditolak")

    req_result = await db.execute(select(ViewRequest).where(ViewRequest.id == req_id))
    req = req_result.scalar_one_or_none()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Permintaan tidak ditemukan")
    if req.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Permintaan sudah dalam status '{req.status}'",
        )

    now = datetime.now(timezone.utc)
    if req.expires_at < now:
        req.status = "expired"
        await db.commit()
        raise HTTPException(status.HTTP_410_GONE, detail="Permintaan sudah kedaluwarsa")

    if action == "deny":
        req.status = "denied"
        req.approved_by = profile.id
        req.approved_at = now
        await _write_log(db, profile, LOG_VIEW_DENIED, "view_request", req.id,
                         metadata={"file_id": str(req.file_id)})
        await db.commit()
        return {"status": "denied", "id": str(req.id)}

    # action == approve
    file_result = await db.execute(select(LibraryFile).where(LibraryFile.id == req.file_id))
    lib_file = file_result.scalar_one_or_none()

    req.status = "approved"
    req.approved_by = profile.id
    req.approved_at = now
    req.temp_link = lib_file.gdrive_web_link if lib_file else None
    req.link_expires_at = now + timedelta(minutes=LINK_TTL_MINUTES)

    await _write_log(db, profile, LOG_VIEW_APPROVED, "view_request", req.id,
                     metadata={"file_id": str(req.file_id), "requester_id": str(req.requester_id)})
    await db.commit()
    return {
        "status": "approved",
        "id": str(req.id),
        "link_expires_at": req.link_expires_at.isoformat(),
    }


@router.get("/admin/email-config", dependencies=[Depends(require_role(AppRole.admin))])
async def get_email_config():
    """Admin: check SMTP + LIBRARIAN_EMAILS configuration without exposing secrets."""
    raw_emails = settings.librarian_emails or settings.smtp_from
    recipients = [e.strip() for e in raw_emails.split(",") if e.strip()]
    return {
        "smtp_configured": bool(settings.smtp_user and settings.smtp_password),
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_from": settings.smtp_from or None,
        "librarian_emails_configured": bool(settings.librarian_emails),
        "recipient_count": len(recipients),
        "recipients_redacted": [_redact_email(e) for e in recipients],
    }



@router.post("/admin/email-test", dependencies=[Depends(require_role(AppRole.admin))])
async def send_test_email(
    profile: Annotated[Profile, Depends(get_current_profile)],
):
    """Admin: send a test email to all LIBRARIAN_EMAILS recipients (synchronous, surfaces errors)."""
    from app.services.email import send_email

    raw_emails = settings.librarian_emails or settings.smtp_from
    recipients = [e.strip() for e in raw_emails.split(",") if e.strip()]
    if not recipients:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="LIBRARIAN_EMAILS / SMTP_FROM tidak diset di environment.",
        )

    if not settings.smtp_user or not settings.smtp_password:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP_USER / SMTP_PASSWORD tidak diset — email tidak dapat dikirim.",
        )

    sent = 0
    errors: list[str] = []
    for email in recipients:
        try:
            await send_email(
                to=email,
                subject="[REIN Library] Test Email",
                body=(
                    f"Halo,\n\nIni adalah email tes dari REIN Digital Library.\n"
                    f"Jika Anda menerima email ini, konfigurasi notifikasi sudah benar.\n\n"
                    f"Dikirim oleh: {profile.full_name} ({profile.username})\n"
                ),
            )
            sent += 1
        except Exception as exc:
            errors.append(f"{_redact_email(email)}: {exc}")

    return {
        "sent": sent,
        "recipients": len(recipients),
        "errors": errors,
    }


