"""scada_streams becomes a unified "Screen" source (stream/web/vnc); drop mosaic

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-07-16 12:00:00.000000

The old split — streams in their own table, web/vnc addresses typed straight
into a channel's config — is unified: scada_streams now carries a
`source_type` ("stream" | "web" | "vnc") plus `url`/`secret` for the web/vnc
kinds. Channels of the new kind "screen" reference a source by id and crop it,
so the mosaic columns (superseded by per-channel crop) are removed.

`hls_url` becomes nullable (web/vnc sources leave it empty). Existing rows keep
source_type "stream" and their hls_url — no video source breaks. Any leftover
channels of the old kinds "video"/"web"/"vnc" are updated to kind "screen"
where they already reference a stream_id; the rest are left for the operator to
recreate (per the "reset saja" decision — only video channels can be salvaged
automatically since web/vnc had no source row).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "z0a1b2c3d4e5"
down_revision = "y9z0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New unified-source columns
    op.add_column(
        "scada_streams",
        sa.Column(
            "source_type",
            sa.String(length=10),
            server_default="stream",
            nullable=False,
        ),
    )
    op.add_column("scada_streams", sa.Column("url", sa.Text(), nullable=True))
    op.add_column(
        "scada_streams", sa.Column("secret", sa.String(length=128), nullable=True)
    )

    # web/vnc sources have no HLS playlist
    op.alter_column("scada_streams", "hls_url", existing_type=sa.Text(), nullable=True)

    # Mosaic is replaced by per-channel crop
    op.drop_column("scada_streams", "mosaic_rows")
    op.drop_column("scada_streams", "mosaic_cols")
    op.drop_column("scada_streams", "channel_start")

    # Salvage old "video" channels: same config shape, just rename the kind.
    # (web/vnc channels stored their address inline with no source row, so they
    # can't be auto-migrated — recreate them via the new UI.)
    op.execute("UPDATE scada_channels SET kind = 'screen' WHERE kind = 'video'")


def downgrade() -> None:
    op.execute("UPDATE scada_channels SET kind = 'video' WHERE kind = 'screen'")
    op.add_column(
        "scada_streams",
        sa.Column("channel_start", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "scada_streams",
        sa.Column("mosaic_cols", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "scada_streams",
        sa.Column("mosaic_rows", sa.Integer(), server_default="1", nullable=False),
    )
    # Restore NOT NULL on hls_url (fill blanks first so the constraint holds)
    op.execute("UPDATE scada_streams SET hls_url = '' WHERE hls_url IS NULL")
    op.alter_column(
        "scada_streams", "hls_url", existing_type=sa.Text(), nullable=False
    )
    op.drop_column("scada_streams", "secret")
    op.drop_column("scada_streams", "url")
    op.drop_column("scada_streams", "source_type")
