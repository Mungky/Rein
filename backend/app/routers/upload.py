"""Upload router — propose/confirm/cancel flow for DCC file uploads.

Flow:
  1. PROPOSE  — POST /           → upload file to Drive, detect metadata, return proposal
  2. CONFIRM  — POST /{id}/confirm → accept/edit metadata, create Document record
  3. CANCEL   — DELETE /{id}     → delete Drive file, mark cancelled
  4. LIST     — GET /proposals   → list user's active proposals
"""

import logging
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from app.config import settings as app_settings
from app.schemas.upload import UploadProposalResponse, UploadConfirmRequest, UploadConfirmResponse
from app.services import gdrive, gsheets, metadata as metadata_service
from db.models.document import Document, DocType, DocStatus
from db.models.profile import Profile
from db.models.upload_queue import UploadQueue, UploadStatus
from db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
PROPOSAL_TTL = timedelta(minutes=30)

ALLOWED_EXTENSIONS = {
    ".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp",
}

MIME_MAP = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".dwg": "image/vnd.dwg",
    ".step": "application/step",
    ".stp": "application/step",
}


def _build_filename(
    doc_type: str,
    seq: int,
    client_code: str | None,
    title: str | None,
    project_name: str | None,
    note: str | None,
    original_name: str,
) -> str:
    """Build REIN standard filename: TYPE-SEQ-CLIENT-TITLE-PROJECT-NOTE.ext"""
    ext = ""
    if "." in original_name:
        ext = "." + original_name.rsplit(".", 1)[-1].lower()

    def clean(s: str) -> str:
        return re.sub(r'[\\/:*?"<>|]', "", s).strip()

    parts: list[str] = [f"{doc_type}-{seq}"]
    if client_code:
        parts.append(clean(client_code))
    if title:
        parts.append(clean(title))
    else:
        base = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
        parts.append(clean(base))
    if project_name:
        parts.append(clean(project_name))
    if note:
        parts.append(clean(note))

    return "-".join(parts) + ext


def _validate_extension(filename: str) -> str:
    """Return lowercase extension with dot. Raises 400 if not allowed."""
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama file tidak valid.",
        )
    dot = filename.rfind(".")
    if dot == -1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File \"{filename}\" tidak memiliki ekstensi. Format yang diterima: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), ZIP, RAR, DWG, STEP.",
        )
    ext = filename[dot:].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File {ext} tidak didukung. Format yang diterima: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), ZIP, RAR, DWG, STEP (.step/.stp).",
        )
    return ext


# ---------------------------------------------------------------------------
# PROPOSE — upload file and return metadata proposal
# ---------------------------------------------------------------------------


@router.post("/", response_model=UploadProposalResponse, status_code=status.HTTP_201_CREATED)
async def propose_upload(
    file: UploadFile = File(...),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """PROPOSE step: stream file to Drive, detect metadata, return proposal with TTL."""
    filename = file.filename or "unknown"
    ext = _validate_extension(filename)

    # Stream file to SpooledTemporaryFile
    tmp = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
    file_size = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        file_size += len(chunk)
        if file_size > MAX_FILE_SIZE:
            tmp.close()
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File terlalu besar. Maksimal {MAX_FILE_SIZE // (1024*1024)}MB.",
            )
        tmp.write(chunk)

    if file_size == 0:
        tmp.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File kosong.",
        )

    tmp.seek(0)
    mime_type = file.content_type or MIME_MAP.get(ext, "application/octet-stream")

    # Create queue entry with "uploading" status
    queue_entry = UploadQueue(
        user_id=profile.id,
        original_name=filename,
        file_size=file_size,
        mime_type=mime_type,
        status=UploadStatus.uploading,
    )
    db.add(queue_entry)
    await db.flush()
    await db.refresh(queue_entry)

    # Upload to Google Drive
    target_folder_id = app_settings.google_drive_root_folder_id
    try:
        drive_result = await gdrive.upload_file(
            file_stream=tmp,
            file_name=filename,
            mime_type=mime_type,
            folder_id=target_folder_id,
            file_size=file_size,
        )
    except Exception as e:
        logger.error("Drive upload failed for %s: %s", filename, e)
        queue_entry.status = UploadStatus.failed
        await db.flush()
        tmp.close()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gagal mengunggah ke Google Drive: {e}",
        )
    finally:
        tmp.close()

    gdrive_file_id = drive_result.get("id", "")
    gdrive_link = drive_result.get("webViewLink", "")

    queue_entry.gdrive_file_id = gdrive_file_id
    queue_entry.gdrive_folder_id = target_folder_id

    # Detect metadata from filename — hybrid (regex+DB first, LLM fallback when confidence < 0.6)
    detected = await metadata_service.detect_metadata_hybrid(filename, db)
    queue_entry.detected_type = detected.doc_type
    queue_entry.detected_client = detected.client_name
    queue_entry.confidence_type = detected.doc_type_confidence
    queue_entry.confidence_client = detected.client_confidence
    queue_entry.detected_project = detected.project_name
    queue_entry.confidence_project = detected.project_confidence
    queue_entry.detected_folder = detected.folder_path
    queue_entry.confidence_folder = detected.folder_confidence

    # Set status and TTL
    expires_at = datetime.now(timezone.utc) + PROPOSAL_TTL
    queue_entry.status = UploadStatus.awaiting_confirmation
    queue_entry.proposal_expires_at = expires_at
    await db.flush()

    return UploadProposalResponse(
        id=str(queue_entry.id),
        filename=filename,
        size=file_size,
        mime_type=mime_type,
        status=queue_entry.status.value,
        detected_type=detected.doc_type,
        detected_type_confidence=detected.doc_type_confidence,
        detected_client_code=detected.client_code,
        detected_client_name=detected.client_name,
        detected_client_confidence=detected.client_confidence,
        detected_project_code=detected.project_code,
        detected_project_name=detected.project_name,
        detected_project_confidence=detected.project_confidence,
        detected_folder=detected.folder_path,
        detected_folder_confidence=detected.folder_confidence,
        gdrive_link=gdrive_link,
        expires_at=expires_at,
    )


# ---------------------------------------------------------------------------
# CONFIRM — accept/edit metadata and create Document record
# ---------------------------------------------------------------------------


@router.post("/{upload_id}/confirm", response_model=UploadConfirmResponse)
async def confirm_upload(
    upload_id: uuid.UUID,
    body: UploadConfirmRequest | None = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """CONFIRM step: accept or edit metadata, create Document, optionally move file."""
    queue_entry = await db.get(UploadQueue, upload_id)
    if queue_entry is None:
        raise HTTPException(status_code=404, detail="Upload tidak ditemukan")

    if queue_entry.user_id != profile.id:
        raise HTTPException(status_code=403, detail="Tidak diotorisasi")

    if queue_entry.status != UploadStatus.awaiting_confirmation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Upload tidak bisa dikonfirmasi (status: {queue_entry.status.value})",
        )

    # Check proposal TTL
    if queue_entry.proposal_expires_at and datetime.now(timezone.utc) > queue_entry.proposal_expires_at:
        if queue_entry.gdrive_file_id:
            try:
                await gdrive.delete_file(queue_entry.gdrive_file_id)
            except Exception as e:
                logger.warning("Failed to delete expired Drive file %s: %s", queue_entry.gdrive_file_id, e)
        queue_entry.status = UploadStatus.cancelled
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Proposal sudah kadaluarsa. Silakan unggah ulang.",
        )

    # Resolve metadata — user edits override detected values
    resolved_type = (body.doc_type if body and body.doc_type else queue_entry.detected_type) or "OTHER"
    resolved_client_code = body.client_code if body and body.client_code else None
    resolved_client_name = body.client_name if body and body.client_name else queue_entry.detected_client
    resolved_project_code = body.project_code if body and body.project_code else None
    resolved_project_name = body.project_name if body and body.project_name else queue_entry.detected_project
    resolved_folder = body.folder_path if body and body.folder_path else queue_entry.detected_folder
    resolved_note = (body.note or "").strip() or None if body else None

    # Look up names from DB when codes are provided but names are missing
    if resolved_client_code and not resolved_client_name:
        from db.models.client import Client
        result = await db.execute(select(Client).where(Client.code == resolved_client_code))
        db_client = result.scalar_one_or_none()
        if db_client:
            resolved_client_name = db_client.name

    if resolved_project_code and not resolved_project_name:
        from db.models.project import Project
        result = await db.execute(select(Project).where(Project.code == resolved_project_code))
        db_project = result.scalar_one_or_none()
        if db_project:
            resolved_project_name = db_project.name

    # Compute folder from resolved names if not explicitly set
    if not resolved_folder and (resolved_client_name or resolved_project_name):
        parts = [n for n in [resolved_client_name, resolved_project_name] if n]
        resolved_folder = "/".join(parts)

    # Compute per-type sequence number (atomic within transaction)
    doc_type_enum = DocType(resolved_type) if resolved_type in [e.value for e in DocType] else DocType.OTHER
    seq_result = await db.execute(
        select(func.max(Document.doc_sequence)).where(Document.doc_type == doc_type_enum)
    )
    next_seq: int = (seq_result.scalar() or 0) + 1

    # Generate doc number: TYPE-SEQ (e.g. DD-125)
    doc_number = f"{doc_type_enum.value}-{next_seq}"

    # Move file to correct folder using client/project names
    gdrive_folder_id = queue_entry.gdrive_folder_id
    if resolved_client_name or resolved_project_name:
        try:
            target_folder_id = await gdrive.build_folder_path(
                client_name=resolved_client_name or "Unknown",
                project_name=resolved_project_name or "Unknown",
            )
            if queue_entry.gdrive_file_id:
                await gdrive.move_file(queue_entry.gdrive_file_id, target_folder_id)
                gdrive_folder_id = target_folder_id
            if not resolved_folder:
                resolved_folder = f"{resolved_client_name or 'Unknown'}/{resolved_project_name or 'Unknown'}"
        except Exception as e:
            logger.warning("Failed to move file to project folder: %s", e)

    # Rename file in Drive to REIN standard format
    if queue_entry.gdrive_file_id:
        try:
            new_filename = _build_filename(
                doc_type=doc_type_enum.value,
                seq=next_seq,
                client_code=resolved_client_code,
                title=body.title if body and body.title else None,
                project_name=resolved_project_name,
                note=resolved_note,
                original_name=queue_entry.original_name,
            )
            await gdrive.rename_file(queue_entry.gdrive_file_id, new_filename)
        except Exception as e:
            logger.warning("Failed to rename Drive file: %s", e)
            new_filename = queue_entry.original_name

    # Create Document record
    doc = Document(
        doc_number=doc_number,
        doc_sequence=next_seq,
        doc_type=doc_type_enum,
        title=body.title if body and body.title else queue_entry.original_name,
        note=resolved_note,
        client_name=resolved_client_name,
        client_code=resolved_client_code,
        project_name=resolved_project_name,
        project_code=resolved_project_code,
        folder_path=resolved_folder,
        file_name=new_filename,
        file_size=queue_entry.file_size,
        mime_type=queue_entry.mime_type,
        gdrive_file_id=queue_entry.gdrive_file_id,
        gdrive_folder_id=gdrive_folder_id,
        gdrive_web_link=None,
        status=DocStatus.draft,
        uploaded_by=profile.id,
    )
    db.add(doc)

    queue_entry.status = UploadStatus.completed
    await db.flush()
    await db.refresh(doc)

    # Index to Google Sheets (non-blocking)
    try:
        drive_link_for_index = ""
        if queue_entry.gdrive_file_id:
            try:
                fi = await gdrive.get_file(queue_entry.gdrive_file_id)
                drive_link_for_index = fi.get("webViewLink", "")
            except Exception:
                pass
        await gsheets.add_document_row_safe({
            "doc_sequence": next_seq,
            "doc_type": doc_type_enum.value,
            "client_name": resolved_client_name or "",
            "client_code": resolved_client_code or "",
            "project_name": resolved_project_name or "",
            "project_code": resolved_project_code or "",
            "file_name": new_filename,
            "note": resolved_note or "",
            "folder_path": resolved_folder or "",
            "gdrive_link": drive_link_for_index,
            "uploaded_by": profile.full_name,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        })
    except Exception as e:
        logger.warning("Sheets indexing error (non-fatal): %s", e)

    # Get Drive link for response
    drive_link = None
    if queue_entry.gdrive_file_id:
        try:
            file_info = await gdrive.get_file(queue_entry.gdrive_file_id)
            drive_link = file_info.get("webViewLink")
        except Exception:
            pass

    return UploadConfirmResponse(
        id=str(queue_entry.id),
        document_id=str(doc.id),
        doc_number=doc.doc_number,
        status="completed",
        gdrive_link=drive_link,
    )


# ---------------------------------------------------------------------------
# CANCEL — delete Drive file and mark as cancelled
# ---------------------------------------------------------------------------


@router.delete("/{upload_id}", response_model=dict)
async def cancel_upload(
    upload_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """Cancel an upload — delete from Drive if uploaded, mark as cancelled."""
    queue_entry = await db.get(UploadQueue, upload_id)
    if queue_entry is None:
        raise HTTPException(status_code=404, detail="Upload tidak ditemukan")

    if queue_entry.user_id != profile.id:
        raise HTTPException(status_code=403, detail="Tidak diotorisasi")

    if queue_entry.status not in (UploadStatus.awaiting_confirmation, UploadStatus.uploading):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Upload tidak bisa dibatalkan (status: {queue_entry.status.value})",
        )

    if queue_entry.gdrive_file_id:
        try:
            await gdrive.delete_file(queue_entry.gdrive_file_id)
        except Exception as e:
            logger.warning("Failed to delete Drive file %s on cancel: %s", queue_entry.gdrive_file_id, e)

    queue_entry.status = UploadStatus.cancelled
    await db.flush()

    return {"id": str(upload_id), "status": "cancelled"}


# ---------------------------------------------------------------------------
# LIST — get user's active proposals
# ---------------------------------------------------------------------------


@router.get("/proposals", response_model=list[UploadProposalResponse])
async def list_proposals(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """List the current user's active (non-expired) proposals."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(UploadQueue)
        .where(
            UploadQueue.user_id == profile.id,
            UploadQueue.status == UploadStatus.awaiting_confirmation,
            UploadQueue.proposal_expires_at > now,
        )
        .order_by(UploadQueue.created_at.desc())
    )
    proposals = result.scalars().all()

    response = []
    for entry in proposals:
        drive_link = None
        if entry.gdrive_file_id:
            try:
                file_info = await gdrive.get_file(entry.gdrive_file_id)
                drive_link = file_info.get("webViewLink")
            except Exception:
                pass

        response.append(UploadProposalResponse(
            id=str(entry.id),
            filename=entry.original_name,
            size=entry.file_size,
            mime_type=entry.mime_type,
            status=entry.status.value,
            detected_type=entry.detected_type,
            detected_type_confidence=entry.confidence_type or 0.0,
            detected_client_code=None,
            detected_client_name=entry.detected_client,
            detected_client_confidence=entry.confidence_client or 0.0,
            detected_project_code=None,
            detected_project_name=entry.detected_project,
            detected_project_confidence=entry.confidence_project or 0.0,
            detected_folder=entry.detected_folder,
            detected_folder_confidence=entry.confidence_folder or 0.0,
            gdrive_link=drive_link,
            expires_at=entr