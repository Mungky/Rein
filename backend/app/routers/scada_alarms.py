"""R-Net alarm API — active list, acknowledge, history, notification settings.

Split out of the (already large) scada.py router. Everything here reads/writes
the tables owned by the server-side alarm engine (app/services/alarm_engine.py):
scada_alarm_events (permanent history; open = cleared_at IS NULL) and the
single-row scada_alarm_settings.

Permissions: reading alarms/settings needs scada:view (same as the panels
that display them); acknowledging needs the dedicated scada:ack so view-only
wall watchers can't claim alarms; editing settings + test-fire needs
scada:manage.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import require_permission
from app.limiter import READ_LIMIT, WRITE_LIMIT, limiter
from app.schemas.scada import (
    AlarmActiveOut,
    AlarmEventOut,
    AlarmHistoryOut,
    AlarmSettingsOut,
    AlarmSettingsUpdateRequest,
    LatestOut,
    RollupArchiveListOut,
    TagArchiveListOut,
    TopicProbeListOut,
)
from app.services import (
    archiver,
    email_notifier,
    notifier,
    rollup_archiver,
    scada_audit,
)
from db.models.profile import Profile
from db.models.scada_audit_log import LOG_UPDATE, TARGET_ALARM_SETTINGS
from db.models.scada import (
    ScadaAlarmEvent,
    ScadaAlarmSettings,
    ScadaRollupArchive,
    ScadaTag,
    ScadaSite,
    ScadaTagArchive,
    ScadaTagLatest,
    ScadaTopicProbe,
)
from db.session import get_db

router = APIRouter()

MAX_LATEST_TAGS = 100


def _event_dict(e: ScadaAlarmEvent, tag: ScadaTag | None) -> dict:
    return {
        "id": str(e.id),
        "tag_id": str(e.tag_id),
        "tag_label": tag.label if tag else "(tag terhapus)",
        "tag_unit": tag.unit if tag else "",
        "kind": e.kind,
        "triggered_at": str(e.triggered_at),
        "trigger_value": e.trigger_value,
        "threshold": e.threshold,
        "cleared_at": str(e.cleared_at) if e.cleared_at else None,
        "ack_at": str(e.ack_at) if e.ack_at else None,
        "ack_name": e.ack_name,
    }


async def _tags_by_id(db: AsyncSession, tag_ids: set) -> dict:
    if not tag_ids:
        return {}
    result = await db.execute(select(ScadaTag).where(ScadaTag.id.in_(tag_ids)))
    return {t.id: t for t in result.scalars().all()}


@router.get("/alarms/active", response_model=AlarmActiveOut)
@limiter.limit(READ_LIMIT)
async def list_active_alarms(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """All open alarm events (cleared_at IS NULL), newest first."""
    result = await db.execute(
        select(ScadaAlarmEvent)
        .where(ScadaAlarmEvent.cleared_at.is_(None))
        .order_by(ScadaAlarmEvent.triggered_at.desc())
    )
    events = list(result.scalars().all())
    tags = await _tags_by_id(db, {e.tag_id for e in events})
    return {"items": [_event_dict(e, tags.get(e.tag_id)) for e in events]}


@router.get("/alarms/history", response_model=AlarmHistoryOut)
@limiter.limit(READ_LIMIT)
async def list_alarm_history(
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    tag_id: uuid.UUID | None = None,
    kind: Annotated[str | None, Query(pattern="^(high|low|silent|expiring)$")] = None,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Paginated alarm history (open AND cleared events), newest first."""
    conditions = []
    if tag_id is not None:
        conditions.append(ScadaAlarmEvent.tag_id == tag_id)
    if kind is not None:
        conditions.append(ScadaAlarmEvent.kind == kind)
    if start is not None:
        conditions.append(ScadaAlarmEvent.triggered_at >= start)
    if end is not None:
        conditions.append(ScadaAlarmEvent.triggered_at <= end)

    total = (
        await db.execute(
            select(func.count()).select_from(ScadaAlarmEvent).where(*conditions)
        )
    ).scalar_one()
    result = await db.execute(
        select(ScadaAlarmEvent)
        .where(*conditions)
        .order_by(ScadaAlarmEvent.triggered_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    events = list(result.scalars().all())
    tags = await _tags_by_id(db, {e.tag_id for e in events})
    return {
        "items": [_event_dict(e, tags.get(e.tag_id)) for e in events],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/alarms/{event_id}/ack", response_model=AlarmEventOut)
@limiter.limit(WRITE_LIMIT)
async def ack_alarm(
    request: Request,
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:ack"))] = None,
):
    """Acknowledge an alarm: records who has seen it and when. Idempotent if
    already acknowledged (first acknowledger is kept); 409 once cleared —
    there is nothing left to acknowledge."""
    event = await db.get(ScadaAlarmEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Alarm tidak ditemukan")
    if event.cleared_at is not None and event.ack_at is None:
        raise HTTPException(
            status_code=409, detail="Alarm sudah selesai (tidak perlu di-ack lagi)"
        )
    if event.ack_at is None:
        event.ack_at = datetime.now(timezone.utc)
        event.ack_by = profile.id
        event.ack_name = profile.full_name or profile.username or "-"
        await db.flush()
        await db.refresh(event)
    tag = await db.get(ScadaTag, event.tag_id)
    return _event_dict(event, tag)


@router.get("/latest", response_model=LatestOut)
@limiter.limit(READ_LIMIT)
async def get_latest(
    request: Request,
    tag_ids: Annotated[str, Query(min_length=1)] = "",
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Last-known value per tag from scada_tag_latest (the live lane). Cheap —
    no aggregates — so the cap is generous (100 tags vs /summary's 8)."""
    try:
        ids = [uuid.UUID(part) for part in tag_ids.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="tag_ids tidak valid")
    if not ids:
        return {"items": []}
    if len(ids) > MAX_LATEST_TAGS:
        raise HTTPException(
            status_code=422, detail=f"Maksimal {MAX_LATEST_TAGS} tag per permintaan"
        )
    result = await db.execute(
        select(ScadaTagLatest).where(ScadaTagLatest.tag_id.in_(ids))
    )
    return {
        "items": [
            {"tag_id": str(row.tag_id), "ts": str(row.ts), "value": row.value}
            for row in result.scalars().all()
        ]
    }


@router.get("/archives", response_model=TagArchiveListOut)
@limiter.limit(READ_LIMIT)
async def list_archives(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Completed per-tag cycle archives on Drive (newest first) — where each
    sensor's data lives on after its 1-month reset."""
    result = await db.execute(
        select(ScadaTagArchive)
        .where(ScadaTagArchive.drive_file_id.is_not(None))
        .order_by(ScadaTagArchive.created_at.desc())
    )
    archives = result.scalars().all()
    tags = await _tags_by_id(db, {a.tag_id for a in archives})
    return {
        "items": [
            {
                "tag_id": str(a.tag_id),
                "tag_label": tags[a.tag_id].label if a.tag_id in tags else "(tag terhapus)",
                "file_name": a.file_name,
                "web_link": a.web_link,
                "row_count": a.row_count,
                "cycle_start": str(a.cycle_start),
                "cycle_end": str(a.cycle_end),
                "created_at": str(a.created_at) if a.created_at else None,
            }
            for a in archives
        ]
    }


@router.post("/archives/run")
@limiter.limit(WRITE_LIMIT)
async def run_archiver_now(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Run the archive+reset pass immediately (normally it runs itself). Only
    tags whose 1-month cycle has fully elapsed are archived and reset."""
    results = await archiver.archive_once(db)
    return {"archived": results}


@router.get("/rollup-archives", response_model=RollupArchiveListOut)
@limiter.limit(READ_LIMIT)
async def list_rollup_archives(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Completed SUMMARY-month archives on Drive (newest first).

    This is the receipt for the 1-minute lane: a month only leaves the database
    after every plant appears here for it. If this list is empty while months
    are ageing out, retention is not running — check the archiver logs and the
    Drive credentials rather than assuming the data was tidied away."""
    result = await db.execute(
        select(ScadaRollupArchive)
        .where(ScadaRollupArchive.drive_file_id.is_not(None))
        .order_by(ScadaRollupArchive.month.desc(), ScadaRollupArchive.plant)
    )
    return {
        "items": [
            {
                "site_id": str(a.site_id) if a.site_id else None,
                "plant": a.plant,
                "month": a.month.isoformat(),
                "file_name": a.file_name,
                "web_link": a.web_link,
                "row_count": a.row_count,
                "tag_count": a.tag_count,
                "created_at": str(a.created_at) if a.created_at else None,
            }
            for a in result.scalars().all()
        ]
    }


@router.post("/rollup-archives/run")
@limiter.limit(WRITE_LIMIT)
async def run_rollup_archiver_now(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Archive expired summary months right now instead of waiting for the loop.

    Deletes nothing: it uploads and records. The month partition is dropped
    later by the partition manager, and only once every plant is recorded here.
    Use this to prove the Drive path works BEFORE trusting retention with it."""
    results = await rollup_archiver.archive_once(db)
    return {"archived": results}


@router.get("/topic-probes", response_model=TopicProbeListOut)
@limiter.limit(READ_LIMIT)
async def list_topic_probes(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:manage"))] = None,
):
    """What every subscribed MQTT topic is sending right now, with the field
    names an operator has to type into "Field".

    Answers the question the bridge used to answer only in its own log file on
    the field PC: a bundled sensor's Field must match the gateway's variable
    name exactly, and getting it wrong produces an empty sensor and no error.

    Each name is annotated with the sensors already reading it, so the list
    doubles as a checklist of what is still unwired. Matching is on
    (topic, "Perangkat") — the same rule the bridge routes by, so what is shown
    here is what actually happens rather than a second guess at it.

    scada:manage, not scada:view: this is a setup tool and it exposes
    device-internal variable names.
    """
    probes = (
        (
            await db.execute(
                select(ScadaTopicProbe).order_by(
                    ScadaTopicProbe.topic, ScadaTopicProbe.gateway
                )
            )
        )
        .scalars()
        .all()
    )
    if not probes:
        return {"items": []}

    sites = {
        s.id: s.name
        for s in (await db.execute(select(ScadaSite))).scalars().all()
    }
    tags = (
        (await db.execute(select(ScadaTag).where(ScadaTag.source == "mqtt")))
        .scalars()
        .all()
    )
    # (topic, perangkat) -> labels. "Perangkat" is the value's name at the
    # source and the only thing the bridge routes by, so it is what decides
    # whether a name on the monitor is already spoken for.
    claims: dict[tuple[str, str], list[str]] = {}
    for tag in tags:
        cfg = tag.config or {}
        topic = str(cfg.get("mqtt_topic") or "").strip()
        if not topic:
            continue
        claims.setdefault((topic, (tag.device_key or "").strip()), []).append(tag.label)

    items = []
    for p in probes:
        values = p.values or {}
        bundled = not (len(values) == 1 and "" in values)
        fields = []
        for name in sorted(values):
            used = list(claims.get((p.topic, name), []))
            # The gateway-qualified spelling names the same value.
            if p.gateway:
                used += claims.get((p.topic, f"{p.gateway}.{name}"), [])
            try:
                value = float(values[name])
            except (TypeError, ValueError):
                continue
            fields.append(
                {"name": name, "value": value, "used_by": sorted(set(used))}
            )
        items.append({
            "site_id": str(p.site_id),
            "site_name": sites.get(p.site_id, "(site terhapus)"),
            "topic": p.topic,
            "gateway": p.gateway,
            "bundled": bundled,
            "fields": fields,
            "seen_at": str(p.seen_at),
        })
    return {"items": items}


def _settings_dict(s: ScadaAlarmSettings) -> dict:
    return {
        "email_enabled": s.email_enabled,
        "email_recipients": s.email_recipients,
        "telegram_enabled": s.telegram_enabled,
        "telegram_chat_id": s.telegram_chat_id,
        "cooldown_min": s.cooldown_min,
        "sound_enabled": s.sound_enabled,
        "telegram_token_set": bool(settings.telegram_bot_token),
    }


async def _get_settings_row(db: AsyncSession) -> ScadaAlarmSettings:
    row = await db.get(ScadaAlarmSettings, 1)
    if row is None:
        # Migration seeds id=1; recreate defensively if it ever goes missing.
        row = ScadaAlarmSettings(id=1)
        db.add(row)
        await db.flush()
    return row


@router.get("/alarm-settings", response_model=AlarmSettingsOut)
@limiter.limit(READ_LIMIT)
async def get_alarm_settings(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Read by every viewer: the frontend needs sound_enabled to know whether
    to beep. Recipients/chat id are operational config, not secrets."""
    return _settings_dict(await _get_settings_row(db))


@router.put("/alarm-settings", response_model=AlarmSettingsOut)
@limiter.limit(WRITE_LIMIT)
async def update_alarm_settings(
    request: Request,
    body: AlarmSettingsUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    row = await _get_settings_row(db)
    before = scada_audit.alarm_settings_snapshot(row)
    for field in (
        "email_enabled",
        "email_recipients",
        "telegram_enabled",
        "telegram_chat_id",
        "cooldown_min",
        "sound_enabled",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(row, field, value)
    await db.flush()
    await db.refresh(row)
    changes = scada_audit.diff_fields(before, scada_audit.alarm_settings_snapshot(row))
    if changes:
        scada_audit.log_scada_change(
            db, profile, LOG_UPDATE, TARGET_ALARM_SETTINGS,
            target_label="Pengaturan alarm", changes=changes,
        )
    return _settings_dict(row)


@router.post("/alarm-settings/test")
@limiter.limit(WRITE_LIMIT)
async def send_test_notification(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Fire a test message through every ENABLED channel so the operator can
    verify recipients/bot config before relying on real alarms."""
    row = await _get_settings_row(db)
    subject = "UJI COBA notifikasi alarm R-Net"
    body = (
        f"Ini pesan uji coba dari R-Net (diminta oleh "
        f"{profile.full_name or profile.username}). Jika Anda menerima pesan "
        f"ini, kanal notifikasi alarm sudah bekerja."
    )
    sent: list[str] = []
    if row.email_enabled and row.email_recipients:
        await email_notifier.send_to_list(row.email_recipients, subject, body)
        sent.append("email")
    if row.telegram_enabled and row.telegram_chat_id:
        await notifier.send_telegram(row.telegram_chat_id, f"{subject}\n{body}")
        sent.append("telegram")
    if not sent:
        raise HTTPException(
            status_code=422,
            detail="Tidak ada kanal aktif — aktifkan email/Telegram dulu di pengaturan",
        )
    return {"sent": sent}
