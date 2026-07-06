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
    """react-grid-layout cell: 12-column grid coordinates."""

    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=100)


class VideoPanelConfig(BaseModel):
    stream_id: uuid.UUID
    object_fit: Literal["contain", "cover"] = "contain"
    muted: bool = True


class VideoPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["video"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid
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
    grid: PanelGrid
    config: ChartPanelConfig


class TablePanelConfig(BaseModel):
    tag_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)
    range: ChartRange = "24h"


class TablePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["table"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid
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
    grid: PanelGrid
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
    grid: PanelGrid
    config: BarPanelConfig


# Phase 3+: add AlarmPanel members here.
Panel = Annotated[
    Union[VideoPanel, ChartPanel, TablePanel, GaugePanel, BarPanel],
    Field(discriminator="type"),
]


class PerspectiveLayout(BaseModel):
    version: Literal[1] = 1
    panels: list[Panel] = Field(default_factory=list, max_length=24)


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


class StreamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    hls_url: str | None = Field(default=None, min_length=1)
    read_user: str | None = Field(default=None, max_length=64)
    read_pass: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None


class SheetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SheetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    position: int | None = Field(default=None, ge=0)


class TagCreateRequest(BaseModel):
    sheet_id: uuid.UUID
    device_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="", max_length=30)
    enabled: bool = True
    # Simulator waveform: {preset, base, amplitude, period_s, noise, decimals,
    # min?, max?} — filled by the preset dropdown in the frontend.
    config: dict = Field(default_factory=dict)
    # Manual metadata cell values, keyed by workbench column id
    meta: dict = Field(default_factory=dict)


class TagUpdateRequest(BaseModel):
    sheet_id: uuid.UUID | None = None
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
    created_at: str | None
    updated_at: str | None


class PerspectiveListOut(BaseModel):
    items: list[PerspectiveOut]


class StreamOut(BaseModel):
    id: str
    name: str
    hls_url: str
    # Read credentials are intentionally part of the payload — the endpoint is
    # gated behind scada:view and the browser player needs them (query params).
    read_user: str | None
    read_pass: str | None
    enabled: bool
    created_at: str | None
    updated_at: str | None


class StreamListOut(BaseModel):
    items: list[StreamOut]


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
