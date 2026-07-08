"""scada_perspectives.is_published — admin-published default layout (Masalah D)

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-07-08 10:00:00.000000

Adds a single project-wide "published" perspective that a scada:manage user
designates as the admin default. New users bootstrap a copy of it, and any
user can reset their layout back to it. A partial unique index guarantees at
most one published row at a time (mirrors the per-user is_default index).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "u5v6w7x8y9z0"
down_revision = "t4u5v6w7x8y9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scada_perspectives",
        sa.Column(
            "is_published",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
    )
    op.create_index(
        "uq_scada_perspectives_published",
        "scada_perspectives",
        ["is_published"],
        unique=True,
        postgresql_where=sa.text("is_published"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_scada_perspectives_published", table_name="scada_perspectives"
    )
    op.drop_column("scada_perspectives", "is_published")
