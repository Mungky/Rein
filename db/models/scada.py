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
    Date,
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
    """One "Screen" source a channel can show — despite the table name it now
    holds THREE kinds (`source_type`): "stream" (HLS/WebRTC video via MediaMTX),
    "web" (an embedded page/HMI), and "vnc" (view-only noVNC mirror of a PC).
    A channel of kind "screen" references one of these by id and crops it; the
    old mosaic columns are gone (cropping is per-channel now)."""

    __tablename__ = "scada_streams"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # "stream" | "web" | "vnc" — which set of fields below is meaningful.
    source_type: Mapped[str] = mapped_column(
        String(10), server_default="stream", nullable=False
    )
    # --- stream fields ---
    # HLS playlist URL, e.g. https://scada-stream.example.com/scada/index.m3u8
    # (nullable now: web/vnc sources leave it empty).
    hls_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional WebRTC (WHEP) endpoint for sub-second playback, e.g.
    # https://webrtc.example.com/server/whep — players try it first and fall
    # back to LL-HLS automatically (viewers behind UDP-blocking networks).
    webrtc_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # MediaMTX read-only credentials; the browser player sends them as an
    # `Authorization: Basic` header via hls.js xhrSetup (query params are NOT
    # accepted for HLS reads by MediaMTX ≥1.12).
    read_user: Mapped[str | None] = mapped_column(String(64), nullable=True)
    read_pass: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # --- web / vnc fields ---
    # web: the page URL; vnc: the noVNC/websockify endpoint (https→wss client-side)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # vnc VIEW-ONLY password (readable by every scada:view user, like read_pass —
    # the viewer's browser connects directly and needs it).
    secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )


class ScadaChannel(UUIDMixin, TimestampMixin, Base):
    """One TV-style channel — the single addressable unit shown on the Monitor
    wall. A channel binds a number + nickname to ONE source definition:
    kind "screen" (references a Source — stream/web/vnc — by id, with an
    optional crop) or a historian visual
    ("chart"/"table"/"gauge"/"bar"/"alarm"/"activity").
    Layouts reference channels by id; the source is defined once, here."""

    __tablename__ = "scada_channels"

    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Kind-specific config, validated by backend/app/schemas/scada.py:
    #   screen → {stream_id, crop?, src_w?, src_h?}   gauge → {tag_id, ...}
    #   chart/table/bar/alarm → {tag_ids, range, ...}
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
    # Admin-published "default pages" (Masalah D). Any NUMBER of perspectives
    # may be published; every user sees each of them injected read-only into
    # their page list — publish 4 pages, everyone has those 4 pages. Only
    # scada:manage holders can publish/unpublish.
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
    """One HISTORIAN data point (store_enabled tags only) — the long-retention
    lane. Rows accumulate per tag until its cycle reaches `store_months`, then
    the archiver exports the whole cycle to Google Drive and deletes them,
    resetting `config.store_cycle_start` (app/services/archiver.py). Ring-mode
    (store off) values live in `scada_ring` instead.

    Composite PK (tag_id, ts): inserts use ON CONFLICT DO NOTHING, so local-dev
    and the server both sampling the same shared DB can never duplicate rows.

    RLS note: a SELECT policy gates direct access with the role-permission
    matrix (scada:view); the backend connects as the table owner and is
    unaffected. Reads go through the `scada_samples_all` view (ring ∪ historian);
    writers/pruners target the physical tables."""

    __tablename__ = "scada_samples"
    # ix_scada_samples_ts (migration i9j0k1l2m3n4, audit D-2): the PK's leading
    # column is tag_id, so any sweep filtering on TIME alone cannot use it and
    # falls back to a full table scan (audit D-2).
    __table_args__ = (Index("ix_scada_samples_ts", "ts"),)

    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)


class ScadaRaw(Base):
    """RAW sensor values, PARTITIONED BY DAY — the 24-hour lane.

    Retention is DROP PARTITION, not DELETE (audit D-1). Measured at pilot
    scale (300 tags, 3.28 M rows/day): dropping a day takes 109 ms and leaves
    zero dead tuples, where the equivalent DELETE took 2 632 ms and left 3.28 M
    of them. That dead-tuple debt is what bloated scada_ring_pkey to ~50× its
    natural size on the live database.

    Consequence of daily drawers: a row lives 24–48 h rather than exactly 24 h,
    because a day can only be dropped once ALL of it has aged out. Accepted
    deliberately — `scada_settings.ring_window_h` now means "at least this
    long". Hourly partitions would tighten it to 24–25 h at the cost of ~25
    live partitions.

    INDEXES — note this differs from ScadaRollup1m on purpose. PK (tag_id, ts)
    plus a BRIN on ts, rather than a second btree. A partitioned table only
    needs the partition key to be PART OF the unique constraint, not its first
    column, so this is legal — and it measured 416 MB/day against 623 MB for
    the two-btree layout at identical query speed (the BRIN is 40 kB where the
    btree was 157 MB). BRIN depends on rows arriving in time order, which the
    bridge does; a writer that inserted out of order would make it useless.

    DDL lives in migration k1l2m3n4o5p6. Never create_all() it."""

    __tablename__ = "scada_raw"

    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scada_sites.id", ondelete="SET NULL"), nullable=True
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)


class ScadaSampleAll(Base):
    """READ-ONLY union view `scada_samples_all = scada_raw ∪ scada_samples`.

    Every read path selects from this view so a tag's data is found whether it
    is in the 24-hour raw lane or the historian lane, without each endpoint
    knowing which physical table holds it. That indirection is what let
    scada_ring be replaced by scada_raw and then dropped without touching a
    single endpoint (migrations k1l2m3n4o5p6, m3n4o5p6q7r8).

    Reads that only need a minute's resolution or coarser should prefer
    ScadaRollup1m — this view is for raw detail. Created/maintained by Alembic
    raw SQL (no ORM DDL). NEVER write through this model — writers use ScadaRaw
    / ScadaSample directly."""

    __tablename__ = "scada_samples_all"

    tag_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)


class ScadaRollup1m(Base):
    """PER-MINUTE SUMMARY of the raw lanes — one row per (minute, tag).

    Layer 3 of docs/ARSITEKTUR-DATA.md §2.3: raw rows answer "what exactly
    happened in the last 24 h", these answer everything older. Written once a
    minute by app/services/rollup.py from the minute that just closed; read by
    the chart/gauge/sparkline endpoints instead of them re-aggregating raw rows
    on every request.

    `n` is the number of raw values that fell in the minute. A silent minute
    produces NO row (gaps stay gaps — never invent a value), and a stuttering
    sensor produces a row with a small `n`, so "quiet" stays distinguishable
    from "broken" without storing the gaps.

    `site_id` is denormalised from the tag on purpose: raw rows carry only
    (tag, time, value), which is why "everything for plant X" needs a detour
    through scada_tags (audit D-1). Summary rows are written once and read for
    a month, so the plant is stamped in at write time.

    PARTITIONED BY RANGE (ts), one partition per month — retention is
    DROP PARTITION, not DELETE (§2.4). Partitions are created on demand by the
    rollup task. Postgres requires the partition key in every unique
    constraint, hence PK (ts, tag_id) rather than (tag_id, ts); the separate
    (tag_id, ts) index covers per-tag lookups.

    DDL lives in migration j0k1l2m3n4o5 (partitioning and per-partition DDL are
    beyond ORM metadata) — this model exists so queries can be written in
    SQLAlchemy. Never create_all() it."""

    __tablename__ = "scada_rollup_1m"
    __table_args__ = (
        Index("ix_scada_rollup_1m_tag_ts", "tag_id", "ts"),
        Index("ix_scada_rollup_1m_site_ts", "site_id", "ts"),
    )

    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), primary_key=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scada_sites.id", ondelete="SET NULL"), nullable=True
    )
    avg: Mapped[float] = mapped_column(Float, nullable=False)
    min: Mapped[float] = mapped_column(Float, nullable=False)
    max: Mapped[float] = mapped_column(Float, nullable=False)
    n: Mapped[int] = mapped_column(Integer, nullable=False)


class ScadaTagLatest(Base):
    """Last-known value per tag — the fast "live" lane, decoupled from history.

    UPSERTed at ~1 s cadence by the MQTT bridge (mqtt tags) and by the
    historian latest_loop (simulator tags). Browser clients subscribe via
    Supabase Realtime for live numbers; the alarm engine polls it for cheap
    threshold + sensor-silence evaluation. History stays in scada_ring /
    scada_samples, written only per each tag's sampling-level bucket."""

    __tablename__ = "scada_tag_latest"

    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class ScadaBridgeStatus(Base):
    """Heartbeat bridge MQTT per site — bahan alarm kesehatan sistem.

    Di-UPSERT setiap ~15 s oleh bridge di PC site: `connected` = status
    koneksi ke broker site itu, `changed_at` = kapan status terakhir
    berubah, `updated_at` = detak jantung. Health monitor backend
    membacanya: updated_at basi ⇒ bridge mati/PC padam; connected=false
    lama ⇒ broker tak terjangkau."""

    __tablename__ = "scada_bridge_status"

    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_sites.id", ondelete="CASCADE"), primary_key=True
    )
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False)
    changed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class ScadaAlarmEvent(UUIDMixin, TimestampMixin, Base):
    """One alarm occurrence — permanent history, rows are never deleted.

    Lifecycle: opened by the alarm engine (cleared_at NULL = active), optionally
    acknowledged by a user (ack_*), cleared by the engine when the value returns
    in bounds / data resumes. The partial unique index uq_scada_alarm_open is
    the dedup mechanism: at most one OPEN event per (tag, kind); the engine
    inserts with ON CONFLICT DO NOTHING so restarts and a second backend
    sharing the DB can never double-open. `notified_at` is the atomic claim
    marker for external notifications (email/Telegram) — only the engine that
    wins the claim UPDATE sends."""

    __tablename__ = "scada_alarm_events"

    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), nullable=False
    )
    # "high" (value > alarm_max) | "low" (value < alarm_min) | "silent"
    # (no data for > 3× the tag's storage interval)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    triggered_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Value that crossed the threshold (NULL for "silent")
    trigger_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The alarm_max/alarm_min that was crossed (NULL for "silent")
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    cleared_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ack_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ack_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot of the acknowledger's display name — history must survive
    # profile deletion.
    ack_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_scada_alarm_open",
            "tag_id",
            "kind",
            unique=True,
            postgresql_where=text("cleared_at IS NULL"),
        ),
        Index("idx_scada_alarm_events_tag_triggered", "tag_id", "triggered_at"),
        Index(
            "idx_scada_alarm_events_active",
            "triggered_at",
            postgresql_where=text("cleared_at IS NULL"),
        ),
    )


class ScadaAlarmSettings(Base):
    """Single-row (id=1) notification settings, editable from the Data tab.

    Secrets stay OUT of this table: the Telegram bot token lives in the
    backend env (TELEGRAM_BOT_TOKEN) — only operator-tunable knobs are here."""

    __tablename__ = "scada_alarm_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email_enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    # Comma-separated recipient addresses
    email_recipients: Mapped[str] = mapped_column(
        Text, server_default="", nullable=False
    )
    telegram_enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    telegram_chat_id: Mapped[str] = mapped_column(
        String(64), server_default="", nullable=False
    )
    # Minimum minutes between external re-notifications of the same (tag, kind)
    cooldown_min: Mapped[int] = mapped_column(
        Integer, server_default="15", nullable=False
    )
    sound_enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )


class ScadaSettings(Base):
    """Single-row (id=1) R-Net global settings, editable from the admin panel.

    Holds the 4 admin-tunable SAMPLING LEVEL durations (a tag picks one of
    fastest/fast/slow/slowest; this maps the name → seconds) plus the retention
    knobs. Kept out of scada_alarm_settings because it governs storage/sampling,
    not notifications. The bridge, historian, alarm engine and archiver all read
    this row (each caches it per loop)."""

    __tablename__ = "scada_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Sampling level → seconds. Defaults: Fastest 2 s … Slowest 60 s.
    level_fastest_s: Mapped[int] = mapped_column(
        Integer, server_default="2", nullable=False
    )
    level_fast_s: Mapped[int] = mapped_column(
        Integer, server_default="5", nullable=False
    )
    level_slow_s: Mapped[int] = mapped_column(
        Integer, server_default="30", nullable=False
    )
    level_slowest_s: Mapped[int] = mapped_column(
        Integer, server_default="60", nullable=False
    )
    # Ring-mode retention window (store off): rows older than this are pruned.
    ring_window_h: Mapped[int] = mapped_column(
        Integer, server_default="24", nullable=False
    )
    # Historian cycle length (store on): after this many months a tag's data is
    # archived to Drive and reset from 0.
    store_months: Mapped[int] = mapped_column(
        Integer, server_default="1", nullable=False
    )
    # How many days before a reset the "expiring" reminder alarm fires.
    reset_warn_days: Mapped[int] = mapped_column(
        Integer, server_default="7", nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class ScadaTagArchive(Base):
    """Ledger of archived HISTORIAN cycles, one row per (tag, cycle). The
    archiver (app/services/archiver.py) INSERTs the (tag_id, cycle_start) row
    FIRST as an atomic claim, uploads the cycle's samples to Google Drive as
    one .xlsx, fills drive_file_id, THEN deletes the tag's samples and resets
    its cycle. No completed row here → no deletion (no data loss)."""

    __tablename__ = "scada_tag_archives"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scada_tags.id", ondelete="CASCADE"), nullable=False
    )
    # Start of the archived cycle (= the tag's store_cycle_start at archive time)
    cycle_start: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    cycle_end: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # NULL while the upload is in flight; set = archive completed
    drive_file_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    web_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )

    __table_args__ = (
        # Atomic claim: at most one archive row per (tag, cycle)
        Index(
            "uq_scada_tag_archives_tag_cycle",
            "tag_id",
            "cycle_start",
            unique=True,
        ),
    )


class ScadaArchive(Base):
    """DEPRECATED (monthly rolling model, replaced by ScadaTagArchive). Kept so
    historical rows / old Drive links survive; no longer written. Ledger of
    archived months — the month row was INSERTed as an atomic claim, xlsx sent
    to Drive, then that month's samples deleted."""

    __tablename__ = "scada_archives"

    # First day of the archived month (UTC)
    month: Mapped[datetime.date] = mapped_column(Date, primary_key=True)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    drive_file_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    web_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


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
