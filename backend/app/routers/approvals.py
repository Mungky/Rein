"""Approvals router — document approval workflow."""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from app.schemas.approval import ApprovalResponse
from db.models.approval import Approval, ApprovalAction
from db.models.document import DocStatus, Document
from db.models.profile import Profile
from db.session import get_db

router = APIRouter()


class RejectBody(BaseModel):
    """Optional body for reject with a comment."""

    comment: str | None = None


@router.get("/pending", response_model=list[ApprovalResponse])
async def get_pending_approvals(
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Annotated[Profile, Depends(require_permission("dcc:approve"))],
):
    """List pending approvals assigned to the current user's role."""
    result = await db.execute(
        select(Approval)
        .where(Approval.action.is_(None))
        .where(Approval.assigned_to == profile.id)
        .order_by(Approval.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/{approval_id}/approve", response_model=ApprovalResponse)
async def approve_document(
    approval_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Annotated[Profile, Depends(require_permission("dcc:approve"))],
):
    """Approve a document — sets action to 'approve' and document status to 'approved'."""
    approval = await db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found",
        )

    if approval.action is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval already has action '{approval.action.value}'",
        )

    # Verify the current user is the assigned approver
    if approval.assigned_to != profile.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned approver for this approval",
        )

    now = datetime.now(timezone.utc)

    approval.action = ApprovalAction.approve
    approval.acted_at = now
    await db.flush()

    # Update the related document status
    doc = await db.get(Document, approval.document_id)
    if doc is not None:
        doc.status = DocStatus.approved
        doc.approved_by = profile.id
        await db.flush()

    await db.refresh(approval)
    return approval


@router.post("/{approval_id}/reject", response_model=ApprovalResponse)
async def reject_document(
    approval_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Annotated[Profile, Depends(require_permission("dcc:approve"))],
    body: RejectBody | None = None,
):
    """Reject a document — sets action to 'reject' and document status to 'rejected'."""
    approval = await db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found",
        )

    if approval.action is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval already has action '{approval.action.value}'",
        )

    # Verify the current user is the assigned approver
    if approval.assigned_to != profile.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned approver for this approval",
        )

    now = datetime.now(timezone.utc)

    approval.action = ApprovalAction.reject
    approval.acted_at = now
    if body and body.comment:
        approval.comment = body.comment
    await db.flush()

    # Update the related document status
    doc = await db.get(Document, approval.document_id)
    if doc is not None:
        doc.status = DocStatus.rejected
        await db.flush()

    await db.refresh(approval)
    return approval