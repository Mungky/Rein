"""add dcc_activity_log table

Revision ID: f2a3b4c5d6e7
Revises: 178dedd5c04f
Create Date: 2026-05-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = '178dedd5c04f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dcc_activity_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column(
            'action',
            sa.Enum('upload', 'access_request', name='dcc_action', create_constraint=True),
            nullable=False,
        ),
        sa.Column('detail', sa.String(length=500), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_dcc_activity_log_profile_id', 'dcc_activity_log', ['profile_id'], unique=False)
    op.create_index('ix_dcc_activity_log_created_at', 'dcc_activity_log', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_dcc_activity_log_created_at', table_name='dcc_activity_log')
    op.drop_index('ix_dcc_activity_log_profile_id', table_name='dcc_activity_log')
    op.drop_table('dcc_activity_log')
    op.execute("DROP TYPE IF EXISTS dcc_action")
