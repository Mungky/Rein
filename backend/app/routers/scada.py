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

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import TypeAdapter
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import _load_permissions, require_permission
from app.limiter import READ_LIMIT, WRITE_LIMIT, limiter
from app.schemas.scada import (
    Panel,
    PerspectiveLayout,
    ChannelCreateRequest,
    ChannelListOut,
    ChannelOut,
    ChannelUpdateRequest,
    DeletedOut,
    HistoryOut,
    RecentSamplesOut,
    SamplesPageOut,
    SparklinesOut,
    validate_channel_config,
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
    RnetSettingsOut,
    RnetSettingsUpdateRequest,
    TagCreateRequest,
    TagListOut,
    TagOut,
    TagUpdateRequest,
    validate_sampling_level,
    WorkbenchColumnCreateRequest,
    WorkbenchColumnListOut,
    WorkbenchColumnOut,
    WorkbenchColumnUpdateRequest,
)
from app.services import historian
from app.services import rnet_settings
from db.models.profile import Profile
from db.models.scada import (
    ScadaChannel,
    ScadaPerspective,
    ScadaRing,
    ScadaSample,
    ScadaSampleAll,
    ScadaSettings,
    ScadaSheet,
    ScadaSite,
    ScadaStream,
    ScadaTag,
    ScadaTagLatest,
    ScadaWorkbenchColumn,
)
from db.session import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_PANEL_ADAPTER = TypeAdapter(Panel)
_EMPTY_LAYOUT = {"version": 2, "canvas": {"w": 1920, "h": 1080}, "panels": []}


def _safe_layout(layout: object) -> dict:
    """Jalur BACA yang toleran: layout tersimpan yang tidak lolos skema versi
    ini (mis. berisi tipe panel dari rilis yang lebih baru, karena DB dipakai
    bersama saat backend belum di-redeploy) tidak boleh membuat seluruh
    daftar perspective 500. Panel yang tak dikenal DILEWATI, sisanya tetap
    tampil; layout yang benar-benar rusak jatuh ke layout kosong. Jalur TULIS
    tetap divalidasi ketat seperti biasa."""
    try:
        PerspectiveLayout.model_validate(layout)
        return layout  # type: ignore[return-value]
    except Exception:
        pass
    if not isinstance(layout, dict):
        return dict(_EMPTY_LAYOUT)
    kept = []
    for p in layout.get("panels") or []:
        try:
            _PANEL_ADAPTER.validate_python(p)
            kept.append(p)
        except Exception:
            continue
    candidate = {**layout, "panels": kept}
    try:
        PerspectiveLayout.model_validate(candidate)
        return candidate
    except Exception:
        return dict(_EMPTY_LAYOUT)


def _perspective_dict(p: ScadaPerspective) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "layout": _safe_layout(p.layout),
        "is_default": p.is_default,
        "is_published": p.is_published,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


async def _get_published(db: AsyncSession) -> list[ScadaPerspective]:
    """All admin-published default pages, oldest first (stable page order)."""
    result = await db.execute(
        select(ScadaPerspective)
        .where(ScadaPerspective.is_published.is_(True))
        .order_by(ScadaPerspective.created_at)
    )
    return list(result.scalars().all())


def _stream_dict(s: ScadaStream) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "source_type": s.source_type,
        "hls_url": s.hls_url,
        "webrtc_url": s.webrtc_url,
        "read_user": s.read_user,
        "read_pass": s.read_pass,
        "url": s.url,
        "secret": s.secret,
        "enabled": s.enabled,
        "created_at": str(s.created_at) if s.created_at else None,
        "updated_at": str(s.updated_at) if s.updated_at else None,
    }


def _validate_effective_source(s: ScadaStream) -> None:
    """Ensure a source row has the URL its type needs and drop the fields the
    type doesn't use (so switching type never leaves a stale address). Mirrors
    the create-time validation in schemas.StreamCreateRequest."""
    if s.source_type == "stream":
        if not (s.hls_url and s.hls_url.strip()):
            raise ValueError("Stream butuh URL HLS")
        s.url = None
        s.secret = None
    elif s.source_type == "web":
        if not (s.url and s.url.strip()):
            raise ValueError("Sumber web butuh URL halaman")
        if not re.match(r"^https?://", s.url.strip(), re.IGNORECASE):
            raise ValueError("URL web harus diawali http:// atau https://")
        s.hls_url = s.webrtc_url = s.read_user = s.read_pass = s.secret = None
    elif s.source_type == "vnc":
        if not (s.url and s.url.strip()):
            raise ValueError("Sumber VNC butuh alamat noVNC/websockify")
        if not re.match(r"^(https?|wss?)://", s.url.strip(), re.IGNORECASE):
            raise ValueError("Alamat VNC harus http(s):// atau ws(s)://")
        s.hls_url = s.webrtc_url = s.read_user = s.read_pass = None
    else:
        raise ValueError(f"Jenis sumber tidak dikenal: {s.source_type}")


async def _get_own_perspective(
    db: AsyncSession, perspective_id: uuid.UUID, owner_id: uuid.UUID
) -> ScadaPerspective:
    p = await db.get(ScadaPerspective, perspective_id)
    if p is None or p.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Perspective tidak ditemukan")
    return p


async def _bootstrap_default(db: AsyncSession, owner_id: uuid.UUID) -> ScadaPerspective:
    """Create an empty fixed-canvas starter page (layout v2, 1920×1080) for a
    user who has no layouts and when no admin default is published.

    When an admin default IS published, list_perspectives injects it as a
    read-only entry instead — so we don't bootstrap a private copy here.
    """
    perspective = ScadaPerspective(
        owner_id=owner_id,
        name="Default",
        layout={"version": 2, "canvas": {"w": 1920, "h": 1080}, "panels": []},
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
@limiter.limit(READ_LIMIT)
async def list_perspectives(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """List the caller's own perspectives, plus EVERY admin-published default
    page (Masalah D, multi-page) injected as read-only entries — publish 4
    pages and every user has those 4 pages. Bootstraps a starter only when the
    user has nothing and nothing is published."""
    result = await db.execute(
        select(ScadaPerspective)
        .where(ScadaPerspective.owner_id == profile.id)
        .order_by(ScadaPerspective.created_at)
    )
    own = list(result.scalars().all())
    items = [{**_perspective_dict(p), "read_only": False} for p in own]

    published = await _get_published(db)
    injected = [
        {**_perspective_dict(p), "read_only": True}
        for p in published
        if p.owner_id != profile.id
    ]
    # Admin pages come first, in their stable (creation) order — the natural
    # landing pages for everyone; view-only, forked into a copy on edit.
    items = injected + items

    if not items:
        boot = await _bootstrap_default(db, profile.id)
        items = [{**_perspective_dict(boot), "read_only": False}]

    return {"items": items}


@router.get("/perspectives/published", response_model=PublishedLayoutOut)
@limiter.limit(READ_LIMIT)
async def get_published_perspective(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """First admin-published default page (compat shape; multiple pages may be
    published — the full set is injected by list_perspectives). exists=False
    when nothing is published."""
    published = await _get_published(db)
    if not published:
        return {"exists": False, "name": None, "layout": None}
    return {
        "exists": True,
        "name": published[0].name,
        "layout": _safe_layout(published[0].layout),
    }


@router.post("/perspectives", response_model=PerspectiveOut, status_code=201)
@limiter.limit(WRITE_LIMIT)
async def create_perspective(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def update_perspective(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def delete_perspective(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def set_default_perspective(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def publish_perspective(
    request: Request,
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Publish one of the caller's own perspectives as an admin default page.
    Multiple pages may be published (multi-page bawaan admin): every published
    page appears read-only in EVERY user's page list."""
    perspective = await _get_own_perspective(db, perspective_id, profile.id)
    perspective.is_published = True
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


@router.post("/perspectives/{perspective_id}/unpublish", response_model=PerspectiveOut)
@limiter.limit(WRITE_LIMIT)
async def unpublish_perspective(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def reset_perspective_to_published(
    request: Request,
    perspective_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Overwrite the caller's own perspective with the FIRST admin-published
    page ('Kembalikan ke Bawaan Admin'). With multi-page defaults every
    published page is already visible read-only, so this remains only as a
    quick way to stamp the primary default onto an own page. 409 when nothing
    is published."""
    perspective = await _get_own_perspective(db, perspective_id, profile.id)
    published = await _get_published(db)
    if not published:
        raise HTTPException(
            status_code=409, detail="Belum ada layout bawaan admin yang diterbitkan"
        )
    perspective.layout = published[0].layout
    await db.flush()
    await db.refresh(perspective)
    return _perspective_dict(perspective)


# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------


@router.get("/streams", response_model=StreamListOut)
@limiter.limit(READ_LIMIT)
async def list_streams(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def create_stream(
    request: Request,
    body: StreamCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    stream = ScadaStream(
        name=body.name,
        source_type=body.source_type,
        hls_url=(body.hls_url or None) if body.source_type == "stream" else None,
        webrtc_url=body.webrtc_url or None,
        read_user=body.read_user,
        read_pass=body.read_pass,
        url=(body.url or None) if body.source_type in ("web", "vnc") else None,
        secret=(body.secret or None) if body.source_type == "vnc" else None,
        enabled=body.enabled,
    )
    db.add(stream)
    await db.flush()
    await db.refresh(stream)
    return _stream_dict(stream)


@router.patch("/streams/{stream_id}", response_model=StreamOut)
@limiter.limit(WRITE_LIMIT)
async def update_stream(
    request: Request,
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
    if body.source_type is not None:
        stream.source_type = body.source_type
    if body.hls_url is not None:
        stream.hls_url = body.hls_url or None
    if body.webrtc_url is not None:
        stream.webrtc_url = body.webrtc_url or None
    if body.read_user is not None:
        stream.read_user = body.read_user or None
    if body.read_pass is not None:
        stream.read_pass = body.read_pass or None
    if body.url is not None:
        stream.url = body.url or None
    if body.secret is not None:
        stream.secret = body.secret or None
    if body.enabled is not None:
        stream.enabled = body.enabled

    # Validate the EFFECTIVE source (type + the URL it requires) after merging,
    # then null out the fields the type doesn't use so stale addresses can't
    # linger when a source is switched between kinds.
    try:
        _validate_effective_source(stream)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    await db.flush()
    await db.refresh(stream)
    return _stream_dict(stream)


@router.delete("/streams/{stream_id}", response_model=DeletedOut)
@limiter.limit(WRITE_LIMIT)
async def delete_stream(
    request: Request,
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
# Channels — the TV-style registry (number + nickname + one source). Layout
# panels reference channels by id; sources are defined once, on halaman
# Channel. Viewing needs scada:view; managing needs scada:manage.
# ---------------------------------------------------------------------------


def _channel_dict(c: ScadaChannel) -> dict:
    return {
        "id": str(c.id),
        "number": c.number,
        "name": c.name,
        "kind": c.kind,
        "config": c.config,
        "enabled": c.enabled,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


async def _check_channel_number_free(
    db: AsyncSession, number: int, exclude_id: uuid.UUID | None = None
) -> None:
    query = select(ScadaChannel.id).where(ScadaChannel.number == number)
    if exclude_id is not None:
        query = query.where(ScadaChannel.id != exclude_id)
    if (await db.execute(query)).first() is not None:
        raise HTTPException(
            status_code=409, detail=f"Nomor channel {number} sudah dipakai"
        )


@router.get("/channels", response_model=ChannelListOut)
@limiter.limit(READ_LIMIT)
async def list_channels(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    result = await db.execute(select(ScadaChannel).order_by(ScadaChannel.number))
    return {"items": [_channel_dict(c) for c in result.scalars().all()]}


@router.post("/channels", response_model=ChannelOut, status_code=201)
@limiter.limit(WRITE_LIMIT)
async def create_channel(
    request: Request,
    body: ChannelCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    await _check_channel_number_free(db, body.number)
    channel = ScadaChannel(
        number=body.number,
        name=body.name,
        kind=body.kind,
        config=body.config,
        enabled=body.enabled,
    )
    db.add(channel)
    await db.flush()
    await db.refresh(channel)
    return _channel_dict(channel)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
@limiter.limit(WRITE_LIMIT)
async def update_channel(
    request: Request,
    channel_id: uuid.UUID,
    body: ChannelUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    channel = await db.get(ScadaChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel tidak ditemukan")

    if body.number is not None and body.number != channel.number:
        await _check_channel_number_free(db, body.number, exclude_id=channel.id)
        channel.number = body.number
    if body.name is not None:
        channel.name = body.name

    # Config is validated against the EFFECTIVE kind (new kind if changing,
    # else the current one) so a kind switch always carries a matching config.
    effective_kind = body.kind or channel.kind
    if body.kind is not None or body.config is not None:
        raw = body.config if body.config is not None else channel.config
        try:
            channel.config = validate_channel_config(effective_kind, raw)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"Config channel tidak valid: {exc}"
            ) from exc
        channel.kind = effective_kind

    if body.enabled is not None:
        channel.enabled = body.enabled

    await db.flush()
    await db.refresh(channel)
    return _channel_dict(channel)


@router.delete("/channels/{channel_id}", response_model=DeletedOut)
@limiter.limit(WRITE_LIMIT)
async def delete_channel(
    request: Request,
    channel_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    channel = await db.get(ScadaChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Channel tidak ditemukan")
    await db.delete(channel)
    await db.flush()
    return {"deleted": str(channel_id)}


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
@limiter.limit(READ_LIMIT)
async def list_sites(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    result = await db.execute(select(ScadaSite).order_by(ScadaSite.created_at))
    return {"items": [_site_dict(s) for s in result.scalars().all()]}


@router.post("/sites", response_model=SiteOut, status_code=201)
@limiter.limit(WRITE_LIMIT)
async def create_site(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def update_site(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def delete_site(
    request: Request,
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
@limiter.limit(READ_LIMIT)
async def list_sheets(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def create_sheet(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def update_sheet(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def delete_sheet(
    request: Request,
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
@limiter.limit(READ_LIMIT)
async def list_tags(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def create_tag(
    request: Request,
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
    # A tag created with "Simpan data" on starts its 1-month reset clock now.
    config = dict(body.config)
    if config.get("store_enabled") and not config.get("store_cycle_start"):
        config["store_cycle_start"] = rnet_settings.now_iso()
    tag = ScadaTag(
        sheet_id=body.sheet_id,
        source=body.source,
        site_id=body.site_id if body.source == "mqtt" else None,
        device_key=body.device_key,
        label=body.label,
        unit=body.unit,
        enabled=body.enabled,
        config=config,
        meta=body.meta,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    await historian.backfill(db, tag)
    return _tag_dict(tag)


@router.patch("/tags/{tag_id}", response_model=TagOut)
@limiter.limit(WRITE_LIMIT)
async def update_tag(
    request: Request,
    tag_id: uuid.UUID,
    body: TagUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    tag = await db.get(ScadaTag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag tidak ditemukan")

    # A source switch means a DIFFERENT data stream — the old history (e.g.
    # simulator placeholder values) would only mislead, so it gets purged below.
    source_changed = body.source is not None and body.source != tag.source
    old_store = bool((tag.config or {}).get("store_enabled"))

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

    # Sampling/store rules depend on the MERGED config (which may have just
    # changed) — schema-level validation can't see the other half.
    try:
        validate_sampling_level(tag.config)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Toggling "Simpan data" flips a tag between the ring and historian lanes —
    # a clean break: purge both tables and (re)start the reset clock on enable.
    new_store = bool((tag.config or {}).get("store_enabled"))
    store_changed = new_store != old_store
    if new_store and not (tag.config or {}).get("store_cycle_start"):
        cfg = dict(tag.config or {})
        cfg["store_cycle_start"] = rnet_settings.now_iso()
        tag.config = cfg

    if source_changed or store_changed:
        await db.execute(delete(ScadaSample).where(ScadaSample.tag_id == tag.id))
        await db.execute(delete(ScadaRing).where(ScadaRing.tag_id == tag.id))
        await db.execute(
            delete(ScadaTagLatest).where(ScadaTagLatest.tag_id == tag.id)
        )

    await db.flush()
    await db.refresh(tag)
    return _tag_dict(tag)


@router.delete("/tags/{tag_id}", response_model=DeletedOut)
@limiter.limit(WRITE_LIMIT)
async def delete_tag(
    request: Request,
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
@limiter.limit(READ_LIMIT)
async def get_recent_samples(
    request: Request,
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
        select(ScadaSampleAll)
        .where(ScadaSampleAll.tag_id == tag_id)
        .order_by(ScadaSampleAll.ts.desc())
        .limit(limit)
    )
    return {
        "items": [
            {"ts": s.ts.isoformat(), "value": s.value} for s in result.scalars().all()
        ]
    }


@router.get("/tags/{tag_id}/samples", response_model=SamplesPageOut)
@limiter.limit(READ_LIMIT)
async def get_samples_page(
    request: Request,
    tag_id: uuid.UUID,
    before: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 2000,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Keyset-paged raw samples, newest first — the infinite-scroll feed for
    the Riwayat table. `before` = ts of the oldest row already loaded; the
    next page continues strictly older than it (no OFFSET, so page N of a
    million-row tag costs the same as page 1)."""
    granted = await _load_permissions(db, profile.role)
    tag = await db.get(ScadaTag, tag_id)
    if tag is None or (not tag.enabled and "scada:manage" not in granted):
        raise HTTPException(status_code=404, detail="Tag tidak ditemukan")

    if before is not None and before.tzinfo is None:
        before = before.replace(tzinfo=timezone.utc)

    query = select(ScadaSampleAll).where(ScadaSampleAll.tag_id == tag_id)
    if before is not None:
        query = query.where(ScadaSampleAll.ts < before)
    result = await db.execute(query.order_by(ScadaSampleAll.ts.desc()).limit(limit + 1))
    rows = result.scalars().all()
    return {
        "items": [{"ts": s.ts.isoformat(), "value": s.value} for s in rows[:limit]],
        "has_more": len(rows) > limit,
    }


# ---------------------------------------------------------------------------
# Historian: history query (bucketed avg/min/max per tag)
# ---------------------------------------------------------------------------

MAX_HISTORY_TAGS = 4
MAX_HISTORY_POINTS = 720
MAX_HISTORY_SPAN = timedelta(days=45)


@router.get("/history", response_model=HistoryOut)
@limiter.limit(READ_LIMIT)
async def get_history(
    request: Request,
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

    # Bucket = span / point budget, floor 1 second. Sampling is per-tag now
    # (as fast as the tag's sampling level, e.g. 2 s), so a
    # minute floor would flatten a 3-second sensor into one point per minute —
    # the line looked stepped instead of live. The point budget still bounds
    # how many rows come back.
    span_s = (end - start).total_seconds()
    bucket_s = max(1, int(-(-span_s // points)))
    bucket = func.to_timestamp(
        func.floor(func.extract("epoch", ScadaSampleAll.ts) / bucket_s) * bucket_s
    ).label("bucket")

    result = await db.execute(
        select(
            ScadaSampleAll.tag_id,
            bucket,
            func.avg(ScadaSampleAll.value).label("avg"),
            func.min(ScadaSampleAll.value).label("min"),
            func.max(ScadaSampleAll.value).label("max"),
        )
        .where(
            ScadaSampleAll.tag_id.in_(list(tags.keys())),
            ScadaSampleAll.ts >= start,
            ScadaSampleAll.ts < end,
        )
        .group_by(ScadaSampleAll.tag_id, bucket)
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
@limiter.limit(READ_LIMIT)
async def list_workbench_columns(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def create_workbench_column(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def update_workbench_column(
    request: Request,
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
@limiter.limit(WRITE_LIMIT)
async def delete_workbench_column(
    request: Request,
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
@limiter.limit(READ_LIMIT)
async def get_summary(
    request: Request,
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
            ScadaSampleAll.tag_id,
            func.min(ScadaSampleAll.value).label("min"),
            func.max(ScadaSampleAll.value).label("max"),
            func.avg(ScadaSampleAll.value).label("avg"),
        )
        .where(
            ScadaSampleAll.tag_id.in_(ordered),
            ScadaSampleAll.ts >= start,
            ScadaSampleAll.ts < end,
        )
        .group_by(ScadaSampleAll.tag_id)
    )
    aggs = {row.tag_id: row for row in agg_result.all()}

    # Latest row per tag regardless of window (a gauge must show the current
    # value even if the stats window is short)
    last_result = await db.execute(
        select(ScadaSampleAll)
        .distinct(ScadaSampleAll.tag_id)
        .where(ScadaSampleAll.tag_id.in_(ordered))
        .order_by(ScadaSampleAll.tag_id, ScadaSampleAll.ts.desc())
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


# ---------------------------------------------------------------------------
# Sparklines: bucketed mini-series for every visible tag (Analisis table)
# ---------------------------------------------------------------------------

SPARK_MAX_POINTS = 240


@router.get("/sparklines", response_model=SparklinesOut)
@limiter.limit(READ_LIMIT)
async def get_sparklines(
    request: Request,
    range_h: Annotated[int, Query(ge=1, le=168)] = 12,
    points: Annotated[int, Query(ge=10, le=SPARK_MAX_POINTS)] = 120,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """One bucketed series (avg per bucket) per visible tag over the last
    `range_h` hours — feeds the 12-jam mini-charts in the Analisis table in a
    single query instead of N per-tag requests. Same visibility rule as the tag
    list: no scada:manage → enabled tags only."""
    granted = await _load_permissions(db, profile.role)
    tag_query = select(ScadaTag.id)
    if "scada:manage" not in granted:
        tag_query = tag_query.where(ScadaTag.enabled.is_(True))
    tag_ids = [r[0] for r in (await db.execute(tag_query)).all()]
    if not tag_ids:
        return {"items": []}

    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=range_h)
    span_s = (end - start).total_seconds()
    bucket_s = max(1, int(-(-span_s // points)))
    bucket = func.to_timestamp(
        func.floor(func.extract("epoch", ScadaSampleAll.ts) / bucket_s) * bucket_s
    ).label("bucket")

    result = await db.execute(
        select(
            ScadaSampleAll.tag_id,
            bucket,
            func.avg(ScadaSampleAll.value).label("avg"),
        )
        .where(
            ScadaSampleAll.tag_id.in_(tag_ids),
            ScadaSampleAll.ts >= start,
            ScadaSampleAll.ts < end,
        )
        .group_by(ScadaSampleAll.tag_id, bucket)
        .order_by(ScadaSampleAll.tag_id, bucket)
    )
    by_tag: dict[uuid.UUID, list[dict]] = {tid: [] for tid in tag_ids}
    for row in result.all():
        by_tag[row.tag_id].append(
            {"t": row.bucket.isoformat(), "v": round(float(row.avg), 4)}
        )
    return {"items": [{"tag_id": str(tid), "points": pts} for tid, pts in by_tag.items()]}


# ---------------------------------------------------------------------------
# R-Net settings (sampling-level durations + retention) — admin-tunable
# ---------------------------------------------------------------------------

_SETTINGS_FIELDS = (
    "level_fastest_s",
    "level_fast_s",
    "level_slow_s",
    "level_slowest_s",
    "ring_window_h",
    "store_months",
    "reset_warn_days",
)


def _settings_dict(s: ScadaSettings) -> dict:
    return {f: getattr(s, f) for f in _SETTINGS_FIELDS}


@router.get("/settings", response_model=RnetSettingsOut)
@limiter.limit(READ_LIMIT)
async def get_rnet_settings(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Read the single R-Net settings row (created with defaults if missing)."""
    return _settings_dict(await rnet_settings.get_settings(db))


@router.patch("/settings", response_model=RnetSettingsOut)
@limiter.limit(WRITE_LIMIT)
async def update_rnet_settings(
    request: Request,
    body: RnetSettingsUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[
        Profile, Depends(require_permission("scada:view", "scada:manage"))
    ] = None,
):
    """Update sampling-level durations / retention knobs (partial). The bridge,
    historian, alarm engine and archiver pick up changes on their next loop."""
    s = await rnet_settings.get_settings(db)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(s, field, val)
    await db.flush()
    await db.refresh(s)
    return _settings_dict(s)
