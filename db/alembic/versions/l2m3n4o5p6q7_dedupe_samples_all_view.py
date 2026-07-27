"""De-duplicate scada_samples_all during the scada_ring → scada_raw transition.

THE BUG THIS FIXES
    Migration k1l2m3n4o5p6 COPIED scada_ring into scada_raw (copy, not move —
    that is what makes phase 5 reversible) and widened the view to
    raw ∪ ring ∪ samples with UNION ALL. So for every row that was copied,
    scada_samples_all returns it TWICE.

    Found by the phase-6 archive dry run: the generated workbook contained
    consecutive identical rows —

        2026-07-26 22:08:42   21.050708770752
        2026-07-26 22:08:42   21.050708770752

    Everything downstream inherits it: exports list every reading twice, and
    scada_rollup_1m.n — documented as "how many raw values landed in this
    minute" — is inflated. (Chart values happen to survive, because duplicating
    identical values changes neither an average nor a min/max, which is exactly
    why this could go unnoticed.)

THE FIX
    Keep a ring row only when scada_raw does not already have that
    (tag_id, ts). The anti-join runs against scada_raw's primary key, and only
    for the ring side, which is frozen now that the field bridge writes
    scada_raw.

    This is a VIEW definition change: no table, column or row is touched, and
    downgrade() restores the previous definition exactly.

WHEN THIS GOES AWAY
    Step 7 of the phase-5 plan drops scada_ring from the view entirely and then
    drops the table. This migration is what keeps the numbers honest until the
    owner approves that step.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-07-27
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


VIEW_DEDUPED = """
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

VIEW_PLAIN_UNION_ALL = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_raw
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_ring
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""


def upgrade() -> None:
    op.execute(VIEW_DEDUPED)


def downgrade() -> None:
    op.execute(VIEW_PLAIN_UNION_ALL)
