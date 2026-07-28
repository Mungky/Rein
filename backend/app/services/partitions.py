"""Partition housekeeping — create drawers ahead, drop drawers behind.

Replaces ring_pruner.py (phase 2). That module deleted expired rows in batches;
this one drops whole partitions, which is what the partitioning in migration
k1l2m3n4o5p6 was for. Measured at pilot scale (300 tags, 3 283 200 rows/day):

    DELETE the day's rows   2 632 ms   and 3 283 200 dead tuples for autovacuum
    DROP the day's drawer     109 ms   and zero

TWO JOBS, AND THE FIRST IS THE DANGEROUS ONE

    Creating ahead matters more than dropping behind. A row whose day has no
    partition is REJECTED by Postgres — the bridge's insert fails and that
    reading is gone. So partitions are created RAW_AHEAD_DAYS ahead and the
    check runs hourly, meaning the backend must be down for a full week before
    a gap can open. A deliberately missing safety net: there is no DEFAULT
    partition, because a default silently swallows rows and then blocks
    creating the real partition for that day later.

    Dropping behind is the safe half, and is guarded three ways:
      1. never drop a partition whose range has not FULLY aged out,
      2. never leave fewer than MIN_KEEP partitions, whatever the arithmetic
         says — a clock or timezone bug must not be able to empty the table,
      3. for the summary, don't drop at all unless explicitly configured.

THE SUMMARY IS GUARDED BY AN ARCHIVE, NOT BY A NUMBER
    A month of scada_rollup_1m is the ONLY copy of that period once the raw
    day-drawers are gone. It used to be protected by refusing to drop anything
    at all (ROLLUP_KEEP_MONTHS = 0), because the archiver that would make it
    safe did not exist for this lane — so in practice the summary had no
    retention and grew without bound.

    app/services/rollup_archiver.py is that archiver. The knob is now 1 (a month
    is dropped once it is a full month behind, i.e. 30-61 days of summary), but
    the number is NOT what makes it safe: every candidate month is checked
    against the archive ledger first, and a month with any plant not yet
    verifiably on Drive is left alone no matter how old it is. Raising the knob
    keeps data longer; it cannot be lowered into deleting an unarchived month.

RETENTION IS NOW APPROXIMATE, ON PURPOSE
    A day can only be dropped once all of it has expired, so a row lives
    24-48 h rather than exactly 24 h (and a summary row 30-60 days). Agreed
    trade-off: `ring_window_h` now means "at least this long".
"""

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.services import rnet_settings

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("PARTITION_INTERVAL_S", "3600"))
ENABLED = os.getenv("PARTITION_MANAGER_ENABLED", "1") not in ("0", "false", "False")

# Days of empty drawers kept ready in front of "now". This is the entire
# protection against a missing partition at midnight — see module docstring.
RAW_AHEAD_DAYS = int(os.getenv("RAW_AHEAD_DAYS", "7"))
# Refuse to go below this many raw partitions no matter what the clock says.
MIN_KEEP_RAW = 2
# Warn loudly before the runway actually runs out.
AHEAD_WARN_DAYS = 2

# How many whole months of summary stay in the database. 1 = "the current month
# plus all of the previous one", so a summary row lives 30-61 days — the
# "1 menit selama 30 hari" the design promises, with the same
# expires-at-a-boundary slack the raw lane has. 0 disables dropping entirely
# (and with it the archiving, which then has nothing to make safe).
#
# This is a comfort knob, not the safety mechanism. The safety mechanism is
# drop_expired_rollup refusing any month that is not fully archived.
ROLLUP_KEEP_MONTHS = int(os.getenv("ROLLUP_KEEP_MONTHS", "1"))
MIN_KEEP_ROLLUP = 2

_RAW_RE = re.compile(r"^scada_raw_(\d{4})_(\d{2})_(\d{2})$")
_ROLLUP_RE = re.compile(r"^scada_rollup_1m_(\d{4})_(\d{2})$")


def _day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _month(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month(dt: datetime) -> datetime:
    return (
        dt.replace(year=dt.year + 1, month=1)
        if dt.month == 12
        else dt.replace(month=dt.month + 1)
    )


async def _partitions(db, pattern: str) -> list[str]:
    rows = await db.execute(
        text(
            "SELECT c.relname FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' "
            "  AND c.relname LIKE :pat ORDER BY c.relname"
        ),
        {"pat": pattern},
    )
    return [r[0] for r in rows.all()]


async def ensure_raw_partitions(db, now: datetime) -> int:
    """Create today's drawer plus RAW_AHEAD_DAYS of empty ones. Returns how
    many were newly created."""
    created = 0
    existing = set(await _partitions(db, "scada_raw\\_%"))
    for offset in range(0, RAW_AHEAD_DAYS + 1):
        day = _day(now) + timedelta(days=offset)
        name = f"scada_raw_{day:%Y_%m_%d}"
        if name in existing:
            continue
        nxt = day + timedelta(days=1)
        # Bounds are formatted, not bound: PARTITION OF ... FOR VALUES takes no
        # parameters. Values come from datetime formatting, never user input.
        await db.execute(
            text(
                f"CREATE TABLE IF NOT EXISTS public.{name} "
                f"PARTITION OF public.scada_raw "
                f"FOR VALUES FROM ('{day:%Y-%m-%d} 00:00:00+00') "
                f"TO ('{nxt:%Y-%m-%d} 00:00:00+00')"
            )
        )
        created += 1
    return created


async def ensure_rollup_partitions(db, now: datetime) -> int:
    """This month and next for the summary table."""
    created = 0
    existing = set(await _partitions(db, "scada\\_rollup\\_1m\\_%"))
    month = _month(now)
    for _ in range(2):
        name = f"scada_rollup_1m_{month:%Y_%m}"
        if name not in existing:
            nxt = _next_month(month)
            await db.execute(
                text(
                    f"CREATE TABLE IF NOT EXISTS public.{name} "
                    f"PARTITION OF public.scada_rollup_1m "
                    f"FOR VALUES FROM ('{month:%Y-%m-%d} 00:00:00+00') "
                    f"TO ('{nxt:%Y-%m-%d} 00:00:00+00')"
                )
            )
            created += 1
        month = _next_month(month)
    return created


async def drop_expired_raw(db, now: datetime, window_h: int) -> list[str]:
    """Drop day drawers entirely older than the retention window.

    A drawer covering [day, day+1) is only expired once day+1 <= cutoff — i.e.
    once its NEWEST possible row has aged out. That is what makes retention
    24-48 h rather than exactly 24 h."""
    cutoff = now - timedelta(hours=window_h)
    names = sorted(n for n in await _partitions(db, "scada_raw\\_%") if _RAW_RE.match(n))

    # Guard 2, independent of the date arithmetic above: the newest few drawers
    # are never droppable, whatever the dates claim. Names sort chronologically
    # (YYYY_MM_DD), so this is simply the tail. Without it, a clock jump or a
    # timezone mistake could make EVERY partition look expired and empty the
    # table in one pass — the one failure this module must not have.
    protected = set(names[-MIN_KEEP_RAW:])

    dropped: list[str] = []
    for name in names:
        if name in protected:
            continue
        m = _RAW_RE.match(name)
        day = datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc)
        if day + timedelta(days=1) > cutoff:
            continue  # still holds rows inside the window
        await db.execute(text(f"ALTER TABLE public.scada_raw DETACH PARTITION public.{name}"))
        await db.execute(text(f"DROP TABLE public.{name}"))
        dropped.append(name)
    return dropped


async def _is_empty(db, name: str) -> bool:
    """True if a partition holds no rows at all.

    Needed because the archive gate below is keyed on ledger rows, and a month
    that was created ahead and never written to has none — without this it would
    be un-droppable forever and empty drawers would pile up. LIMIT 1 stops at
    the first row, so this costs nothing on a month that is full."""
    row = await db.execute(text(f"SELECT 1 FROM public.{name} LIMIT 1"))
    return row.first() is None


async def drop_expired_rollup(db, now: datetime) -> list[str]:
    """Drop summary months older than ROLLUP_KEEP_MONTHS **that are on Drive**.

    Three independent things must all agree before a month is deleted:

      1. it is entirely older than the retention window (the arithmetic below),
      2. it is not one of the newest MIN_KEEP_ROLLUP months (the floor guard —
         a clock jump must not be able to empty the table),
      3. every plant's copy of it is verifiably on Google Drive, or the month
         is empty.

    Point 3 is the one that matters. This lane is the only surviving record of
    anything older than ~48 h, so "old enough" is not a good enough reason on
    its own; the ledger written by rollup_archiver.py is the evidence, and
    without it nothing here deletes anything.
    """
    if ROLLUP_KEEP_MONTHS <= 0:
        return []
    # Imported here, not at module level: rollup_archiver imports this module
    # for the retention knob, so a top-level import would be a cycle.
    from app.services import rollup_archiver

    archived = await rollup_archiver.fully_archived_months(db)
    keep_from = _month(now)
    for _ in range(ROLLUP_KEEP_MONTHS):
        keep_from = (
            keep_from.replace(year=keep_from.year - 1, month=12)
            if keep_from.month == 1
            else keep_from.replace(month=keep_from.month - 1)
        )
    names = sorted(
        n for n in await _partitions(db, "scada\\_rollup\\_1m\\_%") if _ROLLUP_RE.match(n)
    )
    protected = set(names[-MIN_KEEP_ROLLUP:])  # same floor rule as raw
    dropped: list[str] = []
    for name in names:
        if name in protected:
            continue
        m = _ROLLUP_RE.match(name)
        month = datetime(int(m[1]), int(m[2]), 1, tzinfo=timezone.utc)
        if month >= keep_from:
            continue
        # Guard 3: no verified archive → no deletion, however old it is.
        if month.date() not in archived and not await _is_empty(db, name):
            logger.warning(
                "Ringkasan %s sudah kedaluwarsa tapi BELUM lengkap di Drive — "
                "tidak dihapus. Cek log arsip ringkasan / kredensial Drive.",
                name,
            )
            continue
        await db.execute(
            text(f"ALTER TABLE public.scada_rollup_1m DETACH PARTITION public.{name}")
        )
        await db.execute(text(f"DROP TABLE public.{name}"))
        dropped.append(name)
    return dropped


async def maintain_once(now: datetime | None = None) -> dict:
    """One housekeeping pass. `now` is injectable so tests can pin the clock."""
    from db.session import async_session_factory

    now = now or datetime.now(timezone.utc)
    async with async_session_factory() as db:
        settings = await rnet_settings.get_settings(db)
        window_h = int(settings.ring_window_h)

        # Create BEFORE dropping: if a pass is interrupted, the half that ran is
        # the half that prevents data loss.
        created_raw = await ensure_raw_partitions(db, now)
        created_rollup = await ensure_rollup_partitions(db, now)
        await db.commit()

        dropped_raw = await drop_expired_raw(db, now, window_h)
        dropped_rollup = await drop_expired_rollup(db, now)
        await db.commit()

        # Runway check — the failure this warns about is silent data loss.
        names = await _partitions(db, "scada_raw\\_%")
        future = [
            n for n in names
            if (m := _RAW_RE.match(n))
            and datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc) > _day(now)
        ]
        if len(future) < AHEAD_WARN_DAYS:
            logger.error(
                "Only %d future scada_raw partitions remain — new rows will be "
                "REJECTED once they run out. Check the partition manager.",
                len(future),
            )

    result = {
        "created_raw": created_raw,
        "created_rollup": created_rollup,
        "dropped_raw": dropped_raw,
        "dropped_rollup": dropped_rollup,
        "future_raw": len(future),
    }
    if created_raw or dropped_raw or dropped_rollup:
        logger.info("Partition maintenance: %s", result)
    return result


async def maintain_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged instead."""
    logger.info(
        "Partition manager active — every %ds, %d days ahead", INTERVAL_S, RAW_AHEAD_DAYS
    )
    while True:
        try:
            await maintain_once()
        except Exception:
            logger.exception("Partition maintenance iteration failed")
        await asyncio.sleep(INTERVAL_S)
