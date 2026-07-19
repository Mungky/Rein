"""R-Net server-side alarm engine — detects breaches with nobody watching.

Every ALARM_INTERVAL_S the engine reads scada_tag_latest (one cheap SELECT for
all tags) and evaluates three conditions per enabled tag:

  high    latest.value > config.alarm_max
  low     latest.value < config.alarm_min
  silent  automatic for every MQTT tag: no data for > max(3 × interval, 60 s)
          (ring-mode tags use the flat 60 s window)

State lives in scada_alarm_events: an OPEN event is a row with cleared_at
NULL. Opening uses INSERT .. ON CONFLICT DO NOTHING against the partial
unique index uq_scada_alarm_open (tag_id, kind WHERE cleared_at IS NULL), and
clearing uses UPDATE .. WHERE cleared_at IS NULL RETURNING — both are atomic,
so engine restarts and two backends sharing one DB (laptop dev + server) can
never double-open or double-notify. Only the winner of each transition hands
the event to the notifier (email/Telegram; in-app needs nothing — browsers
get the row via Supabase Realtime).

Sensor-silence fallback: an old bridge deployment that predates
scada_tag_latest never writes latest rows. Before firing "silent" for a tag
without one, the engine checks the newest scada_samples row — so a stale
bridge doesn't cause false alarms (see plan: deploy the bridge first, then
enable silent alarms).

Set ALARM_ENGINE_ENABLED=0 where the engine must not run (e.g. the personal
laptop — no background services; the server is the single engine).
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import notifier
from db.models.scada import (
    ScadaAlarmEvent,
    ScadaSample,
    ScadaTag,
    ScadaTagLatest,
)

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("ALARM_INTERVAL_S", "5"))
ENABLED = os.getenv("ALARM_ENGINE_ENABLED", "1") not in ("0", "false", "False")
SILENT_FACTOR = int(os.getenv("ALARM_SILENT_FACTOR", "3"))
SILENT_FLOOR_S = 60


def _num(value) -> float | None:
    try:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _bounds(config: dict | None) -> tuple[float | None, float | None]:
    cfg = config or {}
    return _num(cfg.get("alarm_min")), _num(cfg.get("alarm_max"))


def _silent_after_s(config: dict | None) -> int:
    """No data for longer than this ⇒ the sensor is considered silent.
    Ring-mode tags (store_enabled off) live at ~1 s resolution, so the 60 s
    floor is their whole window; interval tags get 3× their interval."""
    cfg = config or {}
    if not cfg.get("store_enabled"):
        return SILENT_FLOOR_S
    try:
        interval = int(cfg.get("storage_interval_s"))
    except (TypeError, ValueError):
        interval = 60
    return max(SILENT_FACTOR * interval, SILENT_FLOOR_S)


def _wants_silent(tag: ScadaTag) -> bool:
    """Silence detection is AUTOMATIC for every MQTT tag (user decision:
    "bisu dibuat otomatis nyala aja") — no per-tag checkbox. Safety stays:
    a tag that has NEVER produced data can't fire (see evaluate_once)."""
    return tag.source == "mqtt"


async def _open_event(
    db: AsyncSession,
    tag: ScadaTag,
    kind: str,
    trigger_value: float | None,
    threshold: float | None,
) -> None:
    """Open an alarm event if none is open for (tag, kind); notify if we won."""
    now = datetime.now(timezone.utc)
    stmt = (
        pg_insert(ScadaAlarmEvent)
        .values(
            tag_id=tag.id,
            kind=kind,
            triggered_at=now,
            trigger_value=trigger_value,
            threshold=threshold,
        )
        .on_conflict_do_nothing(
            index_elements=["tag_id", "kind"],
            index_where=ScadaAlarmEvent.cleared_at.is_(None),
        )
        .returning(ScadaAlarmEvent.id)
    )
    result = await db.execute(stmt)
    event_id = result.scalar_one_or_none()
    await db.commit()
    if event_id is None:
        return  # already open (or another engine won the race)
    logger.warning(
        "Alarm OPEN %s/%s value=%s threshold=%s", tag.label, kind, trigger_value, threshold
    )
    event = await db.get(ScadaAlarmEvent, event_id)
    if event is not None:
        await notifier.notify_alarm(db, event, tag, "triggered")


async def _clear_event(
    db: AsyncSession, tag: ScadaTag, event: ScadaAlarmEvent
) -> None:
    """Clear an open event; the single UPDATE winner sends the notification."""
    result = await db.execute(
        update(ScadaAlarmEvent)
        .where(
            ScadaAlarmEvent.id == event.id,
            ScadaAlarmEvent.cleared_at.is_(None),
        )
        .values(cleared_at=datetime.now(timezone.utc))
        .returning(ScadaAlarmEvent.id)
    )
    won = result.scalar_one_or_none() is not None
    await db.commit()
    if not won:
        return
    logger.info("Alarm CLEAR %s/%s", tag.label, event.kind)
    await notifier.notify_alarm(db, event, tag, "cleared")


async def _last_seen(
    db: AsyncSession, tag: ScadaTag, latest: ScadaTagLatest | None
) -> datetime | None:
    """When did this tag last produce data? Falls back to scada_samples for
    deployments where the bridge doesn't write scada_tag_latest yet."""
    if latest is not None:
        return latest.ts
    result = await db.execute(
        select(ScadaSample.ts)
        .where(ScadaSample.tag_id == tag.id)
        .order_by(ScadaSample.ts.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def evaluate_once(db: AsyncSession) -> None:
    """One evaluation pass over every enabled tag."""
    now = datetime.now(timezone.utc)

    tags = (
        (await db.execute(select(ScadaTag).where(ScadaTag.enabled.is_(True))))
        .scalars()
        .all()
    )
    latest_by_tag = {
        row.tag_id: row
        for row in (await db.execute(select(ScadaTagLatest))).scalars().all()
    }
    open_events: dict[tuple, ScadaAlarmEvent] = {
        (e.tag_id, e.kind): e
        for e in (
            await db.execute(
                select(ScadaAlarmEvent).where(ScadaAlarmEvent.cleared_at.is_(None))
            )
        )
        .scalars()
        .all()
    }

    for tag in tags:
        try:
            alarm_min, alarm_max = _bounds(tag.config)
            latest = latest_by_tag.get(tag.id)

            # --- value alarms (need a last-known value) ------------------- #
            if latest is not None:
                value = latest.value
                if alarm_max is not None:
                    is_high = value > alarm_max
                    open_high = open_events.get((tag.id, "high"))
                    if is_high and open_high is None:
                        await _open_event(db, tag, "high", value, alarm_max)
                    elif not is_high and open_high is not None:
                        await _clear_event(db, tag, open_high)
                if alarm_min is not None:
                    is_low = value < alarm_min
                    open_low = open_events.get((tag.id, "low"))
                    if is_low and open_low is None:
                        await _open_event(db, tag, "low", value, alarm_min)
                    elif not is_low and open_low is not None:
                        await _clear_event(db, tag, open_low)

            # --- silence alarm -------------------------------------------- #
            if _wants_silent(tag):
                last_seen = await _last_seen(db, tag, latest)
                cutoff = now - timedelta(seconds=_silent_after_s(tag.config))
                is_silent = last_seen is not None and last_seen < cutoff
                open_silent = open_events.get((tag.id, "silent"))
                if is_silent and open_silent is None:
                    await _open_event(db, tag, "silent", None, None)
                elif not is_silent and last_seen is not None and open_silent is not None:
                    await _clear_event(db, tag, open_silent)
        except Exception:
            logger.exception("Alarm evaluation failed for tag %s", tag.id)

    # Orphan cleanup: open events whose tag was disabled/unset lose their
    # trigger condition silently — close them so the active list stays honest.
    active_tag_ids = {t.id for t in tags}
    for (tag_id, _kind), event in open_events.items():
        if tag_id not in active_tag_ids:
            await db.execute(
                update(ScadaAlarmEvent)
                .where(
                    ScadaAlarmEvent.id == event.id,
                    ScadaAlarmEvent.cleared_at.is_(None),
                )
                .values(cleared_at=now)
            )
    await db.commit()


async def alarm_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged loudly instead."""
    from db.session import async_session_factory

    logger.info("Alarm engine active — every %ds, silent factor %dx", INTERVAL_S, SILENT_FACTOR)
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            async with async_session_factory() as db:
                await evaluate_once(db)
        except Exception:
            logger.exception("Alarm engine iteration failed")
