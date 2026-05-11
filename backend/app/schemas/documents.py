"""Pydantic schemas for document endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from db.models.document import DocType, DocStatus


class DocumentCreate(BaseModel):
    doc_number: str
    doc_type: DocType = DocType.OTHER
    title: str
    description: str | None = None
    client_name: str | None = None
    client_code: str | None = None
    project_name: str | None = None
    project_code: str | None = None
    folder_path: str | None = None
    file_name: str
    file_size: int = 0
    mime_type: str | None = None
    gdrive_file_id: str | None = None
    gdrive_folder_id: str | None = None


class DocumentUpdate(BaseModel):
    doc_type: DocType | None = None
    title: str | None = None
    description: str | None = None
    client_name: str | None = None
    client_code: str | None = None
    project_name: str | None = None
    project_code: str | None = None
    folder_path: str | None = None
    status: DocStatus | None = None


class DocumentResponse(BaseModel):
    id: UUID
    doc_number: str
    doc_type: DocType
    title: str
    description: str | None
    client_name: str | None
    client_code: str | None
    project_name: str | None
    project_code: str | None
    folder_path: str | None
    file_name: str
    file_size: int
    mime_type: str | None
    gdrive_file_id: str | None
    gdrive_web_link: str | None
    status: DocStatus
    version: int
    uploaded_by: UUID
    approved_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentSearchResult(BaseModel):
    id: UUID
    doc_number: str
    title: str
    doc_type: DocType
    client_name: str | None
    project_name: str | None
    file_name: str
    file_size: int
    status: DocStatus
    created_at: datetime