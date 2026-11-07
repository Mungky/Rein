"""add indexing and cancelled to upload_status

Revision ID: e1b2f3a4c5d6
Revises: d8f4a1b2c905
Create Date: 2026-05-09

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision = 'e1b2f3a4c5d6'
down_revision = 'd8f4a1b2c905'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE upload_status ADD VALUE IF NOT EXISTS 'indexing'")
        op.execute("ALTER TYPE upload_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values easily
    # This is a one-way migration
    pass