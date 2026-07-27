"""Add scada_rollup_1m — per-minute summary, partitioned by month.

Implements docs/ARSITEKTUR-DATA.md §2.3 layer 3 and §2.5.

WHAT IT IS
    One row per (sensor, minute) holding avg / min / max / n over that minute,
    plus the plant the sensor belongs to. It is a SUMMARY of the raw lanes, not
    a replacement: raw stays the source of truth for the last 24 hours.

WHY
    Every dashboard read currently re-aggregates raw rows on the fly. A 30-day
    chart grinds ~43 000 raw rows into 720 points on EVERY open. Pre-computing
    the minute is the difference between "compute it again for each viewer" and
    "look it up". At 1 000 sensors it also shrinks the long-retention footprint
    from ~86 M raw rows to ~43 M summary rows (§2.8).

WHY `n` MATTERS
    `n` counts how many raw values landed in that minute. A minute where the
    sensor was silent produces NO row at all, and a minute where it stuttered
    produces a row with a small `n`. That distinguishes "quiet" from "broken"
    without storing the gaps themselves — the honesty rule from AUDIT-DATA §6.4.

WHY PARTITIONED BY MONTH
    So retention becomes DROP PARTITION (instant, no dead tuples, no vacuum
    debt) instead of DELETE ... WHERE ts < ... (§2.4). Partitions are created
    on demand by the rollup task; this migration seeds the current and next
    month so the very first cycle has somewhere to land.

    Postgres requires the partition key in every unique constraint, so the PK
    is (ts, tag_id) — ts first, which also matches how every read filters
    (a time window, then tags).

WHY site_id IS DENORMALISED HERE
    Raw rows carry only (tag, time, value), so "everything for plant X" has to
    detour through scada_tags (AUDIT-DATA D-1). Summary rows are written once
    and read forever, so the plant is stamped in at write time — that is what
    makes per-plant archiving (§2.6) and per-plant deletion straightforward.

NOTHING EXISTING IS TOUCHED
    No table, view, column, index, or row outside this new table is altered.
    Nothing reads from scada_rollup_1m yet — switching the dashboards over is
    phase 4.

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-07-26
"""

from datetime import datetime, timezone

from alembic import op

# revision identifiers, used by Alembic.
revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public.scada_rollup_1m (
    ts       timestamptz      NOT NULL,
    tag_id   uuid             NOT NULL
                 REFERENCES public.scada_tags(id) ON DELETE CASCADE,
    site_id  uuid             NULL
                 REFERENCES public.scada_sites(id) ON DELETE SET NULL,
    avg      double precision NOT NULL,
    min      double precision NOT NULL,
    max      double precision NOT NULL,
    n        integer          NOT NULL,
    PRIMARY KEY (ts, tag_id)
) PARTITION BY RANGE (ts);
"""

# Reads are "this tag (or these tags), over this window". The PK already leads
# with ts, so add the tag-first ordering for the per-tag lookups. Declared on
# the parent: Postgres creates a matching index on every partition, existing
# and future.
INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_scada_rollup_1m_tag_ts
    ON public.scada_rollup_1m (tag_id, ts);
CREATE INDEX IF NOT EXISTS ix_scada_rollup_1m_site_ts
    ON public.scada_rollup_1m (site_id, ts);
"""

# Same scada:view SELECT policy as scada_ring / scada_samples. Declared on the
# parent table; partitions inherit the row-level policy.
RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_rollup_1m ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_rollup_1m'
          AND policyname = 'scada_rollup_1m_select_scada_view'
    ) THEN
        CREATE POLICY "scada_rollup_1m_select_scada_view"
            ON public.scada_rollup_1m FOR SELECT
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


def _month_bounds(year: int, month: int) -> tuple[str, str, str]:
    """(partition suffix, inclusive lower bound, exclusive upper bound)."""
    nxt_y, nxt_m = (year + 1, 1) if month == 12 else (year, month + 1)
    return (
        f"{year:04d}_{month:02d}",
        f"{year:04d}-{month:02d}-01 00:00:00+00",
        f"{nxt_y:04d}-{nxt_m:02d}-01 00:00:00+00",
    )


def create_month_partition(year: int, month: int) -> None:
    """One month drawer. IF NOT EXISTS so the rollup task can call this on
    every cycle without checking first."""
    suffix, lo, hi = _month_bounds(year, month)
    op.execute(
        f"CREATE TABLE IF NOT EXISTS public.scada_rollup_1m_{suffix} "
        f"PARTITION OF public.scada_rollup_1m "
        f"FOR VALUES FROM ('{lo}') TO ('{hi}')"
    )


def upgrade() -> None:
    op.execute(TABLE_SQL)
    op.execute(INDEX_SQL)
    op.execute(RLS_SQL)
    op.execute("GRANT SELECT ON public.scada_rollup_1m TO authenticated")

    # Seed this month + next so the first rollup cycle always has a home, even
    # if it runs across a month boundary at midnight on the 1st.
    now = datetime.now(timezone.utc)
    create_month_partition(now.year, now.month)
    nxt_y, nxt_m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    create_month_partition(nxt_y, nxt_m)


def downgrade() -> None:
    # Dropping the parent drops every partition with it.
    op.execute("DROP TABLE IF EXISTS public.scada_rollup_1m CASCADE")
