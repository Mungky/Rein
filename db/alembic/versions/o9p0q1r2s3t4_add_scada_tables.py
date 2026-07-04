"""scada: add scada_streams and scada_perspectives tables

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-07-04 10:00:00.000000

Adds:
  - scada_streams — HLS stream sources (MediaMTX behind Cloudflare Tunnel)
  - scada_perspectives — per-user saved panel layouts (JSONB), with a partial
    unique index so each user has at most one default perspective

No role_permissions rows are seeded (same convention as workspace WO perms):
new scada:* permissions start unchecked; admin passes automatically and grants
other roles via the admin matrix UI.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "o9p0q1r2s3t4"
down_revision = "n8o9p0q1r2s3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scada_streams",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("hls_url", sa.Text(), nullable=False),
        sa.Column("read_user", sa.String(length=64), nullable=True),
        sa.Column("read_pass", sa.String(length=128), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
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
        "scada_perspectives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "layout",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{\"version\": 1, \"panels\": []}'::jsonb"),
            nullable=False,
        ),
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
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
        sa.ForeignKeyConstraint(["owner_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_scada_perspectives_owner_id",
        "scada_perspectives",
        ["owner_id"],
    )
    op.create_index(
        "uq_scada_perspectives_owner_default",
        "scada_perspectives",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("uq_scada_perspectives_owner_default", table_name="scada_perspectives")
    op.drop_index("idx_scada_perspectives_owner_id", table_name="scada_perspectives")
    op.drop_table("scada_perspectives")
    op.drop_table("scada_streams")
