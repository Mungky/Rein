"""Stale-claim release — what keeps an interrupted archive from freezing
retention forever (audit B1).

THE FAILURE THIS EXISTS FOR

    The archive ledger uses a two-step shape, and it is the right shape:

        1. INSERT the bucket row        <- atomic claim, COMMITTED
        2. build the file, upload it, then fill drive_file_id

    Step 1 commits before step 2 starts. That is precisely what stops two
    backends from archiving the same bucket twice. But it also means a process
    that dies BETWEEN the two — a Railway deploy, an OOM kill, a container
    restart mid-upload — leaves behind a row with drive_file_id IS NULL that
    nothing ever cleans up. And such a row is worse than no row at all:

      - the bucket can never be archived again, because the unique index turns
        the next claim into a silent no-op (`archive_id is None` -> skip),
      - the bucket can never be released, because every "is it safe to delete?"
        gate requires drive_file_id IS NOT NULL.

    So the bucket is stuck in both directions at once: the month partition is
    never dropped and the summary lane goes back to growing without bound
    (~233 GB/month at 50 plants).

    And it is SILENT. The only symptom is one warning line per pass and a
    database that quietly stops shrinking — which is exactly the class of bug
    that is found six months later by running out of disk.

WHY A TIMEOUT, AND NOT A HEARTBEAT COLUMN

    A heartbeat would be exact, but it needs a writer running during the upload
    and a schema change. It is not worth it here, because the window is not
    ambiguous: a claim is INSERTed immediately before its own upload, and an
    upload is minutes. Still unfinished after ARCHIVE_CLAIM_STALE_H hours means
    the process holding it is gone.

    `created_at` is already the claim timestamp — the ledger defaults it to
    now() and the INSERT that writes it IS the claim — so this needs no
    migration.

WORST CASE IF THE TIMEOUT IS TOO SHORT

    A genuinely slow upload has its claim released, a later pass re-claims and
    uploads, and Drive ends up holding two copies of that bucket. The ledger
    still has exactly one row and the data is intact.

    That is wasted bandwidth, not lost data, and it is the reason this module
    RELEASES claims rather than marking them done: releasing can only ever
    cause a duplicate, while marking done would authorise a deletion for a file
    that was never uploaded. Only one of those two mistakes is recoverable.

    The callers guard the other half of the race: after a long upload they
    re-read their own claim row and, if it has vanished, abort WITHOUT deleting
    anything.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger(__name__)

# How long a claim may sit unfinished before a later pass may take it over.
# Generous on purpose: the rollup archiver runs every 6 h anyway, so there is
# nothing to gain from reaping aggressively, and a short window is the only way
# this can cause duplicate Drive files.
STALE_H = int(os.getenv("ARCHIVE_CLAIM_STALE_H", "6"))

# Explicit allowlist. These names are interpolated into SQL because a table name
# cannot be a bind parameter; the allowlist is what makes that safe, and it also
# means a typo fails loudly here instead of at the database.
#
# scada_tag_archives is deliberately NOT here. It was, while the store lane
# existed and something still wrote claims into it. Nothing does any more (the
# lane is retired), so a reaper pointed at it would be dead capability whose
# only effect would be to suggest that lane is still alive. Its old rows are
# inert receipts for Drive links and no gate reads them.
LEDGERS = ("scada_rollup_archives",)

# What to print so the log names the bucket rather than a UUID.
_LABEL_COLS = {
    "scada_rollup_archives": "plant || ' ' || month",
}


async def release_stale(
    db, table: str, now: datetime | None = None, stale_h: int | None = None
) -> int:
    """Delete claims whose upload never finished, so a later pass can retry.

    Returns how many were released. Never raises on an empty ledger, and is
    safe to call at the top of every pass — on a healthy system it deletes
    nothing and costs one indexed DELETE.

    Deleting the row (rather than blanking a field) is deliberate: the claim IS
    the row, so releasing it restores exactly the state that existed before the
    crashed pass ran, and the normal INSERT path re-claims it with no special
    case anywhere else.
    """
    if table not in LEDGERS:
        raise ValueError(f"Bukan tabel buku induk arsip: {table!r}")
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=stale_h if stale_h is not None else STALE_H)

    res = await db.execute(
        text(
            f"DELETE FROM {table} "  # noqa: S608 - name is allowlisted above
            "WHERE drive_file_id IS NULL AND created_at < :cutoff "
            f"RETURNING {_LABEL_COLS[table]}"
        ),
        {"cutoff": cutoff},
    )
    labels = [r[0] for r in res.all()]
    await db.commit()

    if labels:
        # ERROR, not INFO: reaching this means a previous pass was killed
        # mid-upload. The retry is automatic, but the crash itself is worth
        # seeing in Sentry rather than scrolling past.
        logger.error(
            "Klaim arsip basi dilepas dari %s (%d): %s. "
            "Artinya ada proses arsip yang mati di tengah upload — bucket ini "
            "akan dicoba lagi sekarang. Tidak ada data yang hilang.",
            table,
            len(labels),
            ", ".join(str(x) for x in labels[:10]) + (" …" if len(labels) > 10 else ""),
        )
    return len(labels)
