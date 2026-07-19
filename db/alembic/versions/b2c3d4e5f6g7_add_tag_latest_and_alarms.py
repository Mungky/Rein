"""alarms: scada_tag_latest + scada_alarm_events + scada_alarm_settings

Revision ID: b2c3d4e5f6g7
Revises: z0a1b2c3d4e5
Create Date: 2026-07-18 10:00:00.000000

R-Net data path — live lane + server-side alarms:
  - scada_tag_latest — one row per tag with the last-known value, UPSERTed at
    ~1 s cadence by the MQTT bridge / historian latest_loop. Feeds three
    consumers: browser live values (Supabase Realtime), the alarm engine
    (cheap threshold polling), and sensor-silence detection (its ts column).
  - scada_alarm_events — permanent alarm history. Open = cleared_at IS NULL;
    the partial unique index uq_scada_alarm_open (tag_id, kind) enforces at
    most one open event per tag+kind (dedup across engine restarts and two
    backends sharing one DB — inserts use ON CONFLICT DO NOTHING).
  - scada_alarm_settings — single row (id=1) of operator-tunable notification
    knobs (recipients, telegram chat id, flags, cooldown). Secrets (bot token)
    stay in the backend env.
  - RLS: latest + events get the same scada:view SELECT policy as
    scada_samples and join the supabase_realtime publication; settings is
    RLS-on/no-policy (deny-all, backend connects as owner).

All raw SQL is idempotent (guarded DO blocks) — precedent:
q1r2s3t4u5v6_add_workbench_columns_rls_realtime.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6g7"
down_revision = "z0a1b2c3d4e5"
branch_labels = None
depends_on = None


def _scada_view_policy(table: str) -> str:
    policy = f"{table}_select_scada_view"
    return f"""
DO $$
BEGIN
    ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = '{table}'
          AND policyname = '{policy}'
    ) THEN
        CREATE POLICY "{policy}"
            ON public.{table} FOR SELECT
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = '{table}'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.{table};
    END IF;
END $$;
"""


def _scada_view_policy_down(table: str) -> str:
    policy = f"{table}_select_scada_view"
    return f"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = '{table}'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.{table};
    END IF;

    DROP POLICY IF EXISTS "{policy}" ON public.{table};
    ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;
END $$;
"""


SETTINGS_RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_alarm_settings ENABLE ROW LEVEL SECURITY;
END $$;
"""


def upgrade() -> None:
    op.create_table(
        "scada_tag_latest",
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["scada_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tag_id"),
    )

    op.create_table(
        "scada_alarm_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trigger_value", sa.Float(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_by", sa.Uuid(), nullable=True),
        sa.Column("ack_name", sa.String(length=255), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["scada_tags.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ack_by"], ["profiles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_scada_alarm_open",
        "scada_alarm_events",
        ["tag_id", "kind"],
        unique=True,
        postgresql_where=sa.text("cleared_at IS NULL"),
    )
    op.create_index(
        "idx_scada_alarm_events_tag_triggered",
        "scada_alarm_events",
        ["tag_id", "triggered_at"],
    )
    op.create_index(
        "idx_scada_alarm_events_active",
        "scada_alarm_events",
        ["triggered_at"],
        postgresql_where=sa.text("cleared_at IS NULL"),
    )

    op.create_table(
        "scada_alarm_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "email_enabled", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("email_recipients", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "telegram_enabled", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "telegram_chat_id",
            sa.String(length=64),
            server_default="",
            nullable=False,
        ),
        sa.Column("cooldown_min", sa.Integer(), server_default="15", nullable=False),
        sa.Column(
            "sound_enabled", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Seed the single settings row so the backend can always UPDATE id=1.
    op.execute(
        "INSERT INTO scada_alarm_settings (id) VALUES (1) ON CONFLICT DO NOTHING"
    )

    op.execute(_scada_view_policy("scada_tag_latest"))
    op.execute(_scada_view_policy("scada_alarm_events"))
    op.execute(SETTINGS_RLS_SQL)


def downgrade() -> None:
    op.execute(_scada_view_policy_down("scada_alarm_events"))
    op.execute(_scada_view_policy_down("scada_tag_latest"))
    op.drop_table("scada_alarm_settings")
    op.drop_index("idx_scada_alarm_events_active", table_name="scada_alarm_events")
    op.drop_index(
        "idx_scada_alarm_events_tag_triggered", table_name="scada_alarm_events"
    )
    op.drop_index("uq_scada_alarm_open", table_name="scada_alarm_events")
    op.drop_table("scada_alarm_events")
    op.drop_table("scada_tag_latest")
