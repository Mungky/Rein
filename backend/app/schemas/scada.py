"""Pydantic schemas for the SCADA Monitor module.

The perspective `layout` JSONB follows a versioned contract:
{"version": 1, "panels": [...]} — each panel is a discriminated union on
`type`. Only "video" is implemented in Phase 1; "chart" / "table" / "alarm"
are reserved for the sensor/historian/alarm panels. Unknown types are
rejected at save time so garbage can never be persisted.

Keep in sync with `frontend/src/features/scada/types.ts`.
"""

import uuid
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


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


# Phase 2+: add ChartPanel / TablePanel / AlarmPanel members here.
Panel = Annotated[Union[VideoPanel], Field(discriminator="type")]


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


class DeletedOut(BaseModel):
    deleted: str
