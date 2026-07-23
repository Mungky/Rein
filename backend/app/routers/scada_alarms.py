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

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import require_permission
from app.schemas.scada import (
    AlarmActiveOut,
    AlarmEventOut,
    AlarmHistoryOut,
    AlarmSettingsOut,
    AlarmSettingsUpdateRequest,
    LatestOut,
    TagArchiveListOut,
)
from app.services import archiver, notifier
from db.models.profile import Profile
from db.models.scada import (
    ScadaAlarmEvent,
    ScadaAlarmSettings,
    ScadaTag,
    ScadaTagArchive,
    ScadaTagLatest,
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
async def list_active_alarms(
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
async def list_alarm_history(
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
async def ack_alarm(
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
async def get_latest(
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
async def list_archives(
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
async def run_archiver_now(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    """Run the archive+reset pass immediately (normally it runs itself). Only
    tags whose 1-month cycle has fully elapsed are archived and reset."""
    results = await archiver.archive_once(db)
    return {"archived": results}


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
async def get_alarm_settings(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view"))] = None,
):
    """Read by every viewer: the frontend needs sound_enabled to know whether
    to beep. Recipients/chat id are operational config, not secrets."""
    return _settings_dict(await _get_settings_row(db))


@router.put("/alarm-settings", response_model=AlarmSettingsOut)
async def update_alarm_settings(
    body: AlarmSettingsUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("scada:view", "scada:manage"))] = None,
):
    row = await _get_settings_row(db)
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
    return _settings_dict(row)


@router.post("/alarm-settings/test")
async def send_test_notification(
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
        for recipient in row.email_recipients.split(","):
            recipient = recipient.strip()
            if recipient:
                await notifier.send_email(to=recipient, subject=subject, body=body)
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
