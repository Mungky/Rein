"""Validation of the SCADA perspective layout contract.

The layout JSONB is schemaless in the DB — this Pydantic layer is the only
gate. Garbage that passes here gets persisted forever, so the gate must hold.
"""

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.scada import PerspectiveLayout


def _video_panel(**overrides) -> dict:
    panel = {
        "id": "panel-1",
        "type": "video",
        "title": "SCADA Utama",
        "grid": {"x": 0, "y": 0, "w": 12, "h": 8},
        "config": {"stream_id": str(uuid.uuid4())},
    }
    panel.update(overrides)
    return panel


def test_valid_video_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_video_panel()]}
    )
    assert layout.panels[0].config.object_fit == "contain"  # default
    assert layout.panels[0].config.muted is True  # default


def test_empty_layout_is_valid():
    layout = PerspectiveLayout.model_validate({"version": 1, "panels": []})
    assert layout.panels == []


def test_unknown_panel_type_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_video_panel(type="virus")]}
        )


def test_reserved_panel_types_not_yet_accepted():
    # chart/table/alarm are reserved for Phase 2 — saving them now must fail
    for reserved in ("chart", "table", "alarm"):
        with pytest.raises(ValidationError):
            PerspectiveLayout.model_validate(
                {"version": 1, "panels": [_video_panel(type=reserved)]}
            )


def test_grid_out_of_bounds_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_video_panel(grid={"x": 12, "y": 0, "w": 1, "h": 1})]}
        )
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_video_panel(grid={"x": 0, "y": 0, "w": 13, "h": 1})]}
        )


def test_invalid_stream_id_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_video_panel(config={"stream_id": "bukan-uuid"})]}
        )


def test_wrong_version_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate({"version": 2, "panels": []})


def test_too_many_panels_rejected():
    panels = [_video_panel(id=f"p{i}") for i in range(25)]
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate({"version": 1, "panels": panels})
