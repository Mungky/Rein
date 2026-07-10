"""Allow MULTIPLE admin-published default pages (multi-page bawaan admin)

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-10 20:00:00.000000

Previously at most ONE perspective project-wide could be published (partial
unique index). Admins now publish any number of pages; every user sees all of
them injected read-only — define 4 default pages, everyone gets 4 pages.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "x8y9z0a1b2c3"
down_revision = "w7x8y9z0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_scada_perspectives_published", table_name="scada_perspectives")


def downgrade() -> None:
    op.create_index(
        "uq_scada_perspectives_published",
        "scada_perspectives",
        ["is_published"],
        unique=True,
        postgresql_where=sa.text("is_published"),
    )
