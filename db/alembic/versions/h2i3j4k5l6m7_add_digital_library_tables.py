"""add_digital_library_tables

Revision ID: h2i3j4k5l6m7
Revises: g9h1i2j3k4l5
Create Date: 2026-05-16 00:00:00.000000

Adds the Digital Library system:
  - library_folders  — department/project/client hierarchy
  - library_files    — file metadata + audit lifecycle
  - audit_jobs       — 4-layer per-file audit tracking
  - view_requests    — 5-minute Pustakawan approval flow
  - library_audit_log — full admin activity trail
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "h2i3j4k5l6m7"
down_revision = "g9h1i2j3k4l5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── folder_type enum ───────────────────────────────────────────────────────
    op.execute(
        "CREATE TYPE folder_type AS ENUM ('department', 'project', 'client', 'custom')"
    )

    # ── library_file_status enum ───────────────────────────────────────────────
    op.execute(
        "CREATE TYPE library_file_status AS ENUM "
        "('uploading', 'in_audit', 'passed', 'failed', 'archived')"
    )

    # ── library_folders ────────────────────────────────────────────────────────
    op.create_table(
        "library_folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("department", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "folder_type",
            postgresql.ENUM(
                "department", "project", "client", "custom",
                name="folder_type", create_type=False,
            ),
            nullable=False,
            server_default="custom",
        ),
        sa.Column("path", sa.String(1000), nullable=False),
        sa.Column("gdrive_folder_id", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by"], ["profiles.id"]),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["library_folders.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_library_folders_department", "library_folders", ["department"])
    op.create_index("idx_library_folders_parent_id", "library_folders", ["parent_id"])

    # ── library_files ──────────────────────────────────────────────────────────
    op.create_table(
        "library_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("original_name", sa.String(500), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=True),
        sa.Column("doc_type", sa.String(10), nullable=True),
        sa.Column("doc_number", sa.String(50), nullable=True),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("client_code", sa.String(20), nullable=True),
        sa.Column("client_name", sa.String(255), nullable=True),
        sa.Column("project_code", sa.String(20), nullable=True),
        sa.Column("project_name", sa.String(255), nullable=True),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("gdrive_file_id", sa.String(100), nullable=True),
        sa.Column("gdrive_folder_id", sa.String(100), nullable=True),
        sa.Column("gdrive_web_link", sa.Text(), nullable=True),
        sa.Column(
            "upload_status",
            postgresql.ENUM(
                "uploading", "in_audit", "passed", "failed", "archived",
                name="library_file_status", create_type=False,
            ),
            nullable=False,
            server_default="uploading",
        ),
        sa.Column(
            "audit_results",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "proposal_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("uploader_id", sa.Uuid(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default="false", nullable=False),
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
        sa.ForeignKeyConstraint(["folder_id"], ["library_folders.id"]),
        sa.ForeignKeyConstraint(["uploader_id"], ["profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("doc_number"),
    )
    op.create_index("idx_library_files_folder_id", "library_files", ["folder_id"])
    op.create_index("idx_library_files_uploader_id", "library_files", ["uploader_id"])
    op.create_index("idx_library_files_upload_status", "library_files", ["upload_status"])
    op.create_index("idx_library_files_content_hash", "library_files", ["content_hash"])

    # ── audit_jobs ─────────────────────────────────────────────────────────────
    op.create_table(
        "audit_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("layer", sa.Integer(), nullable=False),
        sa.Column("layer_name", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["file_id"], ["library_files.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_audit_jobs_file_id", "audit_jobs", ["file_id"])
    op.create_index("idx_audit_jobs_status", "audit_jobs", ["status"])

    # ── view_requests ──────────────────────────────────────────────────────────
    op.create_table(
        "view_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("requester_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("approve_token", sa.String(100), nullable=False),
        sa.Column("approved_by", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("temp_link", sa.Text(), nullable=True),
        sa.Column("link_expires_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["file_id"], ["library_files.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["requester_id"], ["profiles.id"]),
        sa.ForeignKeyConstraint(["approved_by"], ["profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("approve_token"),
    )
    op.create_index("idx_view_requests_file_id", "view_requests", ["file_id"])
    op.create_index("idx_view_requests_requester_id", "view_requests", ["requester_id"])
    op.create_index("idx_view_requests_status", "view_requests", ["status"])
    op.create_index("idx_view_requests_token", "view_requests", ["approve_token"])

    # ── library_audit_log ──────────────────────────────────────────────────────
    op.create_table(
        "library_audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("target_type", sa.String(30), nullable=True),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
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
        sa.ForeignKeyConstraint(["actor_id"], ["profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_library_audit_log_actor_id", "library_audit_log", ["actor_id"])
    op.create_index("idx_library_audit_log_action", "library_audit_log", ["action"])
    op.create_index(
        "idx_library_audit_log_created_at", "library_audit_log", ["created_at"]
    )

    # ── Seed default department root folders ───────────────────────────────────
    op.execute("""
        INSERT INTO library_folders (id, department, name, folder_type, path, is_active, created_at, updated_at)
        VALUES
            (gen_random_uuid(), 'finance',     'Keuangan',   'department', 'Keuangan',   true, now(), now()),
            (gen_random_uuid(), 'engineering', 'Teknik',     'department', 'Teknik',     true, now(), now()),
            (gen_random_uuid(), 'hr',          'SDM',        'department', 'SDM',        true, now(), now()),
            (gen_random_uuid(), 'purchasing',  'Pengadaan',  'department', 'Pengadaan',  true, now(), now()),
            (gen_random_uuid(), 'management',  'Manajemen',  'department', 'Manajemen',  true, now(), now())
    """)


def downgrade() -> None:
    op.drop_table("library_audit_log")
    op.drop_index("idx_view_requests_token", table_name="view_requests")
    op.drop_index("idx_view_requests_status", table_name="view_requests")
    op.drop_index("idx_view_requests_requester_id", table_name="view_requests")
    op.drop_index("idx_view_requests_file_id", table_name="view_requests")
    op.drop_table("view_requests")
    op.drop_index("idx_audit_jobs_status", table_name="audit_jobs")
    op.drop_index("idx_audit_jobs_file_id", table_name="audit_jobs")
    op.drop_table("audit_jobs")
    op.drop_index("idx_library_files_content_hash", table_name="library_files")
    op.drop_index("idx_library_files_upload_status", table_name="library_files")
    op.drop_index("idx_library_files_uploader_id", table_name="library_files")
    op.drop_index("idx_library_files_folder_id", table_name="library_files")
    op.drop_table("library_files")
    op.drop_index("idx_library_folders_parent_id", table_name="library_folders")
    op.drop_index("idx_library_folders_department", table_name="library_folders")
    op.drop_table("library_folders")
    op.execute("DROP TYPE IF EXISTS library_file_status")
    op.execute("DROP TYPE IF EXISTS folder_type")
