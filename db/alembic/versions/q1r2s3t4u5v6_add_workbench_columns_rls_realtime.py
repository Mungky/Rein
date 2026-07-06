"""workbench: scada_workbench_columns + RLS & Realtime on scada_samples

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-07-05 16:00:00.000000

R-Net Analisis workbench ("Excel untuk SCADA"):
  - scada_workbench_columns — shared custom formula columns (formula string is
    opaque here; evaluated only client-side by the safe arithmetic parser)
  - RLS on scada_samples — browser clients subscribe via Supabase Realtime, so
    SELECT is gated with the same role-permission matrix (scada:view, admin
    bypass). The backend/sampler connects as the table owner → unaffected.
  - scada_samples added to the supabase_realtime publication so INSERTs are
    pushed to subscribed workbench clients.

All raw SQL is idempotent (guarded DO blocks) — precedent:
n8o9p0q1r2s3_workspace_rpo_wo_detail.py storage policies.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "q1r2s3t4u5v6"
down_revision = "p0q1r2s3t4u5"
branch_labels = None
depends_on = None


RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_samples ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_samples'
          AND policyname = 'scada_samples_select_scada_view'
    ) THEN
        CREATE POLICY "scada_samples_select_scada_view"
            ON public.scada_samples FOR SELECT
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
          AND tablename = 'scada_samples'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.scada_samples;
    END IF;
END $$;
"""

RLS_DOWN_SQL = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'scada_samples'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.scada_samples;
    END IF;

    DROP POLICY IF EXISTS "scada_samples_select_scada_view" ON public.scada_samples;
    ALTER TABLE public.scada_samples DISABLE ROW LEVEL SECURITY;
END $$;
"""


def upgrade() -> None:
    op.create_table(
        "scada_workbench_columns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("formula", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(length=30), server_default="", nullable=False),
        sa.Column("decimals", sa.Integer(), server_default="1", nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute(RLS_SQL)


def downgrade() -> None:
    op.execute(RLS_DOWN_SQL)
    op.drop_table("scada_workbench_columns")
