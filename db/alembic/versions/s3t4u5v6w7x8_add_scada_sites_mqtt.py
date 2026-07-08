"""scada_sites (MQTT brokers) + scada_tags.site_id

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-07-07 10:00:00.000000

MQTT ingestion: real sensor data flows in via a standalone bridge that writes
into the SAME scada_samples table the dashboards already read. This migration
only adds:
  - scada_sites — one physical plant + its MQTT broker connection info
    (mqtt_password read only by the bridge; never returned to the browser)
  - scada_tags.site_id — nullable FK; set for source "mqtt", NULL for simulator

scada_samples is intentionally left untouched — the bridge caches the latest
value per topic and inserts one minute-aligned row per tag (ON CONFLICT DO
NOTHING), exactly like the simulator sampler.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scada_sites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("mqtt_host", sa.String(length=200), nullable=False),
        sa.Column("mqtt_port", sa.Integer(), server_default="1883", nullable=False),
        sa.Column("mqtt_username", sa.String(length=120), nullable=True),
        sa.Column("mqtt_password", sa.String(length=200), nullable=True),
        sa.Column("base_topic", sa.String(length=200), server_default="", nullable=False),
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

    op.add_column("scada_tags", sa.Column("site_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_scada_tags_site_id",
        "scada_tags",
        "scada_sites",
        ["site_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_scada_tags_site_id", "scada_tags", type_="foreignkey")
    op.drop_column("scada_tags", "site_id")
    op.drop_table("scada_sites")
