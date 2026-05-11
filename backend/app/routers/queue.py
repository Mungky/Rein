"""Queue router — upload queue status and statistics."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_permission
from db.models.document import Document
from db.models.profile import Profile
from db.models.upload_queue import UploadQueue, UploadStatus
from db.session import get_db

router = APIRouter()


@router.get("/status")
async def get_queue_status(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """Get current user's upload queue (processing + completed today)."""
    # Processing items
    processing_q = (
        select(UploadQueue)
        .where(UploadQueue.user_id == profile.id)
        .where(UploadQueue.status.in_([
            UploadStatus.detecting,
            UploadStatus.awaiting_confirmation,
            UploadStatus.uploading,
        ]))
        .order_by(UploadQueue.created_at.desc())
    )
    processing_result = await db.execute(processing_q)
    processing = processing_result.scalars().all()

    # Completed today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    completed_q = (
        select(UploadQueue)
        .where(UploadQueue.user_id == profile.id)
        .where(UploadQueue.status == UploadStatus.completed)
        .where(UploadQueue.created_at >= today_start)
        .order_by(UploadQueue.created_at.desc())
    )
    completed_result = await db.execute(completed_q)
    completed = completed_result.scalars().all()

    def format_item(item: UploadQueue) -> dict:
        return {
            "id": str(item.id),
            "name": item.original_name,
            "size": item.file_size,
            "status": item.status.value,
            "mime_type": item.mime_type,
            "detected_type": item.detected_type,
            "detected_client": item.detected_client,
            "detected_project": item.detected_project,
            "created_at": str(item.created_at) if item.created_at else None,
        }

    return {
        "processing": [format_item(i) for i in processing],
        "completed": [format_item(i) for i in completed],
    }


@router.get("/stats")
async def get_queue_stats(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """Get queue statistics — total documents, monthly count, active clients/projects."""
    # Total documents
    total_q = select(func.count()).select_from(Document)
    total = (await db.execute(total_q)).scalar() or 0

    # Monthly count
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_q = select(func.count()).select_from(Document).where(
        Document.created_at >= month_start
    )
    monthly = (await db.execute(monthly_q)).scalar() or 0

    # Active clients
    clients_q = select(func.count(Document.client_name.distinct())).where(
        Document.client_name.isnot(None)
    )
    clients = (await db.execute(clients_q)).scalar() or 0

    # Active projects
    projects_q = select(func.count(Document.project_name.distinct())).where(
        Document.project_name.isnot(None)
    )
    projects = (await db.execute(projects_q)).scalar() or 0

    return {
        "total_documents": total,
        "monthly_count": monthly,
        "active_clients": clients,
        "active_projects": projects,
    }