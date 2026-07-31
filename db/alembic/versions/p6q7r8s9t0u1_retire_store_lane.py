"""Pensiunkan lajur simpan — satu jalur data untuk semua sensor.

THIS DROPS A TABLE, and it is safe because the table is empty. Verified against
the live database on 29 Juli 2026, right before this migration was written:

    SELECT count(*) FROM scada_samples                     ->  0
    SELECT count(DISTINCT tag_id) FROM scada_samples       ->  0
    tags carrying config.store_enabled                     ->  0   (of 17 tags)

So there is nothing to archive first, nothing to migrate, and nothing to soak.
The `count(*) = 0` guard below is not ceremony — it is what makes running this
against a different environment, or a restored backup, refuse loudly instead of
deleting a month of somebody's data.

WHAT THE LANE WAS

    Ticking "Simpan data" on a sensor routed its history to `scada_samples`
    instead of `scada_raw`: a flat, unpartitioned table that accumulated for a
    month, was exported to a per-plant .xlsx on Drive, and then DELETEd so the
    tag's clock restarted from zero. It predates the per-minute summary.

WHY IT GOES

    scada_rollup_1m now gives EVERY sensor 30-61 days of avg/min/max/n and a
    per-plant .zip on Drive, ticked or not. Against that, the store lane bought
    one thing — full-resolution rows for longer than raw keeps them — and cost
    four:

      · every stored sensor was written twice and archived twice (xlsx + zip),
      · the lane was never partitioned, so its retention stayed DELETE-based:
        the exact churn-and-bloat problem partitioning was introduced to fix,
      · it forced a slow/slowest-only restriction on stored sensors, purely to
        keep a month of rows under Excel's 1 048 576-row sheet limit,
      · a disabled tag was skipped by the archiver, so its rows were never
        exported AND never deleted — they simply accumulated forever.

    docs/ARSITEKTUR-DATA.md §2.3 always intended one lane ("centang itu tidak
    perlu lagi"); docs/RINGKASAN-PERBAIKAN.md §9 deferred it until summary-based
    archiving was proven. It is proven, and the lane turned out to be unused.

WHAT IS LOST, HONESTLY

    Raw is now 24-48 h for everyone, where a stored sensor kept ~1 month of it.
    The fidelity cost is small because stored sensors were already capped at
    slow (30 s) / slowest (60 s):

        slowest 60 s  ->  n=1 per minute, so avg = min = max = the sample. None.
        slow    30 s  ->  n=2 per minute; BOTH values survive as min and max.
                          Only their order within the minute is gone.

    Raise scada_settings.ring_window_h (Panel Administrasi → R-Net) if a longer
    raw window is wanted; 72 h is free at this scale.

WHY NO FIELD-PC DEPLOY IS NEEDED

    deploy/data/bridge.py picks the lane from DATA, not code: `_parse_interval`
    returns `is_ring = not cfg.get("store_enabled")`, read from scada_tags.config
    and refreshed every CONFIG_REFRESH_S (30 s). Stripping the key here makes
    every bridge — including one months out of date — write 100% to scada_raw
    within half a minute. With zero tags carrying the flag today, that is
    already true; the UPDATE below is belt-and-braces.

ON downgrade()
    It restores the SHAPE — an empty scada_samples and the two-way view — but
    it cannot restore rows (there were none) and it cannot know which tags once
    had store_enabled set (that information is destroyed by the UPDATE, which
    is the point of the UPDATE). Same honesty as m3n4o5p6q7r8.

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-07-30
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "p6q7r8s9t0u1"
down_revision = "o5p6q7r8s9t0"
branch_labels = None
depends_on = None


# Refuse rather than delete. A non-empty table here means this is NOT the
# database the preconditions were checked against.
GUARD_SQL = """
DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM public.scada_samples;
    IF n > 0 THEN
        RAISE EXCEPTION
            'scada_samples berisi % baris — migrasi DIBATALKAN. Arsipkan dulu '
            'lajur lama itu ke Drive; jangan jalankan migrasi ini sampai '
            'jumlahnya 0.', n;
    END IF;
END $$;
"""

# Belt-and-braces: today this updates zero rows. It exists so that a database
# where somebody re-added the flag between the check and the deploy still ends
# up in one lane rather than writing to a table that is about to disappear.
STRIP_CONFIG_SQL = """
UPDATE public.scada_tags
   SET config = config - 'store_enabled' - 'store_cycle_start'
 WHERE config ? 'store_enabled' OR config ? 'store_cycle_start';
"""

# View FIRST, then drop — a reader between the two statements still resolves.
VIEW_ONE_LANE = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

VIEW_TWO_LANES = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

# Recreated by downgrade() as an EMPTY table with the same shape + RLS, so the
# old code path has somewhere to write. Mirrors o9p0q1r2s3t4's definition.
RECREATE_SQL = """
CREATE TABLE IF NOT EXISTS public.scada_samples (
    tag_id uuid NOT NULL REFERENCES public.scada_tags(id) ON DELETE CASCADE,
    ts     timestamptz      NOT NULL,
    value  double precision NOT NULL,
    PRIMARY KEY (tag_id, ts)
);
CREATE INDEX IF NOT EXISTS ix_scada_samples_ts ON public.scada_samples (ts);
ALTER TABLE public.scada_samples ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.scada_samples TO authenticated;
"""


def upgrade() -> None:
    op.execute(GUARD_SQL)
    op.execute(STRIP_CONFIG_SQL)
    op.execute(VIEW_ONE_LANE)
    op.execute("DROP TABLE IF EXISTS public.scada_samples")


def downgrade() -> None:
    op.execute(RECREATE_SQL)
    op.execute(VIEW_TWO_LANES)
