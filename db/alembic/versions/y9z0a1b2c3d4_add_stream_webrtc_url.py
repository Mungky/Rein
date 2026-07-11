"""scada_streams.webrtc_url — optional WHEP endpoint for sub-second playback

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-07-11 09:00:00.000000

Players try WebRTC (WHEP) first when set, falling back to LL-HLS — this is
what takes wall latency from ~4 s down to <1 s on the VPS relay.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "y9z0a1b2c3d4"
down_revision = "x8y9z0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scada_streams", sa.Column("webrtc_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("scada_streams", "webrtc_url")
