"""Pydantic schemas for the SCADA Monitor module.

The perspective `layout` JSONB follows a versioned contract:
{"version": 1, "panels": [...]} — each panel is a discriminated union on
`type`. Implemented: "video" (Phase 1), "chart" / "table" / "gauge"
(historian, Phase 2). "alarm" is reserved. Unknown types are rejected at
save time so garbage can never be persisted.

Keep in sync with `frontend/src/features/scada/types.ts`.
"""

import uuid
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, model_validator


class PanelGrid(BaseModel):
    """Legacy (layout v1) react-grid-layout cell: 12-column grid coordinates."""

    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=100)


class PanelRect(BaseModel):
    """Layout v2 (OBS-style fixed canvas): absolute CANVAS-pixel rectangle.
    The whole canvas scales uniformly on every screen, so these never reflow."""

    x: float = Field(ge=0, le=7680)
    y: float = Field(ge=0, le=4320)
    w: float = Field(ge=16, le=7680)
    h: float = Field(ge=16, le=4320)


class CanvasSize(BaseModel):
    """Per-page canvas resolution (like an OBS scene), e.g. 1920×1080."""

    w: int = Field(ge=640, le=7680)
    h: int = Field(ge=360, le=4320)


class VideoPanelConfig(BaseModel):
    stream_id: uuid.UUID
    object_fit: Literal["contain", "cover"] = "contain"
    muted: bool = True


class VideoPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["video"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: VideoPanelConfig


ChartRange = Literal["1h", "6h", "24h", "7d", "30d"]


class ChartPanelConfig(BaseModel):
    tag_ids: list[uuid.UUID] = Field(min_length=1, max_length=4)
    range: ChartRange = "24h"
    show_minmax: bool = False


class ChartPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["chart"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ChartPanelConfig


class TablePanelConfig(BaseModel):
    tag_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)
    range: ChartRange = "24h"


class TablePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["table"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: TablePanelConfig


class GaugePanelConfig(BaseModel):
    tag_id: uuid.UUID
    # Status thresholds (optional). `direction` says which side is bad:
    # "above" → value ≥ warning is Waspada, ≥ critical is Kritis;
    # "below" → value ≤ warning is Waspada, ≤ critical is Kritis.
    warning: float | None = None
    critical: float | None = None
    direction: Literal["above", "below"] = "above"


class GaugePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["gauge"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: GaugePanelConfig


class BarPanelConfig(BaseModel):
    # Comparison across tags ("plant 1 vs plant 2") — needs at least two bars
    tag_ids: list[uuid.UUID] = Field(min_length=2, max_length=8)
    range: ChartRange = "24h"
    metric: Literal["avg", "last", "min", "max"] = "avg"


class BarPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["bar"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: BarPanelConfig


class AlarmPanelConfig(BaseModel):
    # Watch a set of tags; thresholds are read from each tag's own
    # config.alarm_min / config.alarm_max (set in Analisis), not here.
    tag_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)
    range: ChartRange = "24h"


class AlarmPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["alarm"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: AlarmPanelConfig


class WallCell(BaseModel):
    """One cell of a video wall → one channel = (stream, cell index in its mosaic)."""

    stream_id: uuid.UUID
    cell: int = Field(ge=0, le=35)  # up to a 6×6 mosaic


class WallPanelConfig(BaseModel):
    rows: int = Field(ge=1, le=6)
    cols: int = Field(ge=1, le=6)
    # Row-major cells; null = empty slot. Length should equal rows×cols.
    cells: list[WallCell | None] = Field(default_factory=list, max_length=36)
    # How each channel fills its cell: crop-to-fill or whole-camera-letterboxed.
    fit: Literal["cover", "contain"] = "cover"


class WallPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["wall"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: WallPanelConfig


class ActivityPanelConfig(BaseModel):
    # No configuration — the panel always lists everyone currently on REIN.
    model_config = {"extra": "forbid"}


class ActivityPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["activity"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ActivityPanelConfig = Field(default_factory=ActivityPanelConfig)


class WebPanelConfig(BaseModel):
    # Live web page (e.g. Wecon V-Net HMI) embedded in the grid. http(s) only —
    # never javascript:/data: URLs.
    url: str = Field(min_length=8, max_length=2048, pattern=r"^https?://")
    zoom: float = Field(default=1.0, ge=0.25, le=3.0)
    # Shift the page inside the cell (CSS px, pre-zoom) — crops away the
    # embedded site's own navbar/sidebar without fullscreen.
    offset_x: int = Field(default=0, ge=0, le=4000)
    offset_y: int = Field(default=0, ge=0, le=4000)
    # Native viewport (OBS-style source resolution): the page is laid out at
    # exactly this size then scaled into its cell — so the embedded site's own
    # fullscreen fills this viewport (= its panel), and layouts stay stable.
    # None = legacy behavior (fill the cell directly).
    view_w: int | None = Field(default=1920, ge=320, le=7680)
    view_h: int | None = Field(default=1080, ge=180, le=4320)


class WebPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["web"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: WebPanelConfig


class ChannelPanelConfig(BaseModel):
    # A layout cell that shows one TV-style channel (see ScadaChannel).
    channel_id: uuid.UUID


class ChannelPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["channel"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ChannelPanelConfig


Panel = Annotated[
    Union[
        VideoPanel,
        ChartPanel,
        TablePanel,
        GaugePanel,
        BarPanel,
        AlarmPanel,
        WallPanel,
        ActivityPanel,
        WebPanel,
        ChannelPanel,
    ],
    Field(discriminator="type"),
]


class PerspectiveLayout(BaseModel):
    """v1 = legacy 12-column grid (grid per panel); v2 = OBS-style fixed canvas
    (canvas resolution + absolute rect per panel — never reflows with zoom)."""

    version: Literal[1, 2] = 2
    canvas: CanvasSize | None = None
    panels: list[Panel] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def _check_placement(self) -> "PerspectiveLayout":
        if self.version == 2:
            if self.canvas is None:
                self.canvas = CanvasSize(w=1920, h=1080)
            for p in self.panels:
                if p.rect is None:
                    raise ValueError("panel layout v2 wajib punya rect")
        else:
            for p in self.panels:
                if p.grid is None:
                    raise ValueError("panel layout v1 wajib punya grid")
        return self


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class PerspectiveCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    layout: PerspectiveLayout = Field(default_factory=PerspectiveLayout)


class PerspectiveUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    layout: PerspectiveLayout | None = None


class StreamCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hls_url: str = Field(min_length=1)
    read_user: str | None = Field(default=None, max_length=64)
    read_pass: str | None = Field(default=None, max_length=128)
    enabled: bool = True
    mosaic_rows: int = Field(default=1, ge=1, le=6)
    mosaic_cols: int = Field(default=1, ge=1, le=6)
    channel_start: int = Field(default=1, ge=1, le=100000)


class StreamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    hls_url: str | None = Field(default=None, min_length=1)
    read_user: str | None = Field(default=None, max_length=64)
    read_pass: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None
    mosaic_rows: int | None = Field(default=None, ge=1, le=6)
    mosaic_cols: int | None = Field(default=None, ge=1, le=6)
    channel_start: int | None = Field(default=None, ge=1, le=100000)


# --- Channels (TV-style registry: number + nickname + one source) ----------

ChannelKind = Literal[
    "video", "web", "chart", "table", "gauge", "bar", "alarm", "activity"
]


class ChannelVideoConfig(BaseModel):
    stream_id: uuid.UUID
    # Crop ONE cell of the stream's mosaic (row-major, 0-based). None = whole
    # frame. The mosaic grid itself lives on the stream (mosaic_rows/cols).
    cell: int | None = Field(default=None, ge=0, le=35)


# Which config model validates each channel kind — panel configs are reused so
# a channel is exactly "a panel definition without a grid position".
CHANNEL_CONFIG_MODELS: dict[str, type[BaseModel]] = {
    "video": ChannelVideoConfig,
    "web": WebPanelConfig,
    "chart": ChartPanelConfig,
    "table": TablePanelConfig,
    "gauge": GaugePanelConfig,
    "bar": BarPanelConfig,
    "alarm": AlarmPanelConfig,
    "activity": ActivityPanelConfig,
}


def validate_channel_config(kind: str, config: dict) -> dict:
    """Validate + normalize a channel config for its kind (raises ValueError)."""
    model = CHANNEL_CONFIG_MODELS[kind]
    return model.model_validate(config).model_dump(mode="json")


class ChannelCreateRequest(BaseModel):
    number: int = Field(ge=1, le=100000)
    name: str = Field(min_length=1, max_length=120)
    kind: ChannelKind
    config: dict = Field(default_factory=dict)
    enabled: bool = True

    @model_validator(mode="after")
    def _check_config(self) -> "ChannelCreateRequest":
        self.config = validate_channel_config(self.kind, self.config)
        return self


class ChannelUpdateRequest(BaseModel):
    number: int | None = Field(default=None, ge=1, le=100000)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: ChannelKind | None = None
    # Validated in the router against the EFFECTIVE kind (new or existing).
    config: dict | None = None
    enabled: bool | None = None


class SiteCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mqtt_host: str = Field(min_length=1, max_length=200)
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str | None = Field(default=None, max_length=120)
    mqtt_password: str | None = Field(default=None, max_length=200)
    base_topic: str = Field(default="", max_length=200)
    enabled: bool = True


class SiteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    mqtt_host: str | None = Field(default=None, min_length=1, max_length=200)
    mqtt_port: int | None = Field(default=None, ge=1, le=65535)
    mqtt_username: str | None = Field(default=None, max_length=120)
    # Send a new value to change it; omit to leave unchanged (write-only —
    # the current password is never returned by the API).
    mqtt_password: str | None = Field(default=None, max_length=200)
    base_topic: str | None = Field(default=None, max_length=200)
    enabled: bool | None = None


class SheetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SheetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    position: int | None = Field(default=None, ge=0)


TagSource = Literal["simulator", "mqtt"]


class TagCreateRequest(BaseModel):
    sheet_id: uuid.UUID
    # "simulator" (in-process sampler) or "mqtt" (written by the standalone
    # bridge from broker messages).
    source: TagSource = "simulator"
    # Required for source "mqtt": which site (broker) publishes this tag.
    site_id: uuid.UUID | None = None
    device_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="", max_length=30)
    enabled: bool = True
    # Simulator: {preset, base, amplitude, period_s, noise, decimals, min?, max?}
    # MQTT: {mqtt_topic, alarm_min?, alarm_max?} — mqtt_topic is required.
    config: dict = Field(default_factory=dict)
    # Manual metadata cell values, keyed by workbench column id
    meta: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _mqtt_needs_site_and_topic(self):
        if self.source == "mqtt":
            if self.site_id is None:
                raise ValueError("Tag MQTT harus punya site")
            if not str(self.config.get("mqtt_topic", "")).strip():
                raise ValueError("Tag MQTT harus punya topic")
        return self


class TagUpdateRequest(BaseModel):
    sheet_id: uuid.UUID | None = None
    source: TagSource | None = None
    site_id: uuid.UUID | None = None
    device_key: str | None = Field(default=None, min_length=1, max_length=120)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=30)
    enabled: bool | None = None
    config: dict | None = None
    meta: dict | None = None


ColumnKind = Literal["formula", "text", "number"]


class WorkbenchColumnCreateRequest(BaseModel):
    sheet_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)
    kind: ColumnKind = "formula"
    # Opaque here — evaluated only client-side by the safe arithmetic parser.
    # Required for kind "formula"; must be absent for text/number columns.
    formula: str | None = Field(default=None, min_length=1, max_length=500)
    unit: str = Field(default="", max_length=30)
    decimals: int = Field(default=1, ge=0, le=6)

    @model_validator(mode="after")
    def _formula_matches_kind(self):
        if self.kind == "formula" and not self.formula:
            raise ValueError("Kolom rumus harus punya formula")
        if self.kind != "formula" and self.formula:
            raise ValueError("Kolom metadata tidak boleh punya formula")
        return self


class WorkbenchColumnUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    formula: str | None = Field(default=None, min_length=1, max_length=500)
    unit: str | None = Field(default=None, max_length=30)
    decimals: int | None = Field(default=None, ge=0, le=6)
    position: int | None = Field(default=None, ge=0)


# ---------------------------------------------------------------------------
# Responses — declared as response_model so OpenAPI documents the real shape
# (template for the rest of the codebase; see backend/scripts/export_openapi.py)
# ---------------------------------------------------------------------------


class PerspectiveOut(BaseModel):
    id: str
    name: str
    layout: PerspectiveLayout
    is_default: bool
    # True when this is the single admin-published default layout (Masalah D)
    is_published: bool = False
    # True when this entry is the admin default shown to a user who does NOT own
    # it — the frontend renders it view-only and forks it on edit ("Simpan
    # Sebagai"). Always False for the user's own perspectives.
    read_only: bool = False
    created_at: str | None
    updated_at: str | None


class PerspectiveListOut(BaseModel):
    items: list[PerspectiveOut]


class PublishedLayoutOut(BaseModel):
    """The admin-published default layout, or exists=False when none is set."""

    exists: bool
    name: str | None = None
    layout: PerspectiveLayout | None = None


class StreamOut(BaseModel):
    id: str
    name: str
    hls_url: str
    # Read credentials are intentionally part of the payload — the endpoint is
    # gated behind scada:view and the browser player needs them (query params).
    read_user: str | None
    read_pass: str | None
    enabled: bool
    mosaic_rows: int
    mosaic_cols: int
    channel_start: int
    created_at: str | None
    updated_at: str | None


class StreamListOut(BaseModel):
    items: list[StreamOut]


class ChannelOut(BaseModel):
    id: str
    number: int
    name: str
    kind: str
    config: dict
    enabled: bool
    created_at: str | None
    updated_at: str | None


class ChannelListOut(BaseModel):
    items: list[ChannelOut]


class SiteOut(BaseModel):
    id: str
    name: str
    enabled: bool
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str | None
    base_topic: str
    # The broker password is intentionally NOT exposed — only whether one is
    # set. The bridge reads the real value directly from the DB (service_role).
    has_password: bool
    created_at: str | None
    updated_at: str | None


class SiteListOut(BaseModel):
    items: list[SiteOut]


class SheetOut(BaseModel):
    id: str
    name: str
    position: int
    created_at: str | None
    updated_at: str | None


class SheetListOut(BaseModel):
    items: list[SheetOut]


class TagOut(BaseModel):
    id: str
    sheet_id: str
    source: str
    site_id: str | None
    device_key: str
    label: str
    unit: str
    enabled: bool
    config: dict
    meta: dict
    created_at: str | None
    updated_at: str | None


class TagListOut(BaseModel):
    items: list[TagOut]


class HistoryPointOut(BaseModel):
    t: str  # bucket start, ISO 8601 UTC
    avg: float
    min: float
    max: float


class HistorySeriesOut(BaseModel):
    tag_id: str
    label: str
    unit: str
    points: list[HistoryPointOut]


class HistoryOut(BaseModel):
    series: list[HistorySeriesOut]


class SummaryItemOut(BaseModel):
    tag_id: str
    label: str
    unit: str
    # Nullable when the tag has no samples in the window yet
    last: float | None
    last_ts: str | None
    min: float | None
    max: float | None
    avg: float | None


class SummaryOut(BaseModel):
    items: list[SummaryItemOut]


class WorkbenchColumnOut(BaseModel):
    id: str
    sheet_id: str
    name: str
    kind: str
    formula: str | None
    unit: str
    decimals: int
    position: int
    created_at: str | None
    updated_at: str | None


class RecentSampleOut(BaseModel):
    ts: str
    value: float


class RecentSamplesOut(BaseModel):
    items: list[RecentSampleOut]


class WorkbenchColumnListOut(BaseModel):
    items: list[WorkbenchColumnOut]


class DeletedOut(BaseModel):
    deleted: str
