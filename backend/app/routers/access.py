"""Access request router — temporary document access with expiry."""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.access import AccessApproveResponse, AccessRequestCreate, AccessRequestResponse
from app.dependencies import get_current_profile, require_permission
from db.models.access_request import AccessRequest, AccessStatus
from db.models.document import Document
from db.models.profile import Profile
from db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/request", response_model=AccessRequestResponse)
async def request_access(
    body: AccessRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Annotated[Profile, Depends(require_permission("dcc:view"))],
):
    """Create a new access request for a document."""
    # Verify the document exists
    doc = await db.get(Document, body.document_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    access_request = AccessRequest(
        document_id=body.document_id,
        requested_by=profile.id,
        reason=body.reason,
        status=AccessStatus.pending,
    )
    db.add(access_request)
    await db.flush()
    await db.refresh(access_request)

    return access_request


@router.get("/pending", response_model=list[AccessRequestResponse])
async def list_pending(
    db: Annotated[AsyncSession, Depends(get_db)],
    _approver: Annotated[Profile, Depends(require_permission("dcc:manage_access"))],
):
    """List all pending access requests with document and requester info."""
    result = await db.execute(
        select(AccessRequest)
        .where(AccessRequest.status == AccessStatus.pending)
        .order_by(AccessRequest.created_at.desc())
    )
    requests = list(result.scalars().all())

    response = []
    for req in requests:
        doc = await db.get(Document, req.document_id)
        requester = await db.get(Profile, req.requested_by)
        response.append(AccessRequestResponse(
            id=req.id,
            document_id=req.document_id,
            document_number=doc.doc_number if doc else None,
            document_title=doc.title if doc else None,
            document_name=doc.file_name if doc else None,
            requested_by=req.requested_by,
            requested_by_name=requester.full_name if requester else None,
            status=req.status,
            reason=req.reason,
            expires_at=req.expires_at,
            temp_token=req.temp_token,
            created_at=req.created_at,
        ))
    return response


@router.get("/{token}", response_model=AccessApproveResponse)
async def verify_access(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify a temporary access token and return download link if valid."""
    result = await db.execute(
        select(AccessRequest).where(AccessRequest.temp_token == token)
    )
    access_request = result.scalar_one_or_none()

    if access_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid access token",
        )

    if access_request.status != AccessStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access request has not been approved",
        )

    now = datetime.now(timezone.utc)
    if access_request.expires_at and access_request.expires_at < now:
        # Mark as expired
        access_request.status = AccessStatus.expired
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Access token has expired",
        )

    # Fetch the document to get the gdrive web link
    doc = await db.get(Document, access_request.document_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated document not found",
        )

    download_url = doc.gdrive_web_link or ""
    return AccessApproveResponse(
        temp_token=access_request.temp_token,
        expires_at=access_request.expires_at,
        download_url=download_url,
    )


@router.post("/{request_id}/approve", response_model=AccessApproveResponse)
async def approve_access(
    request_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    approver: Annotated[Profile, Depends(require_permission("dcc:manage_access"))],
):
    """Approve an access request — generates a temp_token valid for 15 minutes."""
    access_request = await db.get(AccessRequest, request_id)
    if access_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found",
        )

    if access_request.status != AccessStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Access request is already {access_request.status.value}",
        )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=15)
    temp_token = secrets.token_urlsafe(32)

    access_request.status = AccessStatus.approved
    access_request.approved_by = approver.id
    access_request.temp_token = temp_token
    access_request.expires_at = expires_at
    access_request.acted_at = now
    await db.flush()

    # Fetch the document to build the download URL
    doc = await db.get(Document, access_request.document_id)
    download_url = doc.gdrive_web_link if doc else ""

    # Send email notification (fire-and-forget)
    try:
        from app.services.email import send_access_approved_email
        requester = await db.get(Profile, access_request.requested_by)
        if requester:
            await send_access_approved_email(
                to=requester.full_name,  # placeholder — real email lookup would use auth
                document_title=doc.title if doc else "Dokumen",
                access_token=temp_token,
                expires_at=expires_at.strftime("%Y-%m-%d %H:%M UTC"),
            )
    except Exception as e:
        logger.warning("Failed to send approval email: %s", e)

    return AccessApproveResponse(
        temp_token=temp_token,
        expires_at=expires_at,
        download_url=download_url or "",
    )


@router.post("/{request_id}/deny")
async def deny_access(
    request_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _approver: Annotated[Profile, Depends(require_permission("dcc:manage_access"))],
):
    """Deny an access request."""
    access_request = await db.get(AccessRequest, request_id)
    if access_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found",
        )

    if access_request.status != AccessStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Access request is already {access_request.status.value}",
        )

    access_request.status = AccessStatus.denied
    access_request.acted_at = datetime.now(timezone.utc)
    await db.flush()

    # Send denial email (fire-and-forget)
    try:
        from app.services.email import send_access_denied_email
        requester = await db.get(Profile, access_request.requested_by)
        doc = await db.get(Document, access_request.document_id)
        if requester:
            await send_access_denied_email(
                to=requester.full_name,
                document_title=doc.title if doc else "Dokumen",
            )
    except Exception as e:
        logger.warning("Failed to send denial email: %s", e)

    return {"id": str(access_request.id), "status": access_request.status.value}