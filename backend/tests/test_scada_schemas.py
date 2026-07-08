"""Validation of the SCADA perspective layout contract.

The layout JSONB is schemaless in the DB — this Pydantic layer is the only
gate. Garbage that passes here gets persisted forever, so the gate must hold.
"""

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.scada import (
    PerspectiveLayout,
    SheetCreateRequest,
    SiteCreateRequest,
    TagCreateRequest,
    WorkbenchColumnCreateRequest,
)


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


def _chart_panel(**overrides) -> dict:
    panel = {
        "id": "panel-2",
        "type": "chart",
        "title": "Tren Suhu",
        "grid": {"x": 0, "y": 8, "w": 6, "h": 6},
        "config": {"tag_ids": [str(uuid.uuid4())]},
    }
    panel.update(overrides)
    return panel


def test_valid_alarm_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(type="alarm", config={"tag_ids": [str(uuid.uuid4())]})
            ],
        }
    )
    assert layout.panels[0].config.range == "24h"  # default


def test_alarm_panel_requires_tag():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_chart_panel(type="alarm", config={"tag_ids": []})]}
        )


def test_valid_chart_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_chart_panel()]}
    )
    assert layout.panels[0].config.range == "24h"  # default
    assert layout.panels[0].config.show_minmax is False  # default


def test_chart_panel_tag_count_bounds():
    with pytest.raises(ValidationError):  # zero tags
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_chart_panel(config={"tag_ids": []})]}
        )
    with pytest.raises(ValidationError):  # five tags (max 4)
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(config={"tag_ids": [str(uuid.uuid4()) for _ in range(5)]})
                ],
            }
        )


def test_valid_table_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(type="table", config={"tag_ids": [str(uuid.uuid4())]})
            ],
        }
    )
    assert layout.panels[0].config.range == "24h"  # default


def test_table_panel_tag_count_bounds():
    with pytest.raises(ValidationError):  # zero tags
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_chart_panel(type="table", config={"tag_ids": []})]}
        )
    with pytest.raises(ValidationError):  # nine tags (max 8)
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(
                        type="table",
                        config={"tag_ids": [str(uuid.uuid4()) for _ in range(9)]},
                    )
                ],
            }
        )


def test_valid_gauge_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    type="gauge",
                    config={"tag_id": str(uuid.uuid4()), "warning": 80, "critical": 95},
                )
            ],
        }
    )
    assert layout.panels[0].config.direction == "above"  # default


def test_gauge_panel_requires_tag_id():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_chart_panel(type="gauge", config={})]}
        )


def test_valid_bar_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    type="bar",
                    config={"tag_ids": [str(uuid.uuid4()) for _ in range(3)]},
                )
            ],
        }
    )
    assert layout.panels[0].config.metric == "avg"  # default


def test_bar_panel_tag_count_bounds():
    with pytest.raises(ValidationError):  # one tag — comparison needs two
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(type="bar", config={"tag_ids": [str(uuid.uuid4())]})
                ],
            }
        )
    with pytest.raises(ValidationError):  # nine tags (max 8)
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(
                        type="bar",
                        config={"tag_ids": [str(uuid.uuid4()) for _ in range(9)]},
                    )
                ],
            }
        )


def test_bar_panel_unknown_metric_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(
                        type="bar",
                        config={
                            "tag_ids": [str(uuid.uuid4()), str(uuid.uuid4())],
                            "metric": "median",
                        },
                    )
                ],
            }
        )


def test_chart_panel_unknown_range_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(config={"tag_ids": [str(uuid.uuid4())], "range": "1y"})
                ],
            }
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


# ── Workbench v2: sheets, tags, column kinds ────────────────────────────────


def test_sheet_empty_name_rejected():
    with pytest.raises(ValidationError):
        SheetCreateRequest.model_validate({"name": ""})


def test_tag_create_requires_sheet_id():
    with pytest.raises(ValidationError):
        TagCreateRequest.model_validate({"device_key": "SIM-01", "label": "Suhu"})


def test_formula_column_requires_formula():
    with pytest.raises(ValidationError):
        WorkbenchColumnCreateRequest.model_validate(
            {"sheet_id": str(uuid.uuid4()), "name": "Energi", "kind": "formula"}
        )


def test_metadata_column_must_not_have_formula():
    with pytest.raises(ValidationError):
        WorkbenchColumnCreateRequest.model_validate(
            {
                "sheet_id": str(uuid.uuid4()),
                "name": "Lokasi",
                "kind": "text",
                "formula": "[Terkini]",
            }
        )


def test_unknown_column_kind_rejected():
    with pytest.raises(ValidationError):
        WorkbenchColumnCreateRequest.model_validate(
            {"sheet_id": str(uuid.uuid4()), "name": "X", "kind": "lua"}
        )


def test_valid_metadata_column_passes():
    col = WorkbenchColumnCreateRequest.model_validate(
        {"sheet_id": str(uuid.uuid4()), "name": "Lokasi", "kind": "text"}
    )
    assert col.formula is None


# ── MQTT: sites + tag source "mqtt" ─────────────────────────────────────────


def test_site_empty_name_rejected():
    with pytest.raises(ValidationError):
        SiteCreateRequest.model_validate({"name": "", "mqtt_host": "broker.local"})


def test_site_requires_host():
    with pytest.raises(ValidationError):
        SiteCreateRequest.model_validate({"name": "Pabrik 1"})


def test_site_default_port_is_1883():
    site = SiteCreateRequest.model_validate(
        {"name": "Pabrik 1", "mqtt_host": "broker.local"}
    )
    assert site.mqtt_port == 1883
    assert site.mqtt_password is None  # optional


def test_site_port_out_of_range_rejected():
    with pytest.raises(ValidationError):
        SiteCreateRequest.model_validate(
            {"name": "Pabrik 1", "mqtt_host": "broker.local", "mqtt_port": 70000}
        )


def _mqtt_tag(**overrides) -> dict:
    body = {
        "sheet_id": str(uuid.uuid4()),
        "source": "mqtt",
        "site_id": str(uuid.uuid4()),
        "device_key": "boiler1",
        "label": "Suhu Boiler",
        "config": {"mqtt_topic": "rnet/tanobel/boiler1/temperature"},
    }
    body.update(overrides)
    return body


def test_mqtt_tag_requires_site_id():
    with pytest.raises(ValidationError):
        TagCreateRequest.model_validate(_mqtt_tag(site_id=None))


def test_mqtt_tag_requires_topic():
    with pytest.raises(ValidationError):
        TagCreateRequest.model_validate(_mqtt_tag(config={}))


def test_valid_mqtt_tag_passes():
    tag = TagCreateRequest.model_validate(_mqtt_tag())
    assert tag.source == "mqtt"
    assert tag.config["mqtt_topic"].startswith("rnet/")


def test_simulator_tag_needs_no_site_or_topic():
    # Default source is simulator — site_id/topic are irrelevant and optional
    tag = TagCreateRequest.model_validate(
        {"sheet_id": str(uuid.uuid4()), "device_key": "SIM-01", "label": "Suhu"}
    )
    assert tag.source == "simulator"
    assert tag.site_id is None


def test_unknown_tag_source_rejected():
    with pytest.raises(ValidationError):
        TagCreateRequest.model_validate(
            {
                "sheet_id": str(uuid.uuid4()),
                "source": "vnet",
                "device_key": "x",
                "label": "y",
            }
        )
