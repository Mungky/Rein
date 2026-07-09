"""scada_streams mosaic grid + channel_start (Video Wall)

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-08 11:30:00.000000

A stream can be an R×C mosaic (one OBS output carrying many cameras). Each cell
is an addressable channel; the browser crops the single decoded stream into
cells. channel_start is the global number of cell 0. Defaults (1×1, start 1)
mean existing streams behave exactly as before (whole frame = channel 1).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "v6w7x8y9z0a1"
down_revision = "u5v6w7x8y9z0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scada_streams",
        sa.Column("mosaic_rows", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "scada_streams",
        sa.Column("mosaic_cols", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "scada_streams",
        sa.Column("channel_start", sa.Integer(), server_default="1", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("scada_streams", "channel_start")
    op.drop_column("scada_streams", "mosaic_cols")
    op.drop_column("scada_streams", "mosaic_rows")
