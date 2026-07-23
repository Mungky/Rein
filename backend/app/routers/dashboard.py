"""Dashboard router — KPI stats and activity feed for the dashboard."""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from app.limiter import READ_LIMIT, limiter
from db.models.document import Document, DocStatus
from db.models.profile import Profile
from db.models.upload_queue import UploadQueue, UploadStatus
from db.models.approval import Approval, ApprovalAction
from db.session import get_db

router = APIRouter()


@router.get("/stats")
@limiter.limit(READ_LIMIT)
async def get_dashboard_stats(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dashboard:view"))] = None,
):
    """Get KPI statistics — active projects, documents count, pending approvals."""
    # Total documents
    total_docs_q = select(func.count()).select_from(Document)
    total_docs = (await db.execute(total_docs_q)).scalar() or 0

    # Documents this month
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_q = select(func.count()).select_from(Document).where(
        Document.created_at >= month_start
    )
    monthly_count = (await db.execute(monthly_q)).scalar() or 0

    # Pending approvals
    pending_q = select(func.count()).select_from(Approval).where(
        Approval.action.is_(None)
    )
    pending_approvals = (await db.execute(pending_q)).scalar() or 0

    # Active clients (distinct client_name)
    clients_q = select(func.count(Document.client_name.distinct())).where(
        Document.client_name.isnot(None)
    )
    active_clients = (await db.execute(clients_q)).scalar() or 0

    # Active projects (distinct project_name)
    projects_q = select(func.count(Document.project_name.distinct())).where(
        Document.project_name.isnot(None)
    )
    active_projects = (await db.execute(projects_q)).scalar() or 0

    # Upload queue processing
    processing_q = select(func.count()).select_from(UploadQueue).where(
        UploadQueue.status == UploadStatus.detecting
    )
    processing = (await db.execute(processing_q)).scalar() or 0

    return {
        "active_projects": active_projects,
        "open_invoices": {"count": 0, "total": "Rp 0"},
        "documents_this_month": monthly_count,
        "total_documents": total_docs,
        "pending_approvals": pending_approvals,
        "active_clients": active_clients,
        "processing_uploads": processing,
    }


@router.get("/activity")
@limiter.limit(READ_LIMIT)
async def get_recent_activity(
    request: Request,
    limit: int = 10,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dashboard:view"))] = None,
):
    """Get recent activity — latest documents uploaded."""
    q = (
        select(Document)
        .order_by(Document.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(q)
    docs = result.scalars().all()

    items = []
    for d in docs:
        items.append({
            "id": str(d.id),
            "type": "document_uploaded",
            "title": d.title,
            "doc_number": d.doc_number,
            "doc_type": d.doc_type.value if d.doc_type else None,
            "client_name": d.client_name,
            "project_name": d.project_name,
            "status": d.status.value if d.status else None,
            "created_at": str(d.created_at) if d.created_at else None,
        })

    return {"items": items, "total": len(items)}