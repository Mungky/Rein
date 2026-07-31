"""R-Net server-side alarm engine — detects breaches with nobody watching.

Every ALARM_INTERVAL_S the engine reads scada_tag_latest (one cheap SELECT for
all tags) and evaluates these conditions per enabled tag:

  high       latest.value > config.alarm_max
  low        latest.value < config.alarm_min
  warn_high  latest.value > config.warn_max, and not already high/low
  warn_low   latest.value < config.warn_min, and not already high/low
  silent     automatic for every MQTT tag: no data for > max(3 × interval, 60 s)

The warn_* pair is the WASPADA band. It exists because the Data tab has always
painted rows amber from warn_min/warn_max while the engine only knew about
alarm_min/alarm_max — so the two screens disagreed about the same sensor, and
nothing amber ever reached Monitor, the bell, or email.

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

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import notifier, rnet_settings
from db.models.scada import (
    ScadaAlarmEvent,
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


def _warn_bounds(config: dict | None) -> tuple[float | None, float | None]:
    """The WASPADA band — the early-warning pair, one step inside the alarm pair.

    These have always existed and the Data tab has always painted rows amber
    from them (frontend readTagThresholds/tagStatusOf). The engine, however,
    only ever looked at alarm_min/alarm_max — so a sensor sitting in its warn
    band showed amber in the Data tab and "Normal" on Monitor at the same time,
    with nothing in the bell and nothing emailed. Two screens disagreeing about
    the same sensor is worse than either answer alone: it teaches the operator
    that neither can be trusted."""
    cfg = config or {}
    return _num(cfg.get("warn_min")), _num(cfg.get("warn_max"))


def _silent_after_s(settings, config: dict | None) -> int:
    """No data for longer than this ⇒ the sensor is considered silent.

    Always 3× the tag's own sampling interval, with a 60 s floor.

    This used to branch on store_enabled: ring tags got the flat 60 s floor on
    the reasoning that they "sample fast". That reasoning only held while ring
    meant fastest/fast — nothing enforced it, and once the store lane was
    retired EVERY tag took that branch. A slowest tag reports once every 60 s,
    so a 60 s window makes it silent between every pair of readings: the engine
    would open a `silent` event, the next reading would clear it, forever. At
    300 sensors that is a steady drip of false alarms; at 15 000 it is a storm
    that buries the real ones.

    Deriving the window from the interval is also just correct — the question
    "has this sensor gone quiet?" only means anything relative to how often it
    is supposed to speak."""
    interval = rnet_settings.resolve_interval(settings, config or {}, floor_s=1)
    return max(SILENT_FACTOR * interval, SILENT_FLOOR_S)


def value_conditions(
    value: float, config: dict | None
) -> list[tuple[str, bool, float | None]]:
    """Which value-alarm kinds should be OPEN for this reading?

    Returns (kind, should_be_open, threshold) for every kind this engine can
    open from a value — always all four, so the caller clears the ones that no
    longer apply instead of only touching the ones that do.

    ONE SEVERITY AT A TIME. A value past alarm_max is also past warn_max, but
    opening both would put the same sensor on the wall twice, once red and once
    amber. The Data tab has always resolved this the same way (tagStatusOf:
    kritis wins over waspada), so the engine matches it rather than inventing a
    second rule for the same question.

    Pure on purpose: this is the whole decision, and it is the part worth
    pinning down in tests without a database."""
    alarm_min, alarm_max = _bounds(config)
    warn_min, warn_max = _warn_bounds(config)
    is_high = alarm_max is not None and value > alarm_max
    is_low = alarm_min is not None and value < alarm_min
    in_alarm = is_high or is_low
    return [
        ("high", is_high, alarm_max),
        ("low", is_low, alarm_min),
        ("warn_high", not in_alarm and warn_max is not None and value > warn_max, warn_max),
        ("warn_low", not in_alarm and warn_min is not None and value < warn_min, warn_min),
    ]


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


# Audit D-12, brought forward from phase 7 after the 300-tag benchmark.
#
# THE COST WAS ROUND-TRIPS, NOT THE QUERY. The per-tag lookup below is already
# the optimal shape (index scan, one row, ~0.03 ms). The problem was issuing it
# ONCE PER TAG, every 5 seconds: 300 tags × one network round-trip each against
# Supabase is seconds of latency inside a 5-second cycle, so the engine could
# fall behind and alarms would fire late.
#
# One LATERAL join gives the same answer in ONE round-trip while keeping the
# same fast per-tag plan. The naive batched alternative — DISTINCT ON (tag_id)
# ORDER BY tag_id, ts DESC — measured 942× SLOWER at this scale: Postgres cannot
# optimise that shape and scans + sorts millions of index entries to return a
# handful of rows. Do not "simplify" this back into DISTINCT ON.
_LAST_SEEN_SQL = text(
    """
    SELECT x.tag_id, l.ts
      FROM unnest(CAST(:ids AS uuid[])) AS x(tag_id)
      CROSS JOIN LATERAL (
            SELECT s.ts FROM scada_samples_all s
             WHERE s.tag_id = x.tag_id
             ORDER BY s.ts DESC
             LIMIT 1
      ) AS l
    """
)


async def _last_seen_batch(
    db: AsyncSession, tag_ids: list
) -> dict:
    """When did each of these tags last produce data? One query for all of them.

    Only called for tags with no scada_tag_latest row — deployments where the
    bridge predates that table, or tags that have never reported. CROSS JOIN
    LATERAL naturally omits tags with no data at all, so a missing key means
    "never seen", which is exactly what the caller needs."""
    if not tag_ids:
        return {}
    rows = await db.execute(_LAST_SEEN_SQL, {"ids": [str(t) for t in tag_ids]})
    return {row.tag_id: row.ts for row in rows.all()}


async def evaluate_once(db: AsyncSession) -> None:
    """One evaluation pass over every enabled tag."""
    now = datetime.now(timezone.utc)
    settings = await rnet_settings.get_settings(db)

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

    # Resolve every "when was this tag last seen?" up front, in one query, for
    # exactly the tags that need it (silence-alarm tags with no live row).
    # See _last_seen_batch — this replaced one query per tag per cycle (D-12).
    fallback_last_seen = await _last_seen_batch(
        db,
        [t.id for t in tags if _wants_silent(t) and t.id not in latest_by_tag],
    )

    for tag in tags:
        try:
            latest = latest_by_tag.get(tag.id)

            # --- value alarms (need a last-known value) ------------------- #
            if latest is not None:
                # Note the clear path is NOT gated on the bound still being set.
                # It used to be (`if alarm_max is not None:` wrapped both the
                # open and the clear), so deleting a threshold while its event
                # was open stranded that event open forever — the sensor stayed
                # red on Monitor with no threshold left to explain why, and only
                # disabling the tag could ever clear it.
                for kind, breached, threshold in value_conditions(
                    latest.value, tag.config
                ):
                    open_event = open_events.get((tag.id, kind))
                    if breached and open_event is None:
                        await _open_event(db, tag, kind, latest.value, threshold)
                    elif not breached and open_event is not None:
                        await _clear_event(db, tag, open_event)

            # --- silence alarm -------------------------------------------- #
            if _wants_silent(tag):
                last_seen = (
                    latest.ts if latest is not None
                    else fallback_last_seen.get(tag.id)
                )
                cutoff = now - timedelta(seconds=_silent_after_s(settings, tag.config))
                is_silent = last_seen is not None and last_seen < cutoff
                open_silent = open_events.get((tag.id, "silent"))
                if is_silent and open_silent is None:
                    await _open_event(db, tag, "silent", None, None)
                elif not is_silent and last_seen is not None and open_silent is not None:
                    await _clear_event(db, tag, open_silent)

            # --- reset-reminder alarm: RETIRED with the store lane -------- #
            # It warned that a sensor's 1-month cycle was about to be archived
            # and wiped from 0. Nothing gets wiped any more: raw ages out by the
            # day, the per-minute summary is archived per plant per month, and
            # no sensor has a cycle clock. A warning about an event that cannot
            # happen is worse than no warning. Any event still open from before
            # the retirement is closed here, once, rather than left hanging in
            # the active list forever.
            open_expiring = open_events.get((tag.id, "expiring"))
            if open_expiring is not None:
                await _clear_event(db, tag, open_expiring)
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
