"""add_folder_permissions_table

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-05-17 00:00:00.000000

Changes:
  - Create folder_permissions table (per folder_id + role: can_view, can_upload, can_download)
  - Seed from DEPT_ROLE_MAP defaults for all active root department folders
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "j4k5l6m7n8o9"
down_revision = "i3j4k5l6m7n8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "folder_permissions",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("folder_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM(name="app_role", create_type=False),
            nullable=False,
        ),
        sa.Column("can_view", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("can_upload", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_download", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["folder_id"], ["library_folders.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "folder_id", "role", name="uq_folder_permissions_folder_role"
        ),
    )
    op.create_index(
        "idx_folder_permissions_folder_id", "folder_permissions", ["folder_id"]
    )
    op.create_index(
        "idx_folder_permissions_role", "folder_permissions", ["role"]
    )

    # Seed from DEPT_ROLE_MAP: roles that own a department get can_view + can_upload + can_download
    op.execute("""
        INSERT INTO folder_permissions (id, folder_id, role, can_view, can_upload, can_download)
        SELECT
            gen_random_uuid(),
            lf.id,
            r.role::app_role,
            true,
            true,
            true
        FROM library_folders lf
        JOIN (
            VALUES
                ('purchasing_procurement', 'purchasing'),
                ('purchasing_procurement', 'procurement'),
                ('engineering', 'engineer_mechanical'),
                ('engineering', 'engineer_process'),
                ('engineering', 'engineer_electrical'),
                ('engineering', 'engineer_civil'),
                ('management', 'manager'),
                ('hse', 'safety_man'),
                ('field_operational', 'operational_manager'),
                ('warehouse', 'warehouse_manager'),
                ('finance', 'finance'),
                ('human_resources', 'human_resources'),
                ('accounting', 'accounting'),
                ('directorate', 'director')
        ) AS r(dept, role) ON lf.department = r.dept
        WHERE lf.parent_id IS NULL
        AND lf.is_active = true
        ON CONFLICT ON CONSTRAINT uq_folder_permissions_folder_role DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index("idx_folder_permissions_role", "folder_permissions")
    op.drop_index("idx_folder_permissions_folder_id", "folder_permissions")
    op.drop_table("folder_permissions")
