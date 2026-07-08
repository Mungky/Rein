"""R-Net data historian — sampler loop + deterministic simulator.

A "tag" is one measured quantity (scada_tags); every HISTORIAN_INTERVAL_S the
sampler writes one row per enabled tag into scada_samples. Timestamps are
aligned to the minute and inserts use ON CONFLICT DO NOTHING, so local dev and
Railway sampling the same shared DB stay idempotent.

Simulator values are a pure function of (tag id, time): base + two sine waves
+ hash-seeded noise. Because value = f(t), history can be backfilled instantly
when a tag is created — no need to run for days before charts look real.

REAL DATA — source "mqtt": V-Boxes publish sensor values to an MQTT broker.
A standalone bridge (deploy/scada/mqtt-bridge/bridge.py) subscribes, caches the
latest value per topic, and writes one minute-aligned row per tag into the SAME
scada_samples table. This in-process sampler therefore SKIPS source "mqtt" tags
(see sample_once) so the two writers never collide.
"""

import asyncio
import logging
import math
import os
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.scada import ScadaSample, ScadaTag

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("HISTORIAN_INTERVAL_S", "60"))
RETENTION_DAYS = int(os.getenv("HISTORIAN_RETENTION_DAYS", "90"))
ENABLED = os.getenv("HISTORIAN_ENABLED", "1") not in ("0", "false", "False")

BACKFILL_DAYS = 7  # history seeded automatically when a simulator tag is created
_BATCH = 5000  # rows per INSERT during backfill

# Fallbacks when a tag's config JSONB omits waveform fields. Keys mirror the
# preset dropdown in frontend manage-tags-dialog.
DEFAULT_WAVE = {"base": 50.0, "amplitude": 10.0, "period_s": 86400, "noise": 1.0, "decimals": 1}


def sim_value(tag: ScadaTag, at: datetime) -> float:
    """Deterministic simulator: same (tag, minute) always yields the same value."""
    cfg = tag.config or {}
    base = float(cfg.get("base", DEFAULT_WAVE["base"]))
    amplitude = float(cfg.get("amplitude", DEFAULT_WAVE["amplitude"]))
    period_s = max(60, int(cfg.get("period_s", DEFAULT_WAVE["period_s"])))
    noise = float(cfg.get("noise", DEFAULT_WAVE["noise"]))
    decimals = int(cfg.get("decimals", DEFAULT_WAVE["decimals"]))

    seed = tag.id.int & 0xFFFFFFFF
    t = at.timestamp()
    phase = (seed % 6283) / 1000.0  # 0..2π, stable per tag

    value = base
    value += amplitude * math.sin(2 * math.pi * t / period_s + phase)
    # Slower secondary drift so lines don't look like textbook sines
    value += (amplitude / 3.0) * math.sin(2 * math.pi * t / (period_s * 3.7) + phase * 2)
    # Reproducible noise: seeded by (tag, minute), not global RNG state
    minute_idx = int(t // 60)
    value += random.Random(f"{seed}:{minute_idx}").uniform(-noise, noise)

    if "min" in cfg:
        value = max(float(cfg["min"]), value)
    if "max" in cfg:
        value = min(float(cfg["max"]), value)
    return round(value, decimals)


def _aligned_minute(at: datetime | None = None) -> datetime:
    at = at or datetime.now(timezone.utc)
    return at.replace(second=0, microsecond=0)


def _compute_value(tag: ScadaTag, at: datetime) -> float:
    if tag.source == "simulator":
        return sim_value(tag, at)
    # V-Net adapter seam — see module docstring for the 3 open Wecon questions.
    raise NotImplementedError(f"historian source '{tag.source}' not implemented yet")


async def sample_once(db: AsyncSession) -> int:
    """Write one sample per enabled *in-process* tag at the current aligned
    minute. Source "mqtt" tags are skipped here — the standalone bridge
    (deploy/scada/mqtt-bridge/bridge.py) writes those from broker messages."""
    ts = _aligned_minute()
    result = await db.execute(
        select(ScadaTag).where(
            ScadaTag.enabled.is_(True), ScadaTag.source != "mqtt"
        )
    )
    rows = []
    for tag in result.scalars().all():
        try:
            rows.append({"tag_id": tag.id, "ts": ts, "value": _compute_value(tag, ts)})
        except NotImplementedError:
            logger.warning("Tag %s skipped: source '%s' has no adapter yet", tag.id, tag.source)
        except Exception:
            logger.exception("Tag %s: value computation failed", tag.id)
    if rows:
        await db.execute(pg_insert(ScadaSample).values(rows).on_conflict_do_nothing())
        await db.commit()
    return len(rows)


async def backfill(db: AsyncSession, tag: ScadaTag, days: int = BACKFILL_DAYS) -> int:
    """Seed one-minute history for a simulator tag (instant demo-ready charts)."""
    if tag.source != "simulator":
        return 0
    end = _aligned_minute()
    ts = end - timedelta(days=days)
    total = 0
    batch: list[dict] = []
    while ts < end:
        batch.append({"tag_id": tag.id, "ts": ts, "value": sim_value(tag, ts)})
        if len(batch) >= _BATCH:
            await db.execute(pg_insert(ScadaSample).values(batch).on_conflict_do_nothing())
            total += len(batch)
            batch = []
        ts += timedelta(minutes=1)
    if batch:
        await db.execute(pg_insert(ScadaSample).values(batch).on_conflict_do_nothing())
        total += len(batch)
    await db.commit()
    return total


async def _purge_old_samples(db: AsyncSession) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    result = await db.execute(delete(ScadaSample).where(ScadaSample.ts < cutoff))
    await db.commit()
    if result.rowcount:
        logger.info("Historian retention: purged %d samples older than %dd", result.rowcount, RETENTION_DAYS)


async def historian_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged loudly instead."""
    from db.session import async_session_factory

    last_purge_day: int | None = None
    logger.info("Historian sampler active — every %ds, retention %dd", INTERVAL_S, RETENTION_DAYS)
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            async with async_session_factory() as db:
                await sample_once(db)
                today = datetime.now(timezone.utc).toordinal()
                if last_purge_day != today:
                    await _purge_old_samples(db)
                    last_purge_day = today
        except Exception:
            logger.exception("Historian sampling iteration failed")
