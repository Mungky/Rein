"""Add scada_rollup_archives — the ledger that lets a summary month be deleted.

THE GAP THIS CLOSES
    scada_rollup_1m is the 1-minute / 30-day lane: once the 24-hour raw drawers
    are dropped, it is the ONLY surviving copy of that period. Because of that,
    partitions.ROLLUP_KEEP_MONTHS shipped as 0 ("keep forever") with the note
    "phase 6 turns it on" — and phase 6 built per-plant archiving for
    scada_samples only. So the summary lane had neither archiving nor retention
    and grew without bound. Measured at pilot scale it is 359 B/row; projected
    to 50 plants that is ~233 GB per month, accumulating.

    Nothing may be dropped without a verified copy on Drive first. This table is
    that proof.

WHAT A ROW MEANS
    One (plant, month) bucket of the summary lane.
      drive_file_id IS NULL -> claimed, upload still in flight (or it failed and
                               the claim will be released)
      drive_file_id SET     -> that plant's month is verifiably on Drive
    A month partition may be dropped only once EVERY plant bucket for it is set
    — that check lives in app/services/partitions.py, the archiving in
    app/services/rollup_archiver.py.

WHY THE UNIQUE INDEX IS AN EXPRESSION
    site_id is nullable (summary rows whose plant was deleted, and simulator
    tags, land in a NULL bucket). In Postgres NULLs are DISTINCT in a unique
    index, so a plain UNIQUE (site_id, month) would happily allow two claims on
    the same NULL bucket — exactly the double-archive the claim exists to stop.
    COALESCE to the zero UUID collapses them into one comparable key.

WHY THERE IS NO FOREIGN KEY ON site_id
    Same reason scada_alarm_events snapshots ack_name: this is history. If a
    plant is deleted the ledger must still record that its month reached Drive
    and where — a CASCADE would erase the proof, and SET NULL could collide with
    an existing NULL-bucket row. The plant NAME is snapshotted alongside.

NOTHING EXISTING IS TOUCHED
    New table only. No column, index, view, policy, or row outside it changes.

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-07-28
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "n4o5p6q7r8s9"
down_revision = "m3n4o5p6q7r8"
branch_labels = None
depends_on = None


# One claim per (plant, month) — see the module docstring for why COALESCE.
UNIQUE_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS uq_scada_rollup_archives_site_month
    ON public.scada_rollup_archives (
        COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
        month
    );
"""

# Ledger only — no sensor values live here, but it names plants and Drive links,
# so it follows the same scada:view rule as every other R-Net table.
RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_rollup_archives ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_rollup_archives'
          AND policyname = 'scada_rollup_archives_select_scada_view'
    ) THEN
        CREATE POLICY "scada_rollup_archives_select_scada_view"
            ON public.scada_rollup_archives FOR SELECT
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


def upgrade() -> None:
    op.create_table(
        "scada_rollup_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        # No FK on purpose — see module docstring.
        sa.Column("site_id", sa.Uuid(), nullable=True),
        # Plant name AS IT WAS when archived; the plant may be renamed or
        # deleted later and the Drive file keeps the old name.
        sa.Column("plant", sa.String(length=120), nullable=False),
        # First day of the archived month, UTC.
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        # NULL while the upload is in flight; set = this bucket is safe to drop.
        sa.Column("drive_file_id", sa.String(length=128), nullable=True),
        sa.Column("web_link", sa.Text(), nullable=True),
        sa.Column("row_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("tag_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(UNIQUE_SQL)
    # "which months are done" is read on every housekeeping pass.
    op.create_index(
        "ix_scada_rollup_archives_month", "scada_rollup_archives", ["month"]
    )
    op.execute(RLS_SQL)
    op.execute("GRANT SELECT ON public.scada_rollup_archives TO authenticated")


def downgrade() -> None:
    op.drop_index("ix_scada_rollup_archives_month", table_name="scada_rollup_archives")
    op.execute("DROP INDEX IF EXISTS public.uq_scada_rollup_archives_site_month")
    op.drop_table("scada_rollup_archives")
