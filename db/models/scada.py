"""R-Net (Cloud SCADA) models — streams, perspectives, historian tags/samples.

`scada_streams` holds HLS stream sources (MediaMTX behind Cloudflare Tunnel).
`scada_perspectives` holds each user's saved panel layouts; the JSONB `layout`
follows the contract {"version": 1, "panels": [...]} and is validated by
Pydantic schemas in `backend/app/schemas/scada.py` before every save.
`scada_tags` + `scada_samples` form the data historian: a tag is one measured
quantity (source "simulator" now, "vnet" once Wecon answers land), a sample is
one (tag, minute, value) row written by the sampler loop.
"""

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class ScadaStream(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "scada_streams"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Full HLS playlist URL, e.g. https://scada-stream.example.com/scada/index.m3u8
    hls_url: Mapped[str] = mapped_column(Text, nullable=False)
    # MediaMTX read-only credentials; the browser player sends them as an
    # `Authorization: Basic` header via hls.js xhrSetup (query params are NOT
    # accepted for HLS reads by MediaMTX ≥1.12).
    read_user: Mapped[str | None] = mapped_column(String(64), nullable=True)
    read_pass: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    # Video-wall support: one OBS output can carry an R×C mosaic of cameras.
    # Each cell is an addressable "channel"; the browser crops the single decoded
    # stream into cells (no server-side splitting). channel_start is the global
    # number of cell 0, so a 3×3 stream starting at 1 owns channels 1..9.
    mosaic_rows: Mapped[int] = mapped_column(
        Integer, server_default="1", nullable=False
    )
    mosaic_cols: Mapped[int] = mapped_column(
        Integer, server_default="1", nullable=False
    )
    channel_start: Mapped[int] = mapped_column(
        Integer, server_default="1", nullable=False
    )


class ScadaChannel(UUIDMixin, TimestampMixin, Base):
    """One TV-style channel — the single addressable unit shown on the Monitor
    wall. A channel binds a number + nickname to ONE source definition:
    kind "video" (a stream, optionally one mosaic cell), "web" (embedded page),
    or a historian visual ("chart"/"table"/"gauge"/"bar"/"alarm"/"activity").
    Layouts reference channels by id; the source is defined once, here."""

    __tablename__ = "scada_channels"

    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Kind-specific config, validated by backend/app/schemas/scada.py:
    #   video → {stream_id, cell?}   web → {url, zoom, offset_x, offset_y}
    #   chart/table/bar/alarm → {tag_ids, range, ...}   gauge → {tag_id, ...}
    config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )


class ScadaPerspective(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "scada_perspectives"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    layout: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{\"version\": 1, \"panels\": []}'::jsonb"),
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    # The single admin-published "default layout" every user starts from and can
    # reset to (Masalah D, opsi b). At most one row project-wide is published;
    # only scada:manage holders can set it. A fresh user's bootstrap copies this
    # layout instead of the generic per-stream one.
    is_published: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    __table_args__ = (
        Index("idx_scada_perspectives_owner_id", "owner_id"),
        # At most one default perspective per user
        Index(
            "uq_scada_perspectives_owner_default",
            "owner_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        # At most one published (admin-default) perspective project-wide
        Index(
            "uq_scada_perspectives_published",
            "is_published",
            unique=True,
            postgresql_where=text("is_published"),
        ),
    )


class ScadaSite(UUIDMixin, TimestampMixin, Base):
    """One physical site/plant that publishes sensor data over MQTT.

    Holds the broker connection info for the standalone MQTT bridge
    (deploy/scada/mqtt-bridge/bridge.py). `mqtt_password` is read only by the
    bridge (service_role); it is never returned to the browser by the API
    (SiteOut exposes `has_password: bool` instead). `base_topic` is a hint for
    admins (e.g. "rnet/tanobel"); each tag stores its own full topic in
    `ScadaTag.config['mqtt_topic']`."""

    __tablename__ = "scada_sites"

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    mqtt_host: Mapped[str] = mapped_column(String(200), nullable=False)
    mqtt_port: Mapped[int] = mapped_column(
        Integer, server_default="1883", nullable=False
    )
    mqtt_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mqtt_password: Mapped[str | None] = mapped_column(String(200), nullable=True)
    base_topic: Mapped[str] = mapped_column(
        String(200), server_default="", nullable=False
    )


class ScadaSheet(UUIDMixin, TimestampMixin, Base):
    """One "Tabel" in the Analisis workbench — the TDengine-supertable
    analogue: a named group of tags (rows) with its own column definitions."""

    __tablename__ = "scada_sheets"

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class ScadaTag(UUIDMixin, TimestampMixin, Base):
    """One measured quantity in the historian (e.g. 'Suhu Ruang Pompa') —
    the TDengine-subtable analogue: one row in its sheet."""

    __tablename__ = "scada_tags"

    # "simulator" (in-process sampler) or "mqtt" (written by the standalone
    # bridge from broker messages). The FastAPI sampler dispatches on this and
    # skips "mqtt" tags — the bridge owns them (see app/services/historian.py).
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="simulator"
    )
    # Grouping key: simulator device ("SIM-01") or V-Box serial number later.
    device_key: Mapped[str] = mapped_column(String(120), nullable=False)
    # For source "mqtt": which site (broker) this tag is published from. NULL
    # for simulator tags. The tag's full MQTT topic lives in config['mqtt_topic'].
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scada_sites.id"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, server_default="")
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    # Simulator: {preset, base, amplitude, period_s, noise, decimals}
    # MQTT: {mqtt_topic, alarm_min?, alarm_max?}
    config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    # Which workbench sheet ("Tabel") this row lives in
    sheet_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_sheets.id"), nullable=False
    )
    # Values of manual metadata columns (kind text/number), keyed by column id
    # — the TDengine-TAGS analogue (Lokasi, Merek, SN, …)
    meta: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )


class ScadaSample(Base):
    """One historian data point. Composite PK (tag_id, ts): `ts` is aligned to
    the minute and inserts use ON CONFLICT DO NOTHING, so local-dev and Railway
    both sampling the same shared DB can never duplicate rows.

    RLS note: browser clients subscribe to this table via Supabase Realtime
    (Analisis workbench). A SELECT policy gates that path with the same
    role-permission matrix (scada:view); the backend connects as the table
    owner and is unaffected."""

    __tablename__ = "scada_samples"

    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)


class ScadaWorkbenchColumn(UUIDMixin, TimestampMixin, Base):
    """Custom column in a workbench sheet (shared team asset). Two kinds:
    "formula" (computed per row) and "text"/"number" (manual metadata typed
    per cell, values in ScadaTag.meta — the TDengine-TAGS analogue).

    `formula` is an opaque string evaluated ONLY client-side by the safe
    arithmetic parser in frontend features/scada/analysis/formula.ts — the
    backend never executes it. A broken formula shows #RUMUS! in cells,
    never a server error."""

    __tablename__ = "scada_workbench_columns"

    sheet_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_sheets.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="formula"
    )
    formula: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, server_default="")
    decimals: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
