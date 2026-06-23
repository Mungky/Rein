"""workspace: add rpo number, WO detail fields, multi-photo & review status

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-05-26 18:00:00.000000

Adds:
  - workspace_projects.rpo_number (text, unique-when-not-null) — manual input
  - workspace_tasks.description (text) — detailed scope of the Work Order
  - workspace_tasks.location (text) — physical location of the work
  - workspace_tasks.estimated_days (int)
  - workspace_tasks.review_notes (text) — engineer's revision feedback
  - workspace_tasks.reviewed_by (uuid FK profiles) — who approved/rejected
  - workspace_tasks.reviewed_at (timestamptz)
  - workspace_tasks.started_at (timestamptz) — when field worker tapped Start
  - task_completions.photos_before (jsonb array of URLs)
  - task_completions.photos_after  (jsonb array of URLs)
  - task_status enum: add 'pending_review' value
  - role_permissions: seed new workspace:* permissions

Backwards compatible: existing photo_url & notes fields are kept, new array
columns get an empty default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "n8o9p0q1r2s3"
down_revision = "m7n8o9p0q1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- workspace_projects: rpo_number --
    op.add_column(
        "workspace_projects",
        sa.Column("rpo_number", sa.Text(), nullable=True),
    )
    op.create_index(
        "uq_workspace_projects_rpo_number",
        "workspace_projects",
        ["rpo_number"],
        unique=True,
        postgresql_where=sa.text("rpo_number IS NOT NULL"),
    )

    # -- workspace_tasks: WO detail fields --
    op.add_column("workspace_tasks", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("workspace_tasks", sa.Column("location", sa.Text(), nullable=True))
    op.add_column("workspace_tasks", sa.Column("estimated_days", sa.Integer(), nullable=True))
    op.add_column("workspace_tasks", sa.Column("review_notes", sa.Text(), nullable=True))
    op.add_column("workspace_tasks", sa.Column("reviewed_by", sa.Uuid(), nullable=True))
    op.add_column("workspace_tasks", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("workspace_tasks", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_workspace_tasks_reviewed_by_profiles",
        "workspace_tasks", "profiles",
        ["reviewed_by"], ["id"],
        ondelete="SET NULL",
    )

    # -- task_completions: multi-photo arrays --
    op.add_column(
        "task_completions",
        sa.Column("photos_before", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "task_completions",
        sa.Column("photos_after", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )

    # -- task_status enum: add 'pending_review' between in_progress and done --
    # PostgreSQL ALTER TYPE ADD VALUE must run outside a transaction.
    # Bind requires AUTOCOMMIT — use op.execute with autocommit_block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'pending_review' BEFORE 'done'")

    # -- role_permissions: seed Workspace permissions ALL UNCHECKED by default.
    # Admin always implicit-has all, so we seed admin row for each.
    # Other roles will be empty — user said "Buat saja checklistnya, nanti saya yang atur".
    op.execute("""
        INSERT INTO role_permissions (role, permission, created_at, updated_at)
        VALUES
          ('admin', 'workspace:create_wo',     now(), now()),
          ('admin', 'workspace:execute_wo',    now(), now()),
          ('admin', 'workspace:review_wo',     now(), now()),
          ('admin', 'workspace:close_project', now(), now())
        ON CONFLICT DO NOTHING;
    """)

    # -- Supabase Storage bucket for WO completion photos --
    # Public-read so a plain <img src=...> tag works for previews.
    # Auth-write via RLS on storage.objects (Supabase default).
    op.execute("""
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'workspace-photos',
            'workspace-photos',
            true,
            8388608,  -- 8 MB per file
            ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
        )
        ON CONFLICT (id) DO NOTHING;
    """)
    # RLS: allow authenticated users to upload, anyone to read.
    op.execute("""
        DO $$
        BEGIN
            -- Read policy: public reads
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'workspace_photos_public_read'
            ) THEN
                CREATE POLICY "workspace_photos_public_read"
                  ON storage.objects FOR SELECT
                  USING (bucket_id = 'workspace-photos');
            END IF;
            -- Write policy: any authenticated user can upload
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'workspace_photos_authenticated_write'
            ) THEN
                CREATE POLICY "workspace_photos_authenticated_write"
                  ON storage.objects FOR INSERT
                  TO authenticated
                  WITH CHECK (bucket_id = 'workspace-photos');
            END IF;
            -- Delete policy: own files only
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'workspace_photos_owner_delete'
            ) THEN
                CREATE POLICY "workspace_photos_owner_delete"
                  ON storage.objects FOR DELETE
                  TO authenticated
                  USING (bucket_id = 'workspace-photos' AND owner = auth.uid());
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Drop storage policies & bucket (only if empty to avoid data loss)
    op.execute("""
        DROP POLICY IF EXISTS "workspace_photos_owner_delete" ON storage.objects;
        DROP POLICY IF EXISTS "workspace_photos_authenticated_write" ON storage.objects;
        DROP POLICY IF EXISTS "workspace_photos_public_read" ON storage.objects;
    """)
    # Leave bucket intact — dropping it without cleaning storage.objects would fail.

    # Remove permissions
    op.execute("""
        DELETE FROM role_permissions
        WHERE permission IN ('workspace:create_wo','workspace:execute_wo','workspace:review_wo','workspace:close_project');
    """)

    # Note: PostgreSQL can't easily DROP enum values — leave 'pending_review' as a no-op.
    # Any task with status='pending_review' would block enum removal anyway.

    op.drop_column("task_completions", "photos_after")
    op.drop_column("task_completions", "photos_before")

    op.drop_constraint("fk_workspace_tasks_reviewed_by_profiles", "workspace_tasks", type_="foreignkey")
    op.drop_column("workspace_tasks", "started_at")
    op.drop_column("workspace_tasks", "reviewed_at")
    op.drop_column("workspace_tasks", "reviewed_by")
    op.drop_column("workspace_tasks", "review_notes")
    op.drop_column("workspace_tasks", "estimated_days")
    op.drop_column("workspace_tasks", "location")
    op.drop_column("workspace_tasks", "description")

    op.drop_index("uq_workspace_projects_rpo_number", table_name="workspace_projects")
    op.drop_column("workspace_projects", "rpo_number")
