"""Clients router — CRUD for document clients (companies)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_permission
from db.models.client import Client
from db.models.profile import Profile
from db.session import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ClientCreate(BaseModel):
    code: str
    name: str


class ClientUpdate(BaseModel):
    code: str | None = None
    name: str | None = None


class ClientResponse(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_active: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/", response_model=list[ClientResponse])
async def list_clients(
    active_only: bool = True,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:view"))] = None,
):
    """List all clients. Optionally include inactive."""
    query = select(Client).order_by(Client.code)
    if active_only:
        query = query.where(Client.is_active == True)  # noqa: E712
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
async def create_client(
    body: ClientCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Create a new client."""
    # Check for duplicate code
    existing = await db.execute(select(Client).where(Client.code == body.code))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Klien dengan kode '{body.code}' sudah ada.",
        )
    client = Client(code=body.code, name=body.name)
    db.add(client)
    await db.flush()
    await db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: uuid.UUID,
    body: ClientUpdate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Update a client's code or name."""
    client = await db.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Klien tidak ditemukan")
    if body.code is not None:
        client.code = body.code
    if body.name is not None:
        client.name = body.name
    await db.flush()
    await db.refresh(client)
    return client


@router.patch("/{client_id}/deactivate", response_model=ClientResponse)
async def deactivate_client(
    client_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:manage_clients"))] = None,
):
    """Soft-delete a client by setting is_active to false."""
    client = await db.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Klien tidak ditemukan")
    client.is_active = False
    await db.flush()
    await db.refresh(client)
    return client