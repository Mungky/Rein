"""add note and doc_sequence to documents

Revision ID: a1b2c3d4e5f6
Revises: f2a3b4c5d6e7
Create Date: 2026-05-10 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('documents', sa.Column('doc_sequence', sa.Integer(), nullable=True))
    op.add_column('documents', sa.Column('note', sa.String(length=200), nullable=True))
    op.create_index('ix_documents_doc_type_seq', 'documents', ['doc_type', 'doc_sequence'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_documents_doc_type_seq', table_name='documents')
    op.drop_column('documents', 'note')
    op.drop_column('documents', 'doc_sequence')
