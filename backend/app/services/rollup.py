"""Per-minute rollup — the "tukang ringkas" of docs/ARSITEKTUR-DATA.md §2.5.

WHAT IT DOES
    Once a minute, reads ONLY the minutes that have just finished and writes one
    summary row per (minute, tag) into scada_rollup_1m:

        avg / min / max over the minute, plus n = how many raw values landed.

    That is the whole job. It never reads the whole table, so its cost is flat
    no matter how many years of history exist — the property that makes this
    scale where on-the-fly aggregation does not.

WHY A LOOKBACK WINDOW, NOT JUST "THE LAST MINUTE"
    A backend restart, a deploy, or a slow cycle would otherwise punch a
    permanent hole in the summary: the minute passes, nobody rolls it up, and
    nothing ever revisits it. So each cycle re-examines the last LOOKBACK_MIN
    minutes. Rows that already exist are skipped by ON CONFLICT DO NOTHING, so
    re-examining is nearly free, and a short outage heals itself.

    The window deliberately ends at the last CLOSED minute. Summarising a
    minute still in progress would freeze a partial average forever — the
    conflict clause that makes retries safe is the same clause that would make
    a premature row permanent.

WHERE IT READS FROM
    scada_samples_all — now scada_raw ∪ scada_samples. This task never named a
    physical table, which is why it needed no change when scada_raw replaced
    scada_ring underneath it, nor when scada_ring was dropped.

    Note the raw lane only keeps ~24 h, so a backend down longer than that
    loses the summary for those minutes permanently. That is inherent to raw
    retention, not to this task.

PARTITIONS
    scada_rollup_1m is partitioned by month; a row with no matching partition
    is an ERROR, not a silently-created drawer. So the task ensures the drawers
    for its window before inserting (CREATE TABLE IF NOT EXISTS — idempotent
    and cheap). There is deliberately NO default partition: a default would
    quietly swallow rows and then block creating the real partition later.

IDEMPOTENCE / TWO BACKENDS
    Two backends sharing a database may both run this loop. The PK (ts, tag_id)
    plus ON CONFLICT DO NOTHING makes a double run produce exactly the same
    table as a single run — the same guarantee every other writer in R-Net
    relies on.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("ROLLUP_INTERVAL_S", "60"))
# How many closed minutes each cycle re-examines. 10 covers a restart, a deploy,
# or a stalled cycle; raising it costs one slightly wider scan per minute.
LOOKBACK_MIN = int(os.getenv("ROLLUP_LOOKBACK_MIN", "10"))
ENABLED = os.getenv("ROLLUP_ENABLED", "1") not in ("0", "false", "False")

_INSERT_SQL = text(
    """
    INSERT INTO scada_rollup_1m (ts, tag_id, site_id, avg, min, max, n)
    SELECT date_trunc('minute', s.ts) AS m,
           s.tag_id,
           t.site_id,
           avg(s.value),
           min(s.value),
           max(s.value),
           count(*)
      FROM scada_samples_all s
      JOIN scada_tags t ON t.id = s.tag_id
     WHERE s.ts >= :start AND s.ts < :end
     GROUP BY m, s.tag_id, t.site_id
    ON CONFLICT (ts, tag_id) DO NOTHING
    """
)


def _month_starts(start: datetime, end: datetime) -> list[datetime]:
    """Every month touched by [start, end) — normally one, two across a
    month boundary."""
    months: list[datetime] = []
    cur = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cur < end:
        months.append(cur)
        cur = (
            cur.replace(year=cur.year + 1, month=1)
            if cur.month == 12
            else cur.replace(month=cur.month + 1)
        )
    return months


async def ensure_partitions(db, start: datetime, end: datetime) -> None:
    """Create the month drawers covering [start, end) if they are missing."""
    for month in _month_starts(start, end):
        nxt = (
            month.replace(year=month.year + 1, month=1)
            if month.month == 12
            else month.replace(month=month.month + 1)
        )
        name = f"scada_rollup_1m_{month:%Y_%m}"
        # Bounds are formatted, not bound: PARTITION OF ... FOR VALUES does not
        # accept parameters. The values come from datetime formatting, never
        # from user input.
        await db.execute(
            text(
                f"CREATE TABLE IF NOT EXISTS public.{name} "
                f"PARTITION OF public.scada_rollup_1m "
                f"FOR VALUES FROM ('{month:%Y-%m-%d %H:%M:%S}+00') "
                f"TO ('{nxt:%Y-%m-%d %H:%M:%S}+00')"
            )
        )


async def rollup_once(now: datetime | None = None) -> int:
    """Summarise every closed minute in the lookback window.

    Returns the number of summary rows written (rows that already existed do
    not count). `now` is injectable so tests can pin the window.
    """
    from db.session import async_session_factory

    now = now or datetime.now(timezone.utc)
    # End of window = start of the current, still-open minute → everything
    # below it is closed and safe to freeze.
    end = now.replace(second=0, microsecond=0)
    start = end - timedelta(minutes=LOOKBACK_MIN)

    async with async_session_factory() as db:
        await ensure_partitions(db, start, end)
        result = await db.execute(_INSERT_SQL, {"start": start, "end": end})
        await db.commit()

    written = result.rowcount or 0
    if written:
        logger.info(
            "Rollup: %d baris ringkasan menit ditulis (%s -> %s)",
            written,
            start.isoformat(),
            end.isoformat(),
        )
    return written


async def backfill(start: datetime, end: datetime, chunk_h: int = 1) -> int:
    """Summarise an arbitrary past window — a ONE-OFF, never called by the loop.

    Two uses: filling the summary for raw data that predates this feature (so
    phase 4 has something to compare charts against), and repairing a stretch
    the loop missed because the backend was down longer than LOOKBACK_MIN.

    Chunked by hour so one call cannot open an unbounded transaction; each
    chunk commits on its own, so an interrupted backfill keeps what it did and
    can simply be re-run — ON CONFLICT DO NOTHING makes repeats harmless.

    Only whole closed minutes are summarised: the caller's bounds are snapped
    inward to minute boundaries, for the same reason the loop stops at the last
    closed minute.
    """
    from db.session import async_session_factory

    start = start.replace(second=0, microsecond=0)
    end = end.replace(second=0, microsecond=0)
    total = 0
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(hours=chunk_h), end)
        async with async_session_factory() as db:
            await ensure_partitions(db, cursor, chunk_end)
            result = await db.execute(
                _INSERT_SQL, {"start": cursor, "end": chunk_end}
            )
            await db.commit()
        written = result.rowcount or 0
        total += written
        logger.info(
            "Backfill %s -> %s: %d baris", cursor.isoformat(), chunk_end.isoformat(), written
        )
        cursor = chunk_end
    return total


async def rollup_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged instead."""
    logger.info(
        "Rollup per-menit active — every %ds, lookback %d menit",
        INTERVAL_S,
        LOOKBACK_MIN,
    )
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            await rollup_once()
        except Exception:
            logger.exception("Rollup iteration failed")
