"""SCADA Monitor router — per-user perspectives + stream sources.

Perspectives are owned per user (`owner_id`). On first visit the list
endpoint auto-bootstraps a "Default" perspective containing one video panel
per enabled stream, so a view-only operator gets a working screen without
any setup ("tanpa setup ulang").

Stream credentials (`read_user`/`read_pass`) are intentionally included in
the stream payload: they are MediaMTX read-only credentials that the browser
player must append as query params, and the endpoint is gated behind
`scada:view` — every recipient is an authorized viewer.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import _load_permissions, require_permission
from app.schemas.scada import (
    DeletedOut,
    PerspectiveCreateRequest,
    PerspectiveListOut,
    PerspectiveOut,
    PerspectiveUpdateRequest,
    StreamCreateRequest,
    StreamListOut,
    StreamOut,
    StreamUpdateRequest,
)
from db.models.profile import Profile
from db.models.scada import ScadaPerspective, ScadaStream
from db.session import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _perspective_dict(p: ScadaPerspective) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "layout": p.layout,
        "is_default": p.is_default,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


def _stream_dict(s: ScadaStream) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "hls_url": s.hls_url,
        "read_user": s.read_user,
        "read_pass": s.read_pass,
        "enabled": s.enabled,
        "created_at": str(s.created_at) if s.created_at else None,
        "updated_at": str(s.updated_at) if s.updated_at else None,
    }


async def _get_own_perspective(
    db: AsyncSession, perspective_id: uuid.UUID, owner_id: uuid.UUID
) -> ScadaPerspective:
    p = await db.get(ScadaPerspective, perspective_id)
    if p is None or p.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Perspective tidak ditemukan")
    return p


async def _bootstrap_default(db: AsyncSession, owner_id: uuid.UUID) -> ScadaPerspective:
    """Create a starter perspective: one full-width video panel per enabled stream."""
    result = await db.execute(
        select(ScadaStream)
        .where(ScadaStream.enabled.is_(True))
        .order_by(ScadaStream.created_at)
    )
    streams = result.scalars().all()

    panels = [
        {
            "id": str(uuid.uuid4()),
            "type": "video",
            "title": s.name,
            "grid": {"x": 0, "y": i * 8, "w": 12, "h": 8},
            "config": {
                "stream_id": str(s.id),
                "object_fit": "contain",
                "muted": True,
            },
        }
        for i, s in enumerate(streams)
    ]

    perspective = ScadaPerspective(
        owner_id=owner_id,
        name="Default",
        layout={"version": 1, "panels": panels},
        is_default=True,
    )
    db.add(perspective)
    await db.flush()
    await db.refresh(perspective)
    return perspective


# ---------------------------------------------------------------------------
# Perspectives (per-user)
# ---------------------------------------------------------------------------


@router.get("/perspectives", response_model=PerspectiveListOut)
async def list_perspectives(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """List the current user's perspectives; bootstrap a default when empty."""
    result = await db.execute(
        select(ScadaPerspective)
        .where(ScadaPerspective.owner_id == profile.id)
        .order_by(ScadaPerspective.created_at)
    )
    perspectives = list(result.scalars().all())

    if not perspectives:
        perspectives = [await _bootstrap_default(db, profile.id)]

    return {"items": [_perspective_dict(p) for p in perspectives]}


@router.post("/perspectives", response_model=PerspectiveOut, status_code=201)
async def create_perspective(
    body: PerspectiveCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:edit_layout"))] = None,
):
    # First perspective ever becomes the default automatically
    count_result = await db.execute(
        select(ScadaPerspective.id).where(ScadaPerspective.owner_id == profile.id)
    )
    has_existing = count_result.first() is not None

    perspective = ScadaPerspective(
        owner_id=profile.id,
        name=body.name,
        layout=body.layout.model_dump(mode="json"),
        is_default=not has_existing,
    )
    db.add(perspective)
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


@router.patch("/perspectives/{perspective_id}", response_model=PerspectiveOut)
async def update_perspective(
    perspective_id: uuid.UUID,
    body: PerspectiveUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:edit_layout"))] = None,
):
    perspective = await _get_own_perspective(db, perspective_id, profile.id)

    if body.name is not None:
        perspective.name = body.name
    if body.layout is not None:
        perspective.layout = body.layout.model_dump(mode="json")

    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


@router.delete("/perspectives/{perspective_id}", response_model=DeletedOut)
async def delete_perspective(
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:edit_layout"))] = None,
):
    perspective = await _get_own_perspective(db, perspective_id, profile.id)

    result = await db.execute(
        select(ScadaPerspective)
        .where(ScadaPerspective.owner_id == profile.id)
        .order_by(ScadaPerspective.created_at)
    )
    all_own = list(result.scalars().all())
    if len(all_own) <= 1:
        raise HTTPException(
            status_code=409,
            detail="Perspective terakhir tidak bisa dihapus",
        )

    was_default = perspective.is_default
    await db.delete(perspective)
    await db.flush()

    # Keep the invariant: the user always has exactly one default
    if was_default:
        remaining = [p for p in all_own if p.id != perspective.id]
        remaining[0].is_default = True
        await db.flush()

    return {"deleted": str(perspective_id)}


@router.post("/perspectives/{perspective_id}/default", response_model=PerspectiveOut)
async def set_default_perspective(
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:edit_layout"))] = None,
):
    perspective = await _get_own_perspective(db, perspective_id, profile.id)

    # Clear the previous default first so the partial unique index never trips
    result = await db.execute(
        select(ScadaPerspective).where(
            ScadaPerspective.owner_id == profile.id,
            ScadaPerspective.is_default.is_(True),
            ScadaPerspective.id != perspective.id,
        )
    )
    for old in result.scalars().all():
        old.is_default = False
    await db.flush()

    perspective.is_default = True
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------


@router.get("/streams", response_model=StreamListOut)
async def list_streams(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """List streams. Disabled streams are only visible to scada:manage holders."""
    granted = await _load_permissions(db, profile.role)
    query = select(ScadaStream).order_by(ScadaStream.created_at)
    if "scada:manage" not in granted:
        query = query.where(ScadaStream.enabled.is_(True))

    result = await db.execute(query)
    streams = result.scalars().all()
    return {"items": [_stream_dict(s) for s in streams]}


@router.post("/streams", response_model=StreamOut, status_code=201)
async def create_stream(
    body: StreamCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    stream = ScadaStream(
        name=body.name,
        hls_url=body.hls_url,
        read_user=body.read_user,
        read_pass=body.read_pass,
        enabled=body.enabled,
    )
    db.add(stream)
    await db.flush()
    await db.refresh(stream)
    return _stream_dict(stream)


@router.patch("/streams/{stream_id}", response_model=StreamOut)
async def update_stream(
    stream_id: uuid.UUID,
    body: StreamUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    stream = await db.get(ScadaStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream tidak ditemukan")

    if body.name is not None:
        stream.name = body.name
    if body.hls_url is not None:
        stream.hls_url = body.hls_url
    if body.read_user is not None:
        stream.read_user = body.read_user or None
    if body.read_pass is not None:
        stream.read_pass = body.read_pass or None
    if body.enabled is not None:
        stream.enabled = body.enabled

    await db.flush()
    await db.refresh(stream)
    return _stream_dict(stream)


@router.delete("/streams/{stream_id}", response_model=DeletedOut)
async def delete_stream(
    stream_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    stream = await db.get(ScadaStream, stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Stream tidak ditemukan")

    await db.delete(stream)
    await db.flush()
    return {"deleted": str(stream_id)}
