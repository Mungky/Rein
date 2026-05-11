"""Pydantic schemas for approval endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from db.models.approval import ApprovalAction
from app.schemas.documents import DocumentResponse


class ApprovalResponse(BaseModel):
    """Full approval record response."""

    id: UUID
    document_id: UUID
    requested_by: UUID
    assigned_to: UUID
    action: ApprovalAction | None
    comment: str | None
    acted_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalActionRequest(BaseModel):
    """Body for approving or rejecting an approval."""

    action: ApprovalAction
    comment: str | None = None


class DocumentWithApproval(BaseModel):
    """A document bundled with its associated approval (if any)."""

    document: DocumentResponse
    approval: ApprovalResponse | None