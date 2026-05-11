"""Projects router — CRUD for document projects (linked to clients)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_permission
from db.models.client import Client
from db.models.profile import Profile
from db.models.project import Project
from db.session import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    code: str
    name: str
    client_id: uuid.UUID


class ProjectUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    client_id: uuid.UUID | None = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    client_id: uuid.UUID
    is_active: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    client_id: uuid.UUID | None = None,
    active_only: bool = True,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:view"))] = None,
):
    """List all projects. Optionally filter by client."""
    query = select(Project).order_by(Project.code)
    if client_id:
        query = query.where(Project.client_id == client_id)
    if active_only:
        query = query.where(Project.is_active == True)  # noqa: E712
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Create a new project under a client."""
    # Check client exists
    client = await db.get(Client, body.client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Klien tidak ditemukan")

    # Check for duplicate code
    existing = await db.execute(select(Project).where(Project.code == body.code))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Proyek dengan kode '{body.code}' sudah ada.",
        )

    project = Project(code=body.code, name=body.name, client_id=body.client_id)
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Update a project's code, name, or client."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Proyek tidak ditemukan")
    if body.code is not None:
        project.code = body.code
    if body.name is not None:
        project.name = body.name
    if body.client_id is not None:
        # Verify new client exists
        client = await db.get(Client, body.client_id)
        if client is None:
            raise HTTPException(status_code=404, detail="Klien tidak ditemukan")
        project.client_id = body.client_id
    await db.flush()
    await db.refresh(project)
    return project


@router.patch("/{project_id}/deactivate", response_model=ProjectResponse)
async def deactivate_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Soft-delete a project by setting is_active to false."""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Proyek tidak ditemukan")
    project.is_active = False
    await db.flush()
    await db.refresh(project)
    return project