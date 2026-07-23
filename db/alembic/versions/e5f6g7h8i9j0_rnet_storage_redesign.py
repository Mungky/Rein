"""rnet storage redesign: ring/historian split, settings, per-tag archives

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-07-23 12:00:00.000000

Rombak penyimpanan R-Net (see plan snoopy-waddling-stardust):
  - scada_settings — single-row (id=1) admin knobs: 4 sampling-level durations
    + retention (ring_window_h, store_months, reset_warn_days).
  - scada_ring — NEW short-retention lane (store off, 24h window). Split out of
    scada_samples so its heavy INSERT+DELETE churn never bloats the historian.
  - scada_tag_archives — per-tag-cycle archive ledger (replaces the monthly
    scada_archives model, which is kept for historical rows).
  - scada_samples_all — security_invoker VIEW unioning ring ∪ historian; every
    read path selects from it. Writers/pruners target the physical tables.
  - Data migration: config.storage_interval_s → config.sampling_level; set
    config.store_cycle_start for storing tags; move existing ring-tag rows from
    scada_samples into scada_ring (last 24h), drop the rest.

RLS mirrors scada_samples (scada:view SELECT). scada_ring is intentionally NOT
added to supabase_realtime — live values come from scada_tag_latest; ring rows
never need pushing (saves Realtime load). Idempotent DO blocks per convention.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e5f6g7h8i9j0"
down_revision = "d4e5f6g7h8i9"
branch_labels = None
depends_on = None


# scada_ring: same scada:view SELECT policy as scada_samples (defense in depth;
# the union view is security_invoker so its RLS is the underlying tables').
RING_RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_ring ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_ring'
          AND policyname = 'scada_ring_select_scada_view'
    ) THEN
        CREATE POLICY "scada_ring_select_scada_view"
            ON public.scada_ring FOR SELECT
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

VIEW_SQL = """
CREATE OR REPLACE VIEW public.scada_samples_all
    WITH (security_invoker = true) AS
    SELECT tag_id, ts, value FROM public.scada_ring
    UNION ALL
    SELECT tag_id, ts, value FROM public.scada_samples;
GRANT SELECT ON public.scada_samples_all TO authenticated;
"""

# storage_interval_s (old) → sampling_level (new). Store tags floor to slow;
# ring tags map by their old interval (ring with none → fast). Also stamps
# store_cycle_start (ISO 'Z') on storing tags so their 1-month clock starts now.
MIGRATE_CONFIG_SQL = """
UPDATE public.scada_tags SET config =
    (config - 'storage_interval_s')
    || jsonb_build_object('sampling_level',
        CASE
          WHEN COALESCE((config->>'store_enabled')::boolean, false) THEN
            CASE WHEN COALESCE(NULLIF(config->>'storage_interval_s','')::int, 60) <= 30
                 THEN 'slow' ELSE 'slowest' END
          ELSE
            CASE
              WHEN COALESCE(NULLIF(config->>'storage_interval_s','')::int, 5) <= 2 THEN 'fastest'
              WHEN COALESCE(NULLIF(config->>'storage_interval_s','')::int, 5) <= 5 THEN 'fast'
              WHEN COALESCE(NULLIF(config->>'storage_interval_s','')::int, 5) <= 30 THEN 'slow'
              ELSE 'slowest'
            END
        END)
    || CASE WHEN COALESCE((config->>'store_enabled')::boolean, false)
            THEN jsonb_build_object(
                'store_cycle_start',
                to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
            ELSE '{}'::jsonb END;
"""

# Move existing ring-tag rows (store off) into scada_ring (last 24h), then drop
# ALL ring-tag rows from the historian table — it is historian-only now.
MOVE_RING_ROWS_SQL = """
INSERT INTO public.scada_ring (tag_id, ts, value)
SELECT s.tag_id, s.ts, s.value
FROM public.scada_samples s
JOIN public.scada_tags t ON t.id = s.tag_id
WHERE COALESCE((t.config->>'store_enabled')::boolean, false) = false
  AND s.ts >= now() - interval '24 hours'
ON CONFLICT DO NOTHING;

DELETE FROM public.scada_samples s
USING public.scada_tags t
WHERE t.id = s.tag_id
  AND COALESCE((t.config->>'store_enabled')::boolean, false) = false;
"""


def upgrade() -> None:
    # --- scada_settings (single row) ---
    op.create_table(
        "scada_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("level_fastest_s", sa.Integer(), server_default="2", nullable=False),
        sa.Column("level_fast_s", sa.Integer(), server_default="5", nullable=False),
        sa.Column("level_slow_s", sa.Integer(), server_default="30", nullable=False),
        sa.Column("level_slowest_s", sa.Integer(), server_default="60", nullable=False),
        sa.Column("ring_window_h", sa.Integer(), server_default="24", nullable=False),
        sa.Column("store_months", sa.Integer(), server_default="1", nullable=False),
        sa.Column("reset_warn_days", sa.Integer(), server_default="7", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO public.scada_settings (id) VALUES (1)")
    op.execute("ALTER TABLE public.scada_settings ENABLE ROW LEVEL SECURITY")

    # --- scada_ring (short-retention lane) ---
    op.create_table(
        "scada_ring",
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["scada_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tag_id", "ts"),
    )
    op.execute(RING_RLS_SQL)

    # --- scada_tag_archives (per-cycle ledger) ---
    op.create_table(
        "scada_tag_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("cycle_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cycle_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        sa.Column("drive_file_id", sa.String(length=128), nullable=True),
        sa.Column("web_link", sa.Text(), nullable=True),
        sa.Column("row_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["scada_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_scada_tag_archives_tag_cycle",
        "scada_tag_archives",
        ["tag_id", "cycle_start"],
        unique=True,
    )
    op.execute("ALTER TABLE public.scada_tag_archives ENABLE ROW LEVEL SECURITY")

    # --- read view (ring ∪ historian) ---
    op.execute(VIEW_SQL)

    # --- data migration ---
    op.execute(MOVE_RING_ROWS_SQL)
    op.execute(MIGRATE_CONFIG_SQL)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS public.scada_samples_all")
    op.drop_index("uq_scada_tag_archives_tag_cycle", table_name="scada_tag_archives")
    op.drop_table("scada_tag_archives")
    op.drop_table("scada_ring")
    op.drop_table("scada_settings")
    # config sampling_level/store_cycle_start and moved rows are intentionally
    # not reverted — the old storage_interval_s default behavior is harmless.
