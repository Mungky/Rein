"""Ring-lane retention sweep — ONE owner, batched (audit data D-3).

WHY THIS MOVED HERE
    The sweep used to live in deploy/data/bridge.py, executed by every field PC
    every 60 s as a single unbounded statement:

        DELETE FROM scada_ring WHERE ts < now() - interval '24 hours'

    Three problems, all of which get worse with fleet size:
      1. Fan-out — the statement is not scoped to a site, so N bridges each
         swept the WHOLE table. At 50 plants that is 50 identical full-table
         deletes per minute; 49 of them find nothing and are pure waste.
      2. Unbounded — one transaction deleting an arbitrary number of rows holds
         its locks and its dead tuples for as long as it takes, and autovacuum
         falls behind.
      3. Wrong owner — retention is a property of the DATABASE, not of any
         particular field PC. A plant whose bridge is offline stopped having
         its ring pruned at all.

    So: one sweeper, here, next to the archiver and the health monitor, and it
    deletes in bounded batches.

HOW IT DELETES
    Postgres has no DELETE ... LIMIT, so each batch selects up to BATCH row
    identities first and deletes exactly those. ctid (the physical row address)
    is the cheapest possible key here and is stable inside one statement.

    A cycle keeps taking batches until a short one comes back (nothing left) or
    MAX_BATCHES is reached. The cap matters on the first run after this ships,
    when a long-unpruned table could hold millions of expired rows: the sweep
    makes steady progress every minute instead of one giant transaction.

RELATION TO PARTITIONING (D-1 / phase 5)
    This is deliberately a stopgap. Once scada_raw is partitioned by day,
    "delete old data" becomes DROP PARTITION — instant, no dead tuples, no
    vacuum debt — and this module goes away. It pairs with the ix_scada_ring_ts
    index from migration i9j0k1l2m3n4; without that index each batch's SELECT
    would still scan the whole table.

SAFETY
    Touches scada_ring ONLY. The historian lane (scada_samples) is never
    swept by time here — those rows may only be deleted by the archiver, and
    only after their cycle has been successfully exported to Drive.
"""

import asyncio
import logging
import os

from sqlalchemy import text

from app.services import rnet_settings

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("RING_PRUNE_INTERVAL_S", "60"))
BATCH = int(os.getenv("RING_PRUNE_BATCH", "10000"))
# Ceiling per cycle: BATCH × MAX_BATCHES rows. At the defaults that is 200 k
# rows/minute — far above any realistic ingest rate, so the backlog always
# shrinks, while still bounding how long one cycle can run.
MAX_BATCHES = int(os.getenv("RING_PRUNE_MAX_BATCHES", "20"))
# Off on laptops / second backends: retention must have exactly one owner, the
# same single-owner rule the alarm engine and health monitor already follow.
ENABLED = os.getenv("RING_PRUNER_ENABLED", "0") not in ("0", "false", "False")

_DELETE_BATCH = text(
    """
    DELETE FROM scada_ring
     WHERE ctid IN (
           SELECT ctid FROM scada_ring
            WHERE ts < now() - make_interval(hours => :hours)
            LIMIT :batch
     )
    """
)


async def prune_once() -> int:
    """Run one sweep cycle; returns how many rows were deleted.

    Each batch commits on its own, so an interrupted cycle still keeps the work
    it already did and the next cycle simply resumes.
    """
    from db.session import async_session_factory

    async with async_session_factory() as db:
        settings = await rnet_settings.get_settings(db)
        hours = int(settings.ring_window_h)

    total = 0
    for _ in range(MAX_BATCHES):
        async with async_session_factory() as db:
            result = await db.execute(
                _DELETE_BATCH, {"hours": hours, "batch": BATCH}
            )
            await db.commit()
        deleted = result.rowcount or 0
        total += deleted
        if deleted < BATCH:
            break  # caught up — nothing expired is left
        # Yield between batches so a large backlog never starves the event loop
        # (and other writers get their turn on the table).
        await asyncio.sleep(0)
    else:
        logger.warning(
            "Ring prune hit the %d-batch cap (%d rows); backlog continues next cycle",
            MAX_BATCHES,
            total,
        )

    if total:
        logger.info("Ring prune: %d baris lebih tua dari %d jam dihapus", total, hours)
    return total


async def prune_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop — errors are logged instead."""
    logger.info("Ring pruner active — every %ds, batch %d", INTERVAL_S, BATCH)
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            await prune_once()
        except Exception:
            logger.exception("Ring prune iteration failed")
