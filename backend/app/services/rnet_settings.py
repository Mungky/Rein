"""Shared R-Net storage helpers — sampling-level resolution.

One place for the logic every backend R-Net component needs (historian sampler,
alarm engine, tag router): resolve a tag's `config.sampling_level` → seconds via
the admin-tunable scada_settings row.

WHAT LEFT THIS FILE
    `is_ring`, `now_iso`, `parse_cycle_start`, `add_months` and `cycle_reset_at`
    all existed to serve ONE thing: the per-tag "Simpan data" cycle clock that
    drove the monthly archive-and-wipe of `scada_samples`. That lane is retired
    (docs/ARSITEKTUR-DATA.md §2.3) — every sensor now takes one path, so there
    is no second mode to tell apart and no clock to read. Keeping the helpers
    "just in case" would have left five functions whose only remaining purpose
    was to make a removed feature look like it still existed.

The standalone MQTT bridge (deploy/data/bridge.py) is a separate process and
keeps its OWN copy of the level→seconds logic — keep the two in sync.
"""

import logging
from datetime import timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.scada import ScadaSettings

logger = logging.getLogger(__name__)

# Fallback level when a tag has none (matches the bridge default).
DEFAULT_LEVEL = "fast"


async def get_settings(db: AsyncSession) -> ScadaSettings:
    """Fetch the single settings row (id=1), creating defaults if missing."""
    row = await db.get(ScadaSettings, 1)
    if row is None:
        await db.execute(
            pg_insert(ScadaSettings).values(id=1).on_conflict_do_nothing()
        )
        await db.commit()
        row = await db.get(ScadaSettings, 1)
    return row


def level_seconds(settings: ScadaSettings, level: str | None) -> int:
    """Map a sampling-level name → seconds using the admin-tunable durations."""
    return {
        "fastest": settings.level_fastest_s,
        "fast": settings.level_fast_s,
        "slow": settings.level_slow_s,
        "slowest": settings.level_slowest_s,
    }.get(level or DEFAULT_LEVEL, settings.level_fast_s)


def resolve_interval(settings: ScadaSettings, config: dict | None, floor_s: int = 1) -> int:
    """A tag's storage interval in seconds, floored (in-process simulator uses
    floor 60; the bridge uses the fastest level)."""
    cfg = config or {}
    return max(floor_s, level_seconds(settings, cfg.get("sampling_level")))


def display_tz(settings: ScadaSettings) -> ZoneInfo | timezone:
    """The zone used to LABEL timestamps for humans — never to store them.

    Falls back to UTC and logs instead of raising. A zone name is validated at
    the API when it is saved, so reaching the fallback means something already
    went wrong (a hand-edited row, a restored backup, a container missing
    tzdata) — and at that point failing every export and every monthly archive
    is a far worse outcome than labelling them UTC for an afternoon.
    """
    name = (getattr(settings, "display_timezone", None) or "").strip()
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.error(
            "Zona waktu tampilan '%s' tidak dikenal — memakai UTC. Perbaiki di "
            "Panel Administrasi → R-Net, atau pastikan paket `tzdata` terpasang.",
            name,
        )
        return timezone.utc


def tz_column_label(tz) -> str:
    """CSV header for the timestamp column, e.g. "waktu_wib".

    Derived from the zone's own abbreviation rather than hardcoded, so the
    header stops saying WIB the moment somebody changes the setting — a column
    labelled with the wrong zone is worse than one labelled generically.

    Zones without a letter abbreviation report a numeric offset ("+07"), which
    reads badly in a column name; those get "waktu_lokal".
    """
    from datetime import datetime

    abbr = datetime.now(tz).strftime("%Z")
    return f"waktu_{abbr.lower()}" if abbr.isalpha() else "waktu_lokal"
