"""R-Net router — per-user perspectives, stream sources, historian tags/history.

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
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import _load_permissions, require_permission
from app.schemas.scada import (
    DeletedOut,
    HistoryOut,
    RecentSamplesOut,
    SheetCreateRequest,
    SheetListOut,
    SheetOut,
    SheetUpdateRequest,
    SiteCreateRequest,
    SiteListOut,
    SiteOut,
    SiteUpdateRequest,
    SummaryOut,
    PerspectiveCreateRequest,
    PerspectiveListOut,
    PerspectiveOut,
    PerspectiveUpdateRequest,
    PublishedLayoutOut,
    StreamCreateRequest,
    StreamListOut,
    StreamOut,
    StreamUpdateRequest,
    TagCreateRequest,
    TagListOut,
    TagOut,
    TagUpdateRequest,
    WorkbenchColumnCreateRequest,
    WorkbenchColumnListOut,
    WorkbenchColumnOut,
    WorkbenchColumnUpdateRequest,
)
from app.services import historian
from db.models.profile import Profile
from db.models.scada import (
    ScadaPerspective,
    ScadaSample,
    ScadaSheet,
    ScadaSite,
    ScadaStream,
    ScadaTag,
    ScadaWorkbenchColumn,
)
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
        "is_published": p.is_published,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


async def _get_published(db: AsyncSession) -> ScadaPerspective | None:
    """The single admin-published default layout, or None if none is set."""
    result = await db.execute(
        select(ScadaPerspective).where(ScadaPerspective.is_published.is_(True)).limit(1)
    )
    return result.scalars().first()


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
    """Create a generic starter perspective (one video panel per enabled stream)
    for a user who has no layouts and when no admin default is published.

    When an admin default IS published, list_perspectives injects it as a
    read-only entry instead — so we don't bootstrap a private copy here.
    """
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
    """List the caller's own perspectives, plus the admin-published default
    layout (Masalah D) injected as a read-only entry so EVERY user sees the
    admin's layout — not just brand-new accounts. Bootstraps a generic starter
    only when the user has nothing and nothing is published."""
    result = await db.execute(
        select(ScadaPerspective)
        .where(ScadaPerspective.owner_id == profile.id)
        .order_by(ScadaPerspective.created_at)
    )
    own = list(result.scalars().all())
    items = [{**_perspective_dict(p), "read_only": False} for p in own]

    published = await _get_published(db)
    if published is not None and published.owner_id != profile.id:
        # Show the admin default to everyone (view-only; forked on edit). Put it
        # first so it's the natural landing layout.
        items.insert(0, {**_perspective_dict(published), "read_only": True})

    if not items:
        boot = await _bootstrap_default(db, profile.id)
        items = [{**_perspective_dict(boot), "read_only": False}]

    return {"items": items}


@router.get("/perspectives/published", response_model=PublishedLayoutOut)
async def get_published_perspective(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """The admin-published default layout (for the 'reset to admin default'
    action). Any viewer may read it; returns exists=False when none is set."""
    published = await _get_published(db)
    if published is None:
        return {"exists": False, "name": None, "layout": None}
    return {"exists": True, "name": published.name, "layout": published.layout}


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


@router.post("/perspectives/{perspective_id}/publish", response_model=PerspectiveOut)
async def publish_perspective(
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Publish one of the caller's own perspectives as THE admin default layout
    (Masalah D, opsi b). New users start from a copy of it; existing users can
    reset to it. Clears any previously published one first so the partial unique
    index never trips."""
    perspective = await _get_own_perspective(db, perspective_id, profile.id)

    result = await db.execute(
        select(ScadaPerspective).where(
            ScadaPerspective.is_published.is_(True),
            ScadaPerspective.id != perspective.id,
        )
    )
    for old in result.scalars().all():
        old.is_published = False
    await db.flush()

    perspective.is_published = True
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


@router.post("/perspectives/{perspective_id}/unpublish", response_model=PerspectiveOut)
async def unpublish_perspective(
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Remove the admin-default status from the caller's perspective."""
    perspective = await _get_own_perspective(db, perspective_id, profile.id)
    perspective.is_published = False
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


@router.post(
    "/perspectives/{perspective_id}/reset-to-default", response_model=PerspectiveOut
)
async def reset_perspective_to_published(
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Overwrite the caller's own perspective with the current admin-published
    layout ('Kembalikan ke Bawaan Admin'). Available to any viewer so they can
    always sync to the latest admin default. 409 when nothing is published."""
    perspective = await _get_own_perspective(db, perspective_id, profile.id)
    published = await _get_published(db)
    if published is None:
        raise HTTPException(
            status_code=409, detail="Belum ada layout bawaan admin yang diterbitkan"
        )
    perspective.layout = published.layout
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


# ---------------------------------------------------------------------------
# Sites (MQTT brokers) — CRUD from the Analisis "Kelola Site" dialog.
# The broker password is write-only: never returned, only `has_password`.
# ---------------------------------------------------------------------------


def _site_dict(s: ScadaSite) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "enabled": s.enabled,
        "mqtt_host": s.mqtt_host,
        "mqtt_port": s.mqtt_port,
        "mqtt_username": s.mqtt_username,
        "base_topic": s.base_topic,
        "has_password": bool(s.mqtt_password),
        "created_at": str(s.created_at) if s.created_at else None,
        "updated_at": str(s.updated_at) if s.updated_at else None,
    }


async def _get_site_or_404(db: AsyncSession, site_id: uuid.UUID | None) -> ScadaSite:
    site = await db.get(ScadaSite, site_id) if site_id else None
    if site is None:
        raise HTTPException(status_code=404, detail="Site tidak ditemukan")
    return site


@router.get("/sites", response_model=SiteListOut)
async def list_sites(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    result = await db.execute(select(ScadaSite).order_by(ScadaSite.created_at))
    return {"items": [_site_dict(s) for s in result.scalars().all()]}


@router.post("/sites", response_model=SiteOut, status_code=201)
async def create_site(
    body: SiteCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    site = ScadaSite(
        name=body.name,
        enabled=body.enabled,
        mqtt_host=body.mqtt_host,
        mqtt_port=body.mqtt_port,
        mqtt_username=body.mqtt_username or None,
        mqtt_password=body.mqtt_password or None,
        base_topic=body.base_topic,
    )
    db.add(site)
    await db.flush()
    await db.refresh(site)
    return _site_dict(site)


@router.patch("/sites/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: uuid.UUID,
    body: SiteUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    site = await db.get(ScadaSite, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site tidak ditemukan")

    if body.name is not None:
        site.name = body.name
    if body.enabled is not None:
        site.enabled = body.enabled
    if body.mqtt_host is not None:
        site.mqtt_host = body.mqtt_host
    if body.mqtt_port is not None:
        site.mqtt_port = body.mqtt_port
    if body.mqtt_username is not None:
        site.mqtt_username = body.mqtt_username or None
    # Password is write-only: only touch it when a value is sent
    if body.mqtt_password is not None:
        site.mqtt_password = body.mqtt_password or None
    if body.base_topic is not None:
        site.base_topic = body.base_topic

    await db.flush()
    await db.refresh(site)
    return _site_dict(site)


@router.delete("/sites/{site_id}", response_model=DeletedOut)
async def delete_site(
    site_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    site = await db.get(ScadaSite, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site tidak ditemukan")

    has_tags = (
        await db.execute(select(ScadaTag.id).where(ScadaTag.site_id == site_id).limit(1))
    ).first()
    if has_tags:
        raise HTTPException(
            status_code=409,
            detail="Site masih dipakai tag — hapus atau pindahkan tag-nya dulu",
        )

    await db.delete(site)
    await db.flush()
    return {"deleted": str(site_id)}


# ---------------------------------------------------------------------------
# Workbench: sheets ("Tabel" — Table Editor groups, TDengine supertable-like)
# ---------------------------------------------------------------------------


def _sheet_dict(s: ScadaSheet) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "position": s.position,
        "created_at": str(s.created_at) if s.created_at else None,
        "updated_at": str(s.updated_at) if s.updated_at else None,
    }


async def _get_sheet_or_404(db: AsyncSession, sheet_id: uuid.UUID) -> ScadaSheet:
    sheet = await db.get(ScadaSheet, sheet_id)
    if sheet is None:
        raise HTTPException(status_code=404, detail="Tabel tidak ditemukan")
    return sheet


@router.get("/sheets", response_model=SheetListOut)
async def list_sheets(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """List sheets; bootstrap a default "Utama" when none exist yet
    (same "tanpa setup ulang" pattern as perspectives)."""
    result = await db.execute(
        select(ScadaSheet).order_by(ScadaSheet.position, ScadaSheet.created_at)
    )
    sheets = list(result.scalars().all())
    if not sheets:
        default = ScadaSheet(name="Utama", position=0)
        db.add(default)
        await db.flush()
        await db.refresh(default)
        sheets = [default]
    return {"items": [_sheet_dict(s) for s in sheets]}


@router.post("/sheets", response_model=SheetOut, status_code=201)
async def create_sheet(
    body: SheetCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    max_pos = (await db.execute(select(func.max(ScadaSheet.position)))).scalar()
    sheet = ScadaSheet(name=body.name, position=(max_pos + 1) if max_pos is not None else 0)
    db.add(sheet)
    await db.flush()
    await db.refresh(sheet)
    return _sheet_dict(sheet)


@router.patch("/sheets/{sheet_id}", response_model=SheetOut)
async def update_sheet(
    sheet_id: uuid.UUID,
    body: SheetUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    sheet = await _get_sheet_or_404(db, sheet_id)
    if body.name is not None:
        sheet.name = body.name
    if body.position is not None:
        sheet.position = body.position
    await db.flush()
    await db.refresh(sheet)
    return _sheet_dict(sheet)


@router.delete("/sheets/{sheet_id}", response_model=DeletedOut)
async def delete_sheet(
    sheet_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    sheet = await _get_sheet_or_404(db, sheet_id)

    count = (await db.execute(select(func.count(ScadaSheet.id)))).scalar() or 0
    if count <= 1:
        raise HTTPException(status_code=409, detail="Tabel terakhir tidak bisa dihapus")

    has_tags = (
        await db.execute(select(ScadaTag.id).where(ScadaTag.sheet_id == sheet_id).limit(1))
    ).first()
    if has_tags:
        raise HTTPException(
            status_code=409,
            detail="Tabel masih berisi tag — hapus atau pindahkan barisnya dulu",
        )

    # Its custom columns go with it via ON DELETE CASCADE
    await db.delete(sheet)
    await db.flush()
    return {"deleted": str(sheet_id)}


# ---------------------------------------------------------------------------
# Historian: tags
# ---------------------------------------------------------------------------


def _tag_dict(t: ScadaTag) -> dict:
    return {
        "id": str(t.id),
        "sheet_id": str(t.sheet_id),
        "source": t.source,
        "site_id": str(t.site_id) if t.site_id else None,
        "device_key": t.device_key,
        "label": t.label,
        "unit": t.unit,
        "enabled": t.enabled,
        "config": t.config or {},
        "meta": t.meta or {},
        "created_at": str(t.created_at) if t.created_at else None,
        "updated_at": str(t.updated_at) if t.updated_at else None,
    }


@router.get("/tags", response_model=TagListOut)
async def list_tags(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """List historian tags. Disabled tags only visible to scada:manage holders."""
    granted = await _load_permissions(db, profile.role)
    query = select(ScadaTag).order_by(ScadaTag.created_at)
    if "scada:manage" not in granted:
        query = query.where(ScadaTag.enabled.is_(True))

    result = await db.execute(query)
    return {"items": [_tag_dict(t) for t in result.scalars().all()]}


@router.post("/tags", response_model=TagOut, status_code=201)
async def create_tag(
    body: TagCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Create a tag. Simulator tags get 7 days of backfilled history so charts
    are demo-ready immediately; MQTT tags start empty and fill as the bridge
    receives broker messages (backfill is a no-op for them)."""
    await _get_sheet_or_404(db, body.sheet_id)
    if body.source == "mqtt":
        await _get_site_or_404(db, body.site_id)
    tag = ScadaTag(
        sheet_id=body.sheet_id,
        source=body.source,
        site_id=body.site_id if body.source == "mqtt" else None,
        device_key=body.device_key,
        label=body.label,
        unit=body.unit,
        enabled=body.enabled,
        config=body.config,
        meta=body.meta,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    await historian.backfill(db, tag)
    return _tag_dict(tag)


@router.patch("/tags/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: uuid.UUID,
    body: TagUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    tag = await db.get(ScadaTag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag tidak ditemukan")

    if body.sheet_id is not None:
        await _get_sheet_or_404(db, body.sheet_id)
        tag.sheet_id = body.sheet_id
    if body.site_id is not None:
        await _get_site_or_404(db, body.site_id)
        tag.site_id = body.site_id
    if body.source is not None:
        tag.source = body.source
        # Switching a tag back to simulator drops its broker link
        if body.source == "simulator":
            tag.site_id = None
    if body.device_key is not None:
        tag.device_key = body.device_key
    if body.label is not None:
        tag.label = body.label
    if body.unit is not None:
        tag.unit = body.unit
    if body.enabled is not None:
        tag.enabled = body.enabled
    if body.config is not None:
        tag.config = body.config
    if body.meta is not None:
        tag.meta = body.meta

    await db.flush()
    await db.refresh(tag)
    return _tag_dict(tag)


@router.delete("/tags/{tag_id}", response_model=DeletedOut)
async def delete_tag(
    tag_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    tag = await db.get(ScadaTag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag tidak ditemukan")

    # Samples go with it via ON DELETE CASCADE
    await db.delete(tag)
    await db.flush()
    return {"deleted": str(tag_id)}


@router.get("/tags/{tag_id}/recent", response_model=RecentSamplesOut)
async def get_recent_samples(
    tag_id: uuid.UUID,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Raw latest samples for the Riwayat drawer (data-browser view)."""
    granted = await _load_permissions(db, profile.role)
    tag = await db.get(ScadaTag, tag_id)
    if tag is None or (not tag.enabled and "scada:manage" not in granted):
        raise HTTPException(status_code=404, detail="Tag tidak ditemukan")

    result = await db.execute(
        select(ScadaSample)
        .where(ScadaSample.tag_id == tag_id)
        .order_by(ScadaSample.ts.desc())
        .limit(limit)
    )
    return {
        "items": [
            {"ts": s.ts.isoformat(), "value": s.value} for s in result.scalars().all()
        ]
    }


# ---------------------------------------------------------------------------
# Historian: history query (bucketed avg/min/max per tag)
# ---------------------------------------------------------------------------

MAX_HISTORY_TAGS = 4
MAX_HISTORY_POINTS = 720
MAX_HISTORY_SPAN = timedelta(days=45)


@router.get("/history", response_model=HistoryOut)
async def get_history(
    tag_ids: Annotated[list[uuid.UUID], Query(min_length=1, max_length=MAX_HISTORY_TAGS)],
    start: datetime,
    end: datetime,
    points: Annotated[int, Query(ge=10, le=MAX_HISTORY_POINTS)] = 300,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Time-bucketed history. Bucket size is derived from the requested span
    and point budget, so a 30-day chart never ships 43k raw rows."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise HTTPException(status_code=422, detail="Rentang waktu tidak valid")
    if end - start > MAX_HISTORY_SPAN:
        raise HTTPException(status_code=422, detail="Rentang waktu maksimal 45 hari")

    # Same visibility rule as the tag list: no scada:manage → enabled only
    granted = await _load_permissions(db, profile.role)
    tag_query = select(ScadaTag).where(ScadaTag.id.in_(tag_ids))
    if "scada:manage" not in granted:
        tag_query = tag_query.where(ScadaTag.enabled.is_(True))
    tags = {t.id: t for t in (await db.execute(tag_query)).scalars().all()}

    # Bucket = span/points rounded up to whole minutes (samples are 1/minute)
    span_s = (end - start).total_seconds()
    bucket_s = max(60, int(-(-span_s // points) // 60) * 60)
    bucket = func.to_timestamp(
        func.floor(func.extract("epoch", ScadaSample.ts) / bucket_s) * bucket_s
    ).label("bucket")

    result = await db.execute(
        select(
            ScadaSample.tag_id,
            bucket,
            func.avg(ScadaSample.value).label("avg"),
            func.min(ScadaSample.value).label("min"),
            func.max(ScadaSample.value).label("max"),
        )
        .where(
            ScadaSample.tag_id.in_(list(tags.keys())),
            ScadaSample.ts >= start,
            ScadaSample.ts < end,
        )
        .group_by(ScadaSample.tag_id, bucket)
        .order_by(bucket)
    )

    points_by_tag: dict[uuid.UUID, list[dict]] = {tid: [] for tid in tags}
    for row in result.all():
        points_by_tag[row.tag_id].append(
            {
                "t": row.bucket.isoformat(),
                "avg": round(float(row.avg), 4),
                "min": round(float(row.min), 4),
                "max": round(float(row.max), 4),
            }
        )

    return {
        "series": [
            {
                "tag_id": str(tid),
                "label": tags[tid].label,
                "unit": tags[tid].unit,
                "points": pts,
            }
            for tid, pts in points_by_tag.items()
        ]
    }


# ---------------------------------------------------------------------------
# Workbench: shared custom formula columns (Analisis view)
# ---------------------------------------------------------------------------


def _column_dict(c: ScadaWorkbenchColumn) -> dict:
    return {
        "id": str(c.id),
        "sheet_id": str(c.sheet_id),
        "name": c.name,
        "kind": c.kind,
        "formula": c.formula,
        "unit": c.unit,
        "decimals": c.decimals,
        "position": c.position,
        "created_at": str(c.created_at) if c.created_at else None,
        "updated_at": str(c.updated_at) if c.updated_at else None,
    }


@router.get("/workbench/columns", response_model=WorkbenchColumnListOut)
async def list_workbench_columns(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    result = await db.execute(
        select(ScadaWorkbenchColumn).order_by(
            ScadaWorkbenchColumn.position, ScadaWorkbenchColumn.created_at
        )
    )
    return {"items": [_column_dict(c) for c in result.scalars().all()]}


@router.post("/workbench/columns", response_model=WorkbenchColumnOut, status_code=201)
async def create_workbench_column(
    body: WorkbenchColumnCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    await _get_sheet_or_404(db, body.sheet_id)
    max_pos = (
        await db.execute(
            select(func.max(ScadaWorkbenchColumn.position)).where(
                ScadaWorkbenchColumn.sheet_id == body.sheet_id
            )
        )
    ).scalar()
    column = ScadaWorkbenchColumn(
        sheet_id=body.sheet_id,
        name=body.name,
        kind=body.kind,
        formula=body.formula,
        unit=body.unit,
        decimals=body.decimals,
        position=(max_pos + 1) if max_pos is not None else 0,
    )
    db.add(column)
    await db.flush()
    await db.refresh(column)
    return _column_dict(column)


@router.patch("/workbench/columns/{column_id}", response_model=WorkbenchColumnOut)
async def update_workbench_column(
    column_id: uuid.UUID,
    body: WorkbenchColumnUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    column = await db.get(ScadaWorkbenchColumn, column_id)
    if column is None:
        raise HTTPException(status_code=404, detail="Kolom tidak ditemukan")

    if body.name is not None:
        column.name = body.name
    if body.formula is not None:
        column.formula = body.formula
    if body.unit is not None:
        column.unit = body.unit
    if body.decimals is not None:
        column.decimals = body.decimals
    if body.position is not None:
        column.position = body.position

    await db.flush()
    await db.refresh(column)
    return _column_dict(column)


@router.delete("/workbench/columns/{column_id}", response_model=DeletedOut)
async def delete_workbench_column(
    column_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    column = await db.get(ScadaWorkbenchColumn, column_id)
    if column is None:
        raise HTTPException(status_code=404, detail="Kolom tidak ditemukan")

    await db.delete(column)
    await db.flush()
    return {"deleted": str(column_id)}


MAX_SUMMARY_TAGS = 8


@router.get("/summary", response_model=SummaryOut)
async def get_summary(
    tag_ids: Annotated[list[uuid.UUID], Query(min_length=1, max_length=MAX_SUMMARY_TAGS)],
    start: datetime,
    end: datetime,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Per-tag snapshot for table/gauge panels: latest value plus
    min/avg/max over [start, end)."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise HTTPException(status_code=422, detail="Rentang waktu tidak valid")
    if end - start > MAX_HISTORY_SPAN:
        raise HTTPException(status_code=422, detail="Rentang waktu maksimal 45 hari")

    granted = await _load_permissions(db, profile.role)
    tag_query = select(ScadaTag).where(ScadaTag.id.in_(tag_ids))
    if "scada:manage" not in granted:
        tag_query = tag_query.where(ScadaTag.enabled.is_(True))
    # Preserve the caller's ordering — panels rely on it
    visible = {t.id: t for t in (await db.execute(tag_query)).scalars().all()}
    ordered = [tid for tid in tag_ids if tid in visible]

    agg_result = await db.execute(
        select(
            ScadaSample.tag_id,
            func.min(ScadaSample.value).label("min"),
            func.max(ScadaSample.value).label("max"),
            func.avg(ScadaSample.value).label("avg"),
        )
        .where(
            ScadaSample.tag_id.in_(ordered),
            ScadaSample.ts >= start,
            ScadaSample.ts < end,
        )
        .group_by(ScadaSample.tag_id)
    )
    aggs = {row.tag_id: row for row in agg_result.all()}

    # Latest row per tag regardless of window (a gauge must show the current
    # value even if the stats window is short)
    last_result = await db.execute(
        select(ScadaSample)
        .distinct(ScadaSample.tag_id)
        .where(ScadaSample.tag_id.in_(ordered))
        .order_by(ScadaSample.tag_id, ScadaSample.ts.desc())
    )
    lasts = {s.tag_id: s for s in last_result.scalars().all()}

    items = []
    for tid in ordered:
        tag = visible[tid]
        agg = aggs.get(tid)
        last = lasts.get(tid)
        items.append(
            {
                "tag_id": str(tid),
                "label": tag.label,
                "unit": tag.unit,
                "last": last.value if last else None,
                "last_ts": last.ts.isoformat() if last else None,
                "min": round(float(agg.min), 4) if agg else None,
                "max": round(float(agg.max), 4) if agg else None,
                "avg": round(float(agg.avg), 4) if agg else None,
            }
        )
    return {"items": items}
