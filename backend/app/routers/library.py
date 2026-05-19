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
from sqlalchemy import func, select, text as sa_text
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

@router.post("/upload", status_code=201)
async def upload_file(
    profile: Annotated[Profile, Depends(get_current_profile)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    folder_id: str = Form(...),
    doc_type: str | None = Form(None),
    doc_number: str | None = Form(None),
    title: str | None = Form(None),
    note: str | None = Form(None),
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

    # Commit sequence increment now to release the row lock before the Drive upload
    await db.commit()

    file_name = _build_filename(
        doc_type=doc_type,
        archive_number=archive_number,
        title=title or _strip_ext(original_name),
        note=note,
        ext=ext,
    )

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


def _redact_email(email: str) -> str:
    """Show 'b**i@gmail.com' instead of full email."""
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return local + "@" + domain
    return local[0] + "*" * (len(local) - 2) + local[-1] + "@" + domain


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
    """Rename a folder. Allowed: admin OR user with can_rename on the dept."""
    folder_result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = folder_result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Folder tidak ditemukan")

    if profile.role != AppRole.admin and not await _can_rename_in(db, profile, folder):
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

    Allowed: admin OR user with can_delete on the dept.
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

    if profile.role != AppRole.admin and not await _can_delete_in(db, profile, folder):
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
    """Create a sub-folder. Allowed: admin OR user with can_upload on the dept."""
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

    # Permission check: admin OR can_upload on the dept
    if profile.role != AppRole.admin:
        # Build a synthetic folder ref for the dept check (only `department` is read)
        check_folder = parent if parent else LibraryFolder(department=body.department, name="", path="")
        if not await _can_upload_to(db, profile, check_folder):
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

    return {
        "entries": entries,
        "total": total,
        "page": page,
        "page_size": page_size,
        "stuck_count": stuck_count,
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
    """Return all root dept folders and the full role permission matrix."""
    # Root dept folders only
    folders_result = await db.execute(
        select(LibraryFolder)
        .where(
            LibraryFolder.is_active.is_(True),
            LibraryFolder.parent_id.is_(None),
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
            ))

    await db.commit()
    return {"updated": len(body.permissions)}


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
