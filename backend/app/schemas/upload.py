"""Pydantic schemas for the upload router."""

from datetime import datetime

from pydantic import BaseModel


class UploadProposalResponse(BaseModel):
    """Response for the PROPOSE step — file uploaded to Drive, awaiting confirmation."""

    id: str
    filename: str
    size: int
    mime_type: str | None = None
    status: str

    # AI-detected metadata
    detected_type: str | None = None
    detected_type_confidence: float = 0.0
    detected_client_code: str | None = None
    detected_client_name: str | None = None
    detected_client_confidence: float = 0.0
    detected_project_code: str | None = None
    detected_project_name: str | None = None
    detected_project_confidence: float = 0.0
    detected_folder: str | None = None
    detected_folder_confidence: float = 0.0

    # Drive link (available immediately after upload)
    gdrive_link: str | None = None

    # When this proposal expires
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class UploadConfirmRequest(BaseModel):
    """User edits to metadata before confirming an upload."""

    doc_type: str | None = None
    client_code: str | None = None
    client_name: str | None = None
    project_code: str | None = None
    project_name: str | None = None
    folder_path: str | None = None
    title: str | None = None
    note: str | None = None


class UploadConfirmResponse(BaseModel):
    """Response for the CONFIRM step — document record created."""

    id: str
    document_id: str
    doc_number: str
    status: str
    gdrive_link: str | None = None

    model_config = {"from_attributes": True}