"""Drop scada_ring — step 7, the end of the phase-5 transition.

THIS DELETES A TABLE. It was held back until the owner approved it, after all
four preconditions were verified against the live database:

  1. the field PC runs the bridge that writes scada_raw (heartbeat present in
     scada_bridge_status, scada_raw receiving, scada_ring frozen 1.5 h),
  2. the final sweep copied every straggler (raw_sweep.py reported 0 left),
  3. row-for-row, INCLUDING VALUES: 0 rows of scada_ring lacked an exact match
     in scada_raw; 77 512 rows in both over the identical time range,
  4. three independent copies survive this migration — scada_raw, the
     per-minute summary in scada_rollup_1m, and the CSV snapshot in
     db/snapshots/2026-07-26-plant-tanobel/.

WHAT ELSE THIS UNDOES
    The view collapses back to raw ∪ samples. That also retires the anti-join
    from migration l2m3n4o5p6q7, which existed only because scada_ring held a
    COPY of scada_raw's rows and the plain UNION ALL therefore returned each of
    them twice. With scada_ring gone there is nothing to de-duplicate, so the
    view gets cheaper as well as simpler.

ON downgrade()
    It restores the SHAPE — an empty scada_ring and the three-way view — but it
    cannot restore rows, because dropping a table is not reversible. That is
    fine: every row that was in scada_ring is in scada_raw, which downgrade
    does not touch. Restoring the data itself would mean reloading the CSV
    snapshot, and that is a deliberate manual act, not something a downgrade
    should do silently.

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-07-27
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None


# Two lanes again: raw (24 h, day-partitioned) and samples (historian).
VIEW_FINAL = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

VIEW_TRANSITIONAL = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw
    UNION ALL
    SELECT r.tag_id, r.ts, r.value
      FROM public.scada_ring r
     WHERE NOT EXISTS (
           SELECT 1 FROM public.scada_raw w
            WHERE w.tag_id = r.tag_id AND w.ts = r.ts
     )
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

RING_TABLE = """
CREATE TABLE IF NOT EXISTS public.scada_ring (
    tag_id uuid             NOT NULL
               REFERENCES public.scada_tags(id) ON DELETE CASCADE,
    ts     timestamptz      NOT NULL,
    value  double precision NOT NULL,
    PRIMARY KEY (tag_id, ts)
);
CREATE INDEX IF NOT EXISTS ix_scada_ring_ts ON public.scada_ring (ts);
"""

RING_RLS = """
DO $$
BEGIN
    ALTER TABLE public.scada_ring ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'scada_ring'
          AND policyname = 'scada_ring_select_scada_view'
    ) THEN
        CREATE POLICY "scada_ring_select_scada_view"
            ON public.scada_ring FOR SELECT TO authenticated
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


def upgrade() -> None:
    # View first: nothing may still be reading the table when it goes.
    op.execute(VIEW_FINAL)
    op.execute("DROP TABLE IF EXISTS public.scada_ring")


def downgrade() -> None:
    op.execute(RING_TABLE)
    op.execute(RING_RLS)
    op.execute("GRANT SELECT ON public.scada_ring TO authenticated")
    op.execute(VIEW_TRANSITIONAL)
