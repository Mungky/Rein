"""historian: add scada_tags and scada_samples tables

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-07-05 12:00:00.000000

R-Net data historian, simulator-first (V-Net/Wecon adapter plugs in later):
  - scada_tags — one measured quantity (source "simulator" | "vnet")
  - scada_samples — time-series rows, composite PK (tag_id, ts); ts is aligned
    to the minute and writers use ON CONFLICT DO NOTHING, so multiple samplers
    against the shared DB stay idempotent

No role_permissions rows are seeded — the historian reuses the existing
scada:view / scada:manage keys.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "p0q1r2s3t4u5"
down_revision = "o9p0q1r2s3t4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scada_tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "source", sa.String(length=20), server_default="simulator", nullable=False
        ),
        sa.Column("device_key", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("unit", sa.String(length=30), server_default="", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
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
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "scada_samples",
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["scada_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tag_id", "ts"),
    )


def downgrade() -> None:
    op.drop_table("scada_samples")
    op.drop_table("scada_tags")
