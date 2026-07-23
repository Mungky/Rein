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

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import rnet_settings
from db.models.scada import ScadaRing, ScadaSample, ScadaTag, ScadaTagLatest

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("HISTORIAN_INTERVAL_S", "60"))
# Simulator (fake demo data + 7-day backfill) is OFF by default: the Node-RED
# fake-factory flow is the official test rig now, and auto-generated values on
# fresh tags proved misleading ("kok ada nilainya padahal belum disambung?").
# Set HISTORIAN_SIMULATOR=1 only for demos without any broker at all.
SIM_ENABLED = os.getenv("HISTORIAN_SIMULATOR", "0") not in ("0", "false", "False")
# Live lane: how often simulator tags refresh scada_tag_latest (mqtt tags are
# refreshed by the standalone bridge instead).
LATEST_INTERVAL_S = int(os.getenv("HISTORIAN_LATEST_INTERVAL_S", "5"))
ENABLED = os.getenv("HISTORIAN_ENABLED", "1") not in ("0", "false", "False")

# Retention/purge moved to app/services/archiver.py: rows older than the
# 90-day window are deleted ONLY after their month is archived to Google
# Drive — the historian itself never deletes data anymore. Ring-mode tags
# are pruned to their last 100 rows by the bridge instead.

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
    """Write one sample per enabled *in-process* tag whose storage interval
    lands on the current aligned minute. Ring tags (store off) go to scada_ring,
    historian tags (store on) to scada_samples. Source "mqtt" tags are skipped
    here — the standalone bridge writes those from broker messages.

    In-process cadence is 60 s, so intervals are floored to 60 s (sub-minute is
    an MQTT-bridge-only feature)."""
    if not SIM_ENABLED:
        return 0
    settings = await rnet_settings.get_settings(db)
    ts = _aligned_minute()
    epoch = int(ts.timestamp())
    result = await db.execute(
        select(ScadaTag).where(
            ScadaTag.enabled.is_(True), ScadaTag.source != "mqtt"
        )
    )
    ring_rows: list[dict] = []
    hist_rows: list[dict] = []
    for tag in result.scalars().all():
        interval = rnet_settings.resolve_interval(settings, tag.config, floor_s=60)
        if epoch % interval != 0:
            continue  # not this tag's minute (e.g. interval 300 → every 5th)
        try:
            row = {"tag_id": tag.id, "ts": ts, "value": _compute_value(tag, ts)}
        except NotImplementedError:
            logger.warning("Tag %s skipped: source '%s' has no adapter yet", tag.id, tag.source)
            continue
        except Exception:
            logger.exception("Tag %s: value computation failed", tag.id)
            continue
        (ring_rows if rnet_settings.is_ring(tag.config) else hist_rows).append(row)
    if ring_rows:
        await db.execute(pg_insert(ScadaRing).values(ring_rows).on_conflict_do_nothing())
    if hist_rows:
        await db.execute(pg_insert(ScadaSample).values(hist_rows).on_conflict_do_nothing())
    if ring_rows or hist_rows:
        await db.commit()
    return len(ring_rows) + len(hist_rows)


async def latest_once(db: AsyncSession) -> int:
    """Live lane for in-process tags: UPSERT the current simulator value into
    scada_tag_latest (no history rows). MQTT tags are refreshed by the bridge."""
    if not SIM_ENABLED:
        return 0
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ScadaTag).where(
            ScadaTag.enabled.is_(True), ScadaTag.source != "mqtt"
        )
    )
    rows = []
    for tag in result.scalars().all():
        try:
            rows.append({"tag_id": tag.id, "ts": now, "value": _compute_value(tag, now)})
        except NotImplementedError:
            pass  # sample_once already warns about missing adapters
        except Exception:
            logger.exception("Tag %s: live value computation failed", tag.id)
    if rows:
        stmt = pg_insert(ScadaTagLatest).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[ScadaTagLatest.tag_id],
            set_={
                "ts": stmt.excluded.ts,
                "value": stmt.excluded.value,
                "updated_at": func.now(),
            },
        )
        await db.execute(stmt)
        await db.commit()
    return len(rows)


async def backfill(db: AsyncSession, tag: ScadaTag, days: int = BACKFILL_DAYS) -> int:
    """Seed one-minute history for a simulator tag (instant demo-ready charts).
    No-op unless HISTORIAN_SIMULATOR is on — fresh tags must start EMPTY."""
    if not SIM_ENABLED or tag.source != "simulator":
        return 0
    # Ring tags keep only a 24h window, so seeding 7 days there is pointless —
    # backfill only makes sense for historian (store on) tags.
    if rnet_settings.is_ring(tag.config):
        return 0
    model = ScadaSample
    end = _aligned_minute()
    ts = end - timedelta(days=days)
    total = 0
    batch: list[dict] = []
    while ts < end:
        batch.append({"tag_id": tag.id, "ts": ts, "value": sim_value(tag, ts)})
        if len(batch) >= _BATCH:
            await db.execute(pg_insert(model).values(batch).on_conflict_do_nothing())
            total += len(batch)
            batch = []
        ts += timedelta(minutes=1)
    if batch:
        await db.execute(pg_insert(model).values(batch).on_conflict_do_nothing())
        total += len(batch)
    await db.commit()
    return total


async def historian_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged loudly instead."""
    from db.session import async_session_factory

    logger.info("Historian sampler active — every %ds", INTERVAL_S)
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            async with async_session_factory() as db:
                await sample_once(db)
        except Exception:
            logger.exception("Historian sampling iteration failed")


async def latest_loop() -> None:
    """Live-lane companion to historian_loop (also started from lifespan):
    refreshes scada_tag_latest for simulator tags every LATEST_INTERVAL_S so
    live numbers + the alarm engine work without any MQTT hardware."""
    from db.session import async_session_factory

    logger.info("Historian live lane active — every %ds", LATEST_INTERVAL_S)
    while True:
        await asyncio.sleep(LATEST_INTERVAL_S)
        try:
            async with async_session_factory() as db:
                await latest_once(db)
        except Exception:
            logger.exception("Historian live-lane iteration failed")
