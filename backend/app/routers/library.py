"""Digital Library router — folder tree, propose/confirm upload, view requests."""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_current_profile, require_role
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
from db.models.library_file import LibraryFile, LibraryFileStatus
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

router = APIRouter()
logger = logging.getLogger(__name__)

# Temp folder name in Drive — files land here during audit
DRIVE_TEMP_FOLDER_NAME = "_TEMP_AUDIT"

# Approved link validity
LINK_TTL_MINUTES = 30

ALLOWED_EXTENSIONS = {".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ---------------------------------------------------------------------------
# Dependency helpers
# ---------------------------------------------------------------------------

async def _get_temp_folder_id() -> str:
    """Return or create the Drive TEMP folder under root."""
    from app.services.gdrive import find_or_create_folder

    return await find_or_create_folder(
        DRIVE_TEMP_FOLDER_NAME, settings.google_drive_root_folder_id
    )


def _can_upload_to(profile: Profile, folder: LibraryFolder) -> bool:
    """Admin/director can upload anywhere. Others only to their dept shelf."""
    if profile.role in (AppRole.admin, AppRole.director):
        return True
    allowed_roles = DEPT_ROLE_MAP.get(folder.department, set())
    return profile.role.value in allowed_roles


def _can_view_dept(profile: Profile, folder: LibraryFolder) -> bool:
    """Admin/director can browse any dept's file list. Others only their own dept."""
    if profile.role in (AppRole.admin, AppRole.director):
        return True
    allowed_roles = DEPT_ROLE_MAP.get(folder.department, set())
    return profile.role.value in allowed_roles


def _is_librarian(profile: Profile) -> bool:
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


@router.get("/tree")
async def get_folder_tree(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return folder tree filtered to the user's own dept (admin/director get all)."""
    base_where = [LibraryFolder.is_active.is_(True)]

    if profile.role not in (AppRole.admin, AppRole.director):
        user_depts = [
            dept for dept, roles in DEPT_ROLE_MAP.items()
            if profile.role.value in roles
        ]
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
async def get_public_index(
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
async def list_folder_files(
    folder_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
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

    # Cross-dept: return summary only (no file listing)
    if not _can_view_dept(profile, folder):
        row = (
            await db.execute(
                select(func.count(LibraryFile.id), func.max(LibraryFile.created_at)).where(
                    LibraryFile.folder_id == folder_id,
                    LibraryFile.upload_status == LibraryFileStatus.passed,
                    LibraryFile.is_deleted.is_(False),
                )
            )
        ).one()
        return {
            "restricted": True,
            "folder": {
                "id": str(folder.id),
                "name": folder.name,
                "department": folder.department,
                "dept_label": DEPT_LABELS.get(folder.department, folder.department),
            },
            "file_count": row[0] or 0,
            "last_updated": row[1].isoformat() if row[1] else None,
        }

    offset = (page - 1) * page_size
    files_result = await db.execute(
        select(LibraryFile)
        .where(
            LibraryFile.folder_id == folder_id,
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
        .order_by(LibraryFile.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    files = files_result.scalars().all()

    total_result = await db.execute(
        select(func.count(LibraryFile.id)).where(
            LibraryFile.folder_id == folder_id,
            LibraryFile.upload_status == LibraryFileStatus.passed,
            LibraryFile.is_deleted.is_(False),
        )
    )
    total = total_result.scalar() or 0

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
    }


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


# ---------------------------------------------------------------------------
# POST /api/library/propose
# Lightweight: just detects metadata from filename, no file transferred yet
# ---------------------------------------------------------------------------

class ProposeRequest(BaseModel):
    filename: str
    file_size: int
    folder_id: str | None = None


@router.post("/propose")
async def propose_file(
    body: ProposeRequest,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Detect metadata from filename. No upload happens here."""
    from app.services.metadata import detect_metadata_from_filename

    detected = await detect_metadata_from_filename(body.filename, db)

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
    }


# ---------------------------------------------------------------------------
# POST /api/library/upload   (multipart form — called after user confirms)
# ---------------------------------------------------------------------------

@router.post("/upload", status_code=202)
async def upload_file(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    folder_id: str = Form(...),
    doc_type: str | None = Form(None),
    client_code: str | None = Form(None),
    client_name: str | None = Form(None),
    project_code: str | None = Form(None),
    project_name: str | None = Form(None),
    title: str | None = Form(None),
    note: str | None = Form(None),
):
    """
    Receive confirmed file + metadata. Upload to Drive TEMP, then hand off to
    the 4-layer audit pipeline. Returns 202 immediately so user can close browser.
    """
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

    if not _can_upload_to(profile, folder):
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

    # ── Build final filename ───────────────────────────────────────────────────
    content_hash = hashlib.sha256(content).hexdigest()
    file_name = _build_filename(
        doc_type=doc_type,
        client_code=client_code,
        title=title or _strip_ext(original_name),
        project_name=project_name,
        note=note,
        ext=ext,
    )

    # ── Persist to DB (status = uploading) ────────────────────────────────────
    lib_file = LibraryFile(
        folder_id=uuid.UUID(folder_id),
        original_name=original_name,
        file_name=file_name,
        doc_type=doc_type,
        title=title or _strip_ext(original_name),
        client_code=client_code,
        client_name=client_name,
        project_code=project_code,
        project_name=project_name,
        note=note,
        file_size=len(content),
        mime_type=file.content_type or "application/octet-stream",
        content_hash=content_hash,
        upload_status=LibraryFileStatus.uploading,
        uploader_id=profile.id,
        proposal_metadata={
            "doc_type": doc_type,
            "client_code": client_code,
            "project_code": project_code,
            "title": title,
            "note": note,
        },
    )
    db.add(lib_file)
    await db.flush()  # materialize lib_file.id before FK references

    # Create 4 pending audit job rows
    for layer, name in LAYER_NAMES.items():
        db.add(AuditJob(
            file_id=lib_file.id,
            layer=layer,
            layer_name=name,
            status="pending",
        ))

    await _write_log(
        db, profile, LOG_UPLOAD,
        target_type="file",
        target_id=lib_file.id,
        metadata={"filename": file_name, "size": len(content), "folder_id": folder_id},
    )
    await db.commit()

    # ── Drive upload + audit pipeline (background, user can close browser) ────
    import asyncio
    asyncio.create_task(
        _background_upload_and_audit(lib_file.id, content, file_name, file.content_type or "application/octet-stream")
    )

    return {
        "file_id": str(lib_file.id),
        "file_name": file_name,
        "status": "uploading",
        "message": "File diterima dan sedang diproses. Anda dapat menutup browser.",
    }


async def _background_upload_and_audit(
    file_id: uuid.UUID,
    content: bytes,
    file_name: str,
    mime_type: str,
) -> None:
    """Upload to Drive TEMP, then enqueue 4-layer audit. Fire-and-forget."""
    import io
    from app.services import gdrive
    from app.services.task_queue import task_queue, TaskType
    from db.session import async_session_factory

    try:
        temp_folder_id = await _get_temp_folder_id()
        drive_result = await gdrive.upload_file(
            io.BytesIO(content),
            file_name,
            mime_type,
            temp_folder_id,
            file_size=len(content),
        )

        async with async_session_factory() as db:
            result = await db.execute(
                select(LibraryFile).where(LibraryFile.id == file_id)
            )
            lib_file = result.scalar_one_or_none()
            if lib_file:
                lib_file.gdrive_file_id = drive_result.get("id")
                lib_file.gdrive_web_link = drive_result.get("webViewLink")
                lib_file.upload_status = LibraryFileStatus.in_audit
                await db.commit()

        task_queue.enqueue(TaskType.AUDIT_FILE, {"file_id": str(file_id)})
        logger.info("File %s uploaded to Drive TEMP, audit enqueued", file_id)

    except Exception as exc:
        logger.error("Background upload failed for file %s: %s", file_id, exc, exc_info=True)
        async with async_session_factory() as db:
            result = await db.execute(
                select(LibraryFile).where(LibraryFile.id == file_id)
            )
            lib_file = result.scalar_one_or_none()
            if lib_file:
                lib_file.upload_status = LibraryFileStatus.failed
                await db.commit()


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

    # Director: direct access — return link immediately
    if profile.role == AppRole.director and lib_file.gdrive_web_link:
        await _write_log(db, profile, LOG_VIEW_APPROVED, "file", file_id,
                         metadata={"direct": True})
        await db.commit()
        return {
            "status": "approved",
            "direct_access": True,
            "temp_link": lib_file.gdrive_web_link,
            "message": "Akses langsung diberikan sebagai Direktur",
        }

    # Admin: full access too
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
            f"Permintaan dikirim ke {len(librarians)} Pustakawan. "
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
    # Admin + Director bypass
    if profile.role in (AppRole.admin, AppRole.director):
        file_result = await db.execute(
            select(LibraryFile).where(LibraryFile.id == file_id)
        )
        lib_file = file_result.scalar_one_or_none()
        if lib_file and lib_file.gdrive_web_link:
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

@router.delete("/files/{file_id}", dependencies=[Depends(require_role(AppRole.admin))])
async def delete_file(
    file_id: uuid.UUID,
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Soft-delete a file. Only admin can do this."""
    file_result = await db.execute(
        select(LibraryFile).where(LibraryFile.id == file_id)
    )
    lib_file = file_result.scalar_one_or_none()
    if not lib_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="File tidak ditemukan")

    lib_file.is_deleted = True
    lib_file.upload_status = LibraryFileStatus.archived

    await _write_log(
        db, profile, LOG_FILE_DELETE, "file", file_id,
        metadata={"filename": lib_file.file_name, "folder_id": str(lib_file.folder_id)},
    )
    await db.commit()
    return {"message": "File dihapus dari perpustakaan"}


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
    """Create a sub-folder inside an existing department shelf."""
    if profile.role not in (AppRole.admin, AppRole.director, AppRole.manager, AppRole.operational_manager):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tidak memiliki izin membuat folder")

    parent_path = ""
    if body.parent_id:
        parent_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.id == uuid.UUID(body.parent_id))
        )
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Parent folder tidak ditemukan")
        parent_path = parent.path + " / "

    folder = LibraryFolder(
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        department=body.department,
        name=body.name,
        folder_type=body.folder_type,
        path=parent_path + body.name,
        created_by=profile.id,
    )
    db.add(folder)
    await _write_log(db, profile, LOG_FOLDER_CREATE, "folder",
                     metadata={"name": body.name, "department": body.department})
    await db.commit()

    return {"id": str(folder.id), "path": folder.path}


# ---------------------------------------------------------------------------
# GET /api/library/admin/temp   (admin only)
# ---------------------------------------------------------------------------

@router.get("/admin/temp", dependencies=[Depends(require_role(AppRole.admin))])
async def get_admin_temp(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Admin panel: in-progress / stuck files + recent activity log."""
    # Files not yet resolved: uploading, in_audit, or failed (not deleted)
    temp_result = await db.execute(
        select(LibraryFile)
        .where(
            LibraryFile.upload_status.in_([
                LibraryFileStatus.uploading,
                LibraryFileStatus.in_audit,
                LibraryFileStatus.failed,
            ]),
            LibraryFile.is_deleted.is_(False),
        )
        .order_by(LibraryFile.created_at.desc())
        .limit(100)
    )
    temp_files = temp_result.scalars().all()

    # Audit jobs for those files
    file_ids = [f.id for f in temp_files]
    jobs_by_file: dict[uuid.UUID, list] = {}
    if file_ids:
        jobs_result = await db.execute(
            select(AuditJob)
            .where(AuditJob.file_id.in_(file_ids))
            .order_by(AuditJob.layer)
        )
        for j in jobs_result.scalars().all():
            jobs_by_file.setdefault(j.file_id, []).append({
                "layer": j.layer,
                "layer_name": j.layer_name,
                "status": j.status,
                "result": j.result,
            })

    # Recent activity log (100 most recent entries)
    log_result = await db.execute(
        select(LibraryAuditLog)
        .order_by(LibraryAuditLog.created_at.desc())
        .limit(100)
    )
    log_entries = log_result.scalars().all()

    return {
        "temp_files": [
            {
                **_file_meta(f),
                "upload_status": f.upload_status.value,
                "audit_layers": jobs_by_file.get(f.id, []),
            }
            for f in temp_files
        ],
        "activity_log": [
            {
                "id": str(e.id),
                "action": e.action,
                "actor_id": str(e.actor_id) if e.actor_id else None,
                "target_type": e.target_type,
                "target_id": str(e.target_id) if e.target_id else None,
                "meta": e.log_metadata,
                "created_at": e.created_at.isoformat(),
            }
            for e in log_entries
        ],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_filename(
    doc_type: str | None,
    client_code: str | None,
    title: str,
    project_name: str | None,
    note: str | None,
    ext: str,
) -> str:
    def clean(s: str) -> str:
        return s.replace("/", "-").replace("\\", "-").strip()

    parts = []
    if doc_type:
        parts.append(doc_type.upper())
    if client_code:
        parts.append(clean(client_code).upper())
    middle = clean(title) if title else "Untitled"
    suffix_parts = []
    if project_name:
        suffix_parts.append(clean(project_name))
    if note:
        suffix_parts.append(clean(note))
    suffix = ("-" + "-".join(suffix_parts)) if suffix_parts else ""
    prefix = "-".join(parts) + "-" if parts else ""
    return f"{prefix}{middle}{suffix}{ext}"


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
