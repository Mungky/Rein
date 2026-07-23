"""Documents router — CRUD + search for document metadata."""

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from app.limiter import READ_LIMIT, limiter
from db.models.document import Document, DocType, DocStatus
from db.models.profile import Profile
from db.session import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class DocumentResponse(BaseModel):
    id: uuid.UUID
    doc_number: str
    doc_type: DocType
    title: str
    description: str | None
    client_name: str | None
    client_code: str | None
    project_name: str | None
    project_code: str | None
    file_name: str
    file_size: int
    mime_type: str | None
    gdrive_web_link: str | None
    status: DocStatus
    version: int
    uploaded_by: uuid.UUID
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class DocumentCreateRequest(BaseModel):
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
    gdrive_web_link: str | None = None


class DocumentUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    client_name: str | None = None
    client_code: str | None = None
    project_name: str | None = None
    project_code: str | None = None
    status: DocStatus | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/stats")
@limiter.limit(READ_LIMIT)
async def document_stats(
    request: Request,
    _profile: Annotated[Profile, Depends(require_permission("dcc:view"))],
) -> dict:
    """Return total document count (from public index) and URL to the public index spreadsheet."""
    from app.services.gsheets import get_public_index_url, get_public_index_count

    total = await get_public_index_count()

    return {"total": total, "sheets_url": get_public_index_url() or ""}


@router.get("/", response_model=dict)
@limiter.limit(READ_LIMIT)
async def list_documents(
    request: Request,
    doc_type: Optional[str] = None,
    status: Optional[str] = None,
    client: Optional[str] = None,
    project: Optional[str] = None,
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dcc:view"))] = None,
):
    """List documents with optional filters."""
    query = select(Document)

    if doc_type:
        try:
            dt = DocType(doc_type)
            query = query.where(Document.doc_type == dt)
        except ValueError:
            pass
    if status:
        try:
            ds = DocStatus(status)
            query = query.where(Document.status == ds)
        except ValueError:
            pass
    if client:
        query = query.where(Document.client_name.ilike(f"%{client}%"))
    if project:
        query = query.where(Document.project_name.ilike(f"%{project}%"))

    # Count with the same filters applied
    count_q = select(func.count()).select_from(Document)
    if doc_type:
        try:
            dt = DocType(doc_type)
            count_q = count_q.where(Document.doc_type == dt)
        except ValueError:
            pass
    if status:
        try:
            ds = DocStatus(status)
            count_q = count_q.where(Document.status == ds)
        except ValueError:
            pass
    if client:
        count_q = count_q.where(Document.client_name.ilike(f"%{client}%"))
    if project:
        count_q = count_q.where(Document.project_name.ilike(f"%{project}%"))

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    query = query.order_by(Document.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    docs = result.scalars().all()

    return {
        "items": [
            {
                "id": str(d.id),
                "doc_number": d.doc_number,
                "doc_type": d.doc_type.value if d.doc_type else None,
                "title": d.title,
                "description": d.description,
                "client_name": d.client_name,
                "client_code": d.client_code,
                "project_name": d.project_name,
                "project_code": d.project_code,
                "file_name": d.file_name,
                "file_size": d.file_size,
                "status": d.status.value if d.status else None,
                "gdrive_web_link": d.gdrive_web_link,
                "created_at": str(d.created_at) if d.created_at else None,
                "updated_at": str(d.updated_at) if d.updated_at else None,
            }
            for d in docs
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/search", response_model=dict)
@limiter.limit(READ_LIMIT)
async def search_documents(
    request: Request,
    q: str = Query(..., min_length=1),
    doc_type: Optional[str] = None,
    limit: int = Query(default=10, le=50),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dcc:view", "dcc:search"))] = None,
):
    """Search documents by title, client, project, or doc_number."""
    search_filter = or_(
        Document.title.ilike(f"%{q}%"),
        Document.doc_number.ilike(f"%{q}%"),
        Document.client_name.ilike(f"%{q}%"),
        Document.project_name.ilike(f"%{q}%"),
        Document.description.ilike(f"%{q}%"),
    )

    query = select(Document).where(search_filter)
    if doc_type:
        try:
            dt = DocType(doc_type)
            query = query.where(Document.doc_type == dt)
        except ValueError:
            pass

    query = query.order_by(Document.created_at.desc()).limit(limit)
    result = await db.execute(query)
    docs = result.scalars().all()

    return {
        "results": [
            {
                "id": str(d.id),
                "doc_number": d.doc_number,
                "doc_type": d.doc_type.value if d.doc_type else None,
                "title": d.title,
                "client_name": d.client_name,
                "client_code": d.client_code,
                "project_name": d.project_name,
                "project_code": d.project_code,
                "file_name": d.file_name,
                "file_size": d.file_size,
                "status": d.status.value if d.status else None,
                "gdrive_web_link": d.gdrive_web_link,
                "created_at": str(d.created_at) if d.created_at else None,
            }
            for d in docs
        ],
        "total": len(docs),
        "query": q,
    }


@router.get("/{document_id}", response_model=dict)
@limiter.limit(READ_LIMIT)
async def get_document(
    request: Request,
    document_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("dcc:view"))] = None,
):
    """Get a single document by ID."""
    doc = await db.get(Document, document_id)
    if doc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "id": str(doc.id),
        "doc_number": doc.doc_number,
        "doc_type": doc.doc_type.value if doc.doc_type else None,
        "title": doc.title,
        "description": doc.description,
        "client_name": doc.client_name,
        "client_code": doc.client_code,
        "project_name": doc.project_name,
        "project_code": doc.project_code,
        "file_name": doc.file_name,
        "file_size": doc.file_size,
        "mime_type": doc.mime_type,
        "gdrive_file_id": doc.gdrive_file_id,
        "gdrive_web_link": doc.gdrive_web_link,
        "status": doc.status.value if doc.status else None,
        "version": doc.version,
        "uploaded_by": str(doc.uploaded_by),
        "created_at": str(doc.created_at) if doc.created_at else None,
        "updated_at": str(doc.updated_at) if doc.updated_at else None,
    }


@router.post("/", response_model=dict, status_code=201)
async def create_document(
    body: DocumentCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """Create document metadata."""
    doc = Document(
        doc_number=body.doc_number,
        doc_type=body.doc_type,
        title=body.title,
        description=body.description,
        client_name=body.client_name,
        client_code=body.client_code,
        project_name=body.project_name,
        project_code=body.project_code,
        folder_path=body.folder_path,
        file_name=body.file_name,
        file_size=body.file_size,
        mime_type=body.mime_type,
        gdrive_file_id=body.gdrive_file_id,
        gdrive_folder_id=body.gdrive_folder_id,
        gdrive_web_link=body.gdrive_web_link,
        uploaded_by=profile.id,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)
    return {
        "id": str(doc.id),
        "doc_number": doc.doc_number,
        "title": doc.title,
        "status": doc.status.value,
    }


@router.patch("/{document_id}", response_model=dict)
async def update_document(
    document_id: uuid.UUID,
    body: DocumentUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:upload"))] = None,
):
    """Update document metadata."""
    doc = await db.get(Document, document_id)
    if doc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found")

    if body.title is not None:
        doc.title = body.title
    if body.description is not None:
        doc.description = body.description
    if body.client_name is not None:
        doc.client_name = body.client_name
    if body.client_code is not None:
        doc.client_code = body.client_code
    if body.project_name is not None:
        doc.project_name = body.project_name
    if body.project_code is not None:
        doc.project_code = body.project_code
    if body.status is not None:
        doc.status = body.status

    await db.flush()
    await db.refresh(doc)
    return {
        "id": str(doc.id),
        "doc_number": doc.doc_number,
        "title": doc.title,
        "status": doc.status.value,
    }