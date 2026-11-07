"""add_roles_and_doc_sequences

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-05-17 00:00:00.000000

Changes:
  - Add new AppRole values: procurement, engineer_civil, safety_man, warehouse_manager
  - Create document_sequences table (global counter per doc_type)
  - Seed known doc_types with current_number = 0
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision = "i3j4k5l6m7n8"
down_revision = "h2i3j4k5l6m7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── New AppRole enum values ────────────────────────────────────────────────
    # In PostgreSQL, ALTER TYPE ... ADD VALUE cannot run inside an ongoing transaction
    # if the new enum values are used in subsequent queries within the same connection.
    # Use autocommit_block() so the values are committed immediately to the catalog.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'procurement'")
        op.execute("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'engineer_civil'")
        op.execute("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'safety_man'")
        op.execute("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'warehouse_manager'")

    # ── document_sequences table ───────────────────────────────────────────────
    op.create_table(
        "document_sequences",
        sa.Column("doc_type", sa.String(20), nullable=False),
        sa.Column("current_number", sa.Integer(), nullable=False, server_default="0"),
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
        sa.PrimaryKeyConstraint("doc_type"),
    )

    # Seed all known doc_types at 0 — admin will set actual starting numbers
    op.execute("""
        INSERT INTO document_sequences (doc_type, current_number) VALUES
        ('Q', 0),
        ('DRW', 0),
        ('INV', 0),
        ('PO', 0),
        ('SPK', 0),
        ('RFP', 0),
        ('RPT', 0),
        ('SPEC', 0),
        ('OTHER', 0)
        ON CONFLICT (doc_type) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("document_sequences")
    # Note: PostgreSQL does not support DROP VALUE from enum — manual rollback needed for roles
