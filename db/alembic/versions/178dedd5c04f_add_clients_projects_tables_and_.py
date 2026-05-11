"""add clients_projects tables and proposal_ttl

Revision ID: 178dedd5c04f
Revises: e1b2f3a4c5d6
Create Date: 2026-05-10 11:11:21.265467

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '178dedd5c04f'
down_revision = 'e1b2f3a4c5d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('clients',
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('clients_projects',
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('client_id', sa.Uuid(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_index(op.f('ix_clients_projects_client_id'), 'clients_projects', ['client_id'], unique=False)
    op.add_column('upload_queue', sa.Column('proposal_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('upload_queue', 'proposal_expires_at')
    op.drop_index(op.f('ix_clients_projects_client_id'), table_name='clients_projects')
    op.drop_table('clients_projects')
    op.drop_table('clients')