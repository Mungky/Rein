"""add_granular_folder_permissions

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-05-19 00:00:00.000000

Adds can_rename, can_delete, can_move columns to folder_permissions so admin
can grant these capabilities granularly per folder + role. All default false
so admin must explicitly opt-in via the dashboard.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision = "k5l6m7n8o9p0"
down_revision = "j4k5l6m7n8o9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folder_permissions",
        sa.Column("can_rename", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "folder_permissions",
        sa.Column("can_delete", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "folder_permissions",
        sa.Column("can_move", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Cleanup: unused 'sidebar:*' permissions never gated anything — purge them
    # so the admin UI matrix stays clean.
    op.execute(
        "DELETE FROM role_permissions "
        "WHERE permission IN ('sidebar:crm', 'sidebar:projects', "
        "'sidebar:finance', 'sidebar:hr')"
    )


def downgrade() -> None:
    op.drop_column("folder_permissions", "can_move")
    op.drop_column("folder_permissions", "can_delete")
    op.drop_column("folder_permissions", "can_rename")
    # No restore for purged sidebar:* rows (they were dead permissions)
