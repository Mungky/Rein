"""Add scada_raw — daily-partitioned replacement for scada_ring (audit D-1).

Phase 5, steps 1-3 of the agreed plan. NOTHING IS DELETED HERE.

WHAT AND WHY
    scada_ring is swept every minute by `DELETE ... WHERE ts < cutoff`. Even
    with the time index from i9j0k1l2m3n4 that leaves one dead tuple per row
    deleted, and autovacuum never catches up: measured on the live database,
    scada_ring_pkey had bloated to 36 MB for 15 587 rows — roughly 50× its
    natural size.

    Partitioning by day turns retention into DROP TABLE: the whole day's file
    is unlinked at once, leaving zero dead tuples and zero vacuum debt.

MEASURED, NOT ASSUMED (300-tag / 48-hour benchmark on Postgres 17, see the
phase-5 plan discussion):
    - one full day at pilot scale = 3 283 200 rows = 416 MB
    - DROP of that partition          = 109 ms, 0 dead tuples
    - equivalent DELETE on a flat table = 2 632 ms, 3 283 200 dead tuples
    - inserts are unaffected by partitioning (1 178 ms vs 1 168 ms per minute
      of load) and unaffected by table size

INDEX LAYOUT — deliberately different from scada_rollup_1m
    PRIMARY KEY (tag_id, ts) + BRIN on ts, rather than PK (ts, tag_id) plus a
    second btree. This is legal because a partitioned table only requires the
    partition key (ts) to be PART OF the unique constraint, not its first
    column.

    Measured on the same benchmark, per daily partition:
        PK(ts,tag) + 2 btree  623 MB   1-minute aggregation 2.3 ms
        PK(tag,ts) alone      409 MB   1-minute aggregation  87 ms  (too slow)
        PK(tag,ts) + BRIN     416 MB   1-minute aggregation 2.5 ms  <- chosen
    33% smaller for the same speed. The BRIN is 40 kB where the btree it
    replaces was 157 MB.

    BRIN only works because rows arrive in time order (the bridge writes all
    tags for one moment, then the next). A benchmark filled in tag order
    measured 87 ms — if a future writer ever inserts out of order, revisit this.

    Bonus: PK (tag_id, ts) is the SAME key scada_ring already uses, so copying
    rows between them needs no reordering.

MIGRATION SAFETY
    The view scada_samples_all is widened to raw ∪ ring ∪ samples, so every
    reader keeps working no matter which table a row currently lives in. That
    is what makes this reversible and what lets an old bridge (still writing
    scada_ring) coexist with a new one. scada_ring is dropped in a LATER,
    separate migration, only after the field PC has been updated — step 7 of
    the plan, which needs its own approval.

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-07-26
"""

from datetime import datetime, timedelta, timezone

from alembic import op

# revision identifiers, used by Alembic.
revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None

# How many days of partitions the migration pre-creates. The background task
# keeps topping this up; the buffer is what protects against the backend being
# down at midnight, when a missing partition would make inserts FAIL and lose
# data. 7 days means the backend must be down a full week to cause that.
PRECREATE_DAYS = 7


TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public.scada_raw (
    tag_id  uuid             NOT NULL
                REFERENCES public.scada_tags(id) ON DELETE CASCADE,
    ts      timestamptz      NOT NULL,
    site_id uuid             NULL
                REFERENCES public.scada_sites(id) ON DELETE SET NULL,
    value   double precision NOT NULL,
    PRIMARY KEY (tag_id, ts)
) PARTITION BY RANGE (ts);
"""

# One BRIN for time-range scans (the rollup task reads one minute at a time).
# Tiny because it stores a min/max per block range, not per row.
INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_scada_raw_ts_brin
    ON public.scada_raw USING brin (ts) WITH (pages_per_range = 32);
"""

RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_raw ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_raw'
          AND policyname = 'scada_raw_select_scada_view'
    ) THEN
        CREATE POLICY "scada_raw_select_scada_view"
            ON public.scada_raw FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND (
                        p.role = 'admin'
                        OR EXISTS (
                            SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role = p.role
                              AND rp.permission = 'scada:view'
                        )
                      )
                )
            );
    END IF;
END $$;
"""

# Three-way union for the transition. Readers never name a physical table, so
# rows are found wherever they are. Collapses back to two when scada_ring goes.
VIEW_SQL = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_ring
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

VIEW_SQL_OLD = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_ring
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

# Copy, not move: scada_ring keeps every row. site_id is filled in from the tag
# so historical rows gain the plant identity new rows will carry.
COPY_SQL = """
INSERT INTO public.scada_raw (tag_id, ts, site_id, value)
SELECT r.tag_id, r.ts, t.site_id, r.value
  FROM public.scada_ring r
  JOIN public.scada_tags t ON t.id = r.tag_id
ON CONFLICT DO NOTHING;
"""


def create_day_partition(day: datetime) -> None:
    """One day drawer, [day, day+1). IF NOT EXISTS so the background task can
    call this every hour without checking first."""
    nxt = day + timedelta(days=1)
    op.execute(
        f"CREATE TABLE IF NOT EXISTS public.scada_raw_{day:%Y_%m_%d} "
        f"PARTITION OF public.scada_raw "
        f"FOR VALUES FROM ('{day:%Y-%m-%d} 00:00:00+00') "
        f"TO ('{nxt:%Y-%m-%d} 00:00:00+00')"
    )


def upgrade() -> None:
    op.execute(TABLE_SQL)
    op.execute(INDEX_SQL)
    op.execute(RLS_SQL)
    op.execute("GRANT SELECT ON public.scada_raw TO authenticated")

    # Yesterday too: scada_ring may still hold rows from before midnight, and
    # the copy below has to have somewhere to put them.
    today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    for offset in range(-1, PRECREATE_DAYS):
        create_day_partition(today + timedelta(days=offset))

    op.execute(COPY_SQL)
    op.execute(VIEW_SQL)

    # scada_samples was still being broadcast over Supabase Realtime even though
    # nothing subscribes to it (the browser listens on scada_tag_latest and
    # scada_alarm_events only) — every history row written was published to no
    # one. ARSITEKTUR-DATA §2.7 asks for raw to be off Realtime; scada_raw is
    # never added.
    op.execute(
        "DO $$ BEGIN "
        "ALTER PUBLICATION supabase_realtime DROP TABLE public.scada_samples; "
        "EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;"
    )


def downgrade() -> None:
    op.execute(VIEW_SQL_OLD)
    op.execute("DROP TABLE IF EXISTS public.scada_raw CASCADE")
    op.execute(
        "DO $$ BEGIN "
        "ALTER PUBLICATION supabase_realtime ADD TABLE public.scada_samples; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
