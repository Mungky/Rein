"""Shared R-Net storage helpers — sampling-level resolution + cycle clock.

One place for the logic every backend R-Net component needs after the storage
redesign (historian sampler, alarm engine, archiver, tag router):
  - resolve a tag's `config.sampling_level` → seconds via the admin-tunable
    scada_settings row,
  - tell ring (store off) from historian (store on) tags,
  - read/stamp the per-tag `config.store_cycle_start` (ISO 8601 'Z') that the
    1-month reset clock runs on.

The standalone MQTT bridge (deploy/data/bridge.py) is a separate process and
keeps its OWN copy of this logic — keep the two in sync.
"""

import calendar
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.scada import ScadaSettings

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


def is_ring(config: dict | None) -> bool:
    """Ring mode = "Simpan data" NOT ticked (short 24h buffer, not historian)."""
    return not (config or {}).get("store_enabled")


def now_iso() -> str:
    """Canonical UTC ISO 8601 with 'Z', the format store_cycle_start is stored in."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_cycle_start(config: dict | None) -> datetime | None:
    """Parse config.store_cycle_start → aware UTC datetime, or None if unset/bad."""
    raw = (config or {}).get("store_cycle_start")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def add_months(dt: datetime, months: int) -> datetime:
    """Calendar-correct month addition (no dateutil dependency)."""
    m = dt.month - 1 + months
    year = dt.year + m // 12
    month = m % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def cycle_reset_at(settings: ScadaSettings, cycle_start: datetime) -> datetime:
    """When a historian tag's current cycle is due for archive + reset.
    Shared by the alarm engine (reminder) and archiver (the actual reset) so the
    two never disagree on the boundary."""
    return add_months(cycle_start, settings.store_months)
