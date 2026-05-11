"""Pydantic schemas for access request endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from db.models.access_request import AccessStatus


class AccessRequestCreate(BaseModel):
    """Body for creating a new access request."""

    document_id: UUID
    reason: str | None = None


class AccessRequestResponse(BaseModel):
    """Full access request response — includes document and requester info."""

    id: UUID
    document_id: UUID
    document_number: str | None = None
    document_title: str | None = None
    document_name: str | None = None
    requested_by: UUID
    requested_by_name: str | None = None
    status: AccessStatus
    reason: str | None
    expires_at: datetime | None
    temp_token: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AccessApproveResponse(BaseModel):
    """Response returned after approving an access request."""

    temp_token: str
    expires_at: datetime
    download_url: str