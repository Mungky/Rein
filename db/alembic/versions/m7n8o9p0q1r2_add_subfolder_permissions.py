"""add_subfolder_permissions

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-05-22 00:00:00.000000

Adds can_create_folder, can_rename_folder, can_delete_folder columns to
folder_permissions so subfolder management can be controlled independently
from file permissions. Backfills can_create_folder from can_upload so roles
that previously could create subfolders retain that ability.
"""

import sqlalchemy as sa
from alembic import op

revision = "m7n8o9p0q1r2"
down_revision = "l6m7n8o9p0q1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folder_permissions",
        sa.Column("can_create_folder", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "folder_permissions",
        sa.Column("can_rename_folder", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "folder_permissions",
        sa.Column("can_delete_folder", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Backfill: roles that could previously create subfolders (via can_upload)
    # retain that ability.
    op.execute(
        "UPDATE folder_permissions SET can_create_folder = can_upload WHERE can_upload = true"
    )


def downgrade() -> None:
    op.drop_column("folder_permissions", "can_delete_folder")
    op.drop_column("folder_permissions", "can_rename_folder")
    op.drop_column("folder_permissions", "can_create_folder")