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

    __table_args__ = (
        Index("idx_scada_perspectives_owner_id", "owner_id"),
        # At most one default perspective per user
        Index(
            "uq_scada_perspectives_owner_default",
            "owner_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
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

    # "simulator" today; "vnet" once the Wecon adapter exists. The sampler
    # dispatches on this value (see backend/app/services/historian.py).
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="simulator"
    )
    # Grouping key: simulator device ("SIM-01") or V-Box serial number later.
    device_key: Mapped[str] = mapped_column(String(120), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, server_default="")
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    # Simulator: {preset, base, amplitude, period_s, noise, decimals}
    # V-Net later: monitor-point id + whatever Wecon's API needs.
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
