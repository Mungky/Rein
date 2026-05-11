"""add_is_active_to_profiles

Revision ID: c7d3f8e2a1b9
Revises: a6c135352c84
Create Date: 2026-05-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c7d3f8e2a1b9'
down_revision = 'a6c135352c84'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'profiles',
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('profiles', 'is_active')