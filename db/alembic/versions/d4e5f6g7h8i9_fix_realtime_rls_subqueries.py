"""realtime fix: self-read policy on profiles + read policy on role_permissions

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-07-19 21:00:00.000000

Root cause found while debugging "Realtime never delivers": the scada SELECT
policies (scada_samples / scada_tag_latest / scada_alarm_events) all check

    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (...
            EXISTS (SELECT 1 FROM role_permissions rp ...)))

Those subqueries run WITH THE SUBSCRIBER'S rights — and since the
enable-RLS-everywhere migration (t4u5v6w7x8y9), profiles and role_permissions
have RLS ON with ZERO policies (deny-all). The EXISTS therefore always came
back false for browser users, so Supabase Realtime silently filtered out
every row. Nobody noticed before because polling covered the workbench.

Fix: the two minimal read policies the subqueries need —
  - profiles: authenticated may read ONLY their own row (id = auth.uid())
  - role_permissions: authenticated may read the matrix (non-sensitive)

Idempotent DO blocks per repo convention.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4e5f6g7h8i9"
down_revision = "c3d4e5f6g7h8"
branch_labels = None
depends_on = None


UP_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'profiles'
          AND policyname = 'profiles_select_self'
    ) THEN
        CREATE POLICY "profiles_select_self"
            ON public.profiles FOR SELECT
            TO authenticated
            USING (id = auth.uid());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'role_permissions'
          AND policyname = 'role_permissions_select_authenticated'
    ) THEN
        CREATE POLICY "role_permissions_select_authenticated"
            ON public.role_permissions FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END $$;
"""

DOWN_SQL = """
DO $$
BEGIN
    DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
    DROP POLICY IF EXISTS "role_permissions_select_authenticated"
        ON public.role_permissions;
END $$;
"""


def upgrade() -> None:
    op.execute(UP_SQL)


def downgrade() -> None:
    op.execute(DOWN_SQL)
