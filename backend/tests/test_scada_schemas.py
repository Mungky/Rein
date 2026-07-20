"""Validation of the SCADA perspective layout contract.

The layout JSONB is schemaless in the DB — this Pydantic layer is the only
gate. Garbage that passes here gets persisted forever, so the gate must hold.
"""

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.scada import (
    ChannelCreateRequest,
    PerspectiveLayout,
    SheetCreateRequest,
    SiteCreateRequest,
    StreamCreateRequest,
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


def test_alarm_panel_empty_tags_is_placeholder():
    # Palet Komponen memasang panel "kosong" dulu (diatur via inspector) —
    # daftar tag kosong valid dan dirender sebagai placeholder di UI.
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_chart_panel(type="alarm", config={"tag_ids": []})]}
    )
    assert layout.panels[0].config.tag_ids == []


def test_valid_chart_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_chart_panel()]}
    )
    assert layout.panels[0].config.range == "24h"  # default
    assert layout.panels[0].config.show_minmax is False  # default


def test_chart_panel_tag_count_bounds():
    # zero tags = placeholder yang sah (drop-dulu-atur-kemudian)
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
    # zero tags = placeholder yang sah
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


def test_gauge_panel_without_tag_is_placeholder():
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_chart_panel(type="gauge", config={})]}
    )
    assert layout.panels[0].config.tag_id is None
    assert layout.panels[0].config.style == "stat"  # default = tampilan lama


def test_gauge_panel_arc_style_with_scale_and_color():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    type="gauge",
                    config={
                        "tag_id": str(uuid.uuid4()),
                        "style": "arc",
                        "min": 0,
                        "max": 250,
                        "warning": 180,
                        "critical": 220,
                        "color": "#2a78d6",
                        "decimals": 1,
                        "unit": "bar",
                    },
                )
            ],
        }
    )
    cfg = layout.panels[0].config
    assert cfg.style == "arc"
    assert cfg.max == 250


def test_gauge_panel_bad_color_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(
                        type="gauge",
                        config={"tag_id": str(uuid.uuid4()), "color": "merah"},
                    )
                ],
            }
        )


def test_chart_panel_line_colors_and_axis():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    config={
                        "tag_ids": [str(uuid.uuid4()), str(uuid.uuid4())],
                        "colors": ["#dc2626", None],
                        "y_min": 0,
                        "y_max": 100,
                        "line_style": "smooth",
                        "show_legend": False,
                    }
                )
            ],
        }
    )
    cfg = layout.panels[0].config
    assert cfg.colors == ["#dc2626", None]
    assert cfg.line_style == "smooth"
    # Config lama tanpa field baru tetap valid dengan bawaan tampilan lama
    old = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_chart_panel()]}
    )
    assert old.panels[0].config.line_style == "linear"
    assert old.panels[0].config.show_grid is True


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
    # satu tag kini sah (panel palet diisi bertahap); UI tetap menyarankan ≥2
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
        PerspectiveLayout.model_validate({"version": 3, "panels": []})


def test_v2_panel_requires_rect():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {
                "version": 2,
                "canvas": {"w": 1920, "h": 1080},
                "panels": [
                    {
                        "id": "a",
                        "type": "channel",
                        "grid": {"x": 0, "y": 0, "w": 6, "h": 8},
                        "config": {
                            "channel_id": "00000000-0000-0000-0000-000000000000"
                        },
                    }
                ],
            }
        )


def test_v2_default_canvas_filled():
    layout = PerspectiveLayout.model_validate({"version": 2, "panels": []})
    assert layout.canvas is not None
    assert (layout.canvas.w, layout.canvas.h) == (1920, 1080)


def test_too_many_panels_rejected():
    # Batas naik ke 64 — HMI penuh teks/bentuk/gambar cepat melewati 24
    PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_video_panel(id=f"p{i}") for i in range(64)]}
    )
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_video_panel(id=f"p{i}") for i in range(65)]}
        )


# ── Komponen baru: level, led, image ────────────────────────────────────────


def test_valid_level_panel_passes():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    type="level",
                    config={
                        "tag_id": str(uuid.uuid4()),
                        "min": 0,
                        "max": 5000,
                        "warning": 4000,
                        "color": "#2a78d6",
                    },
                )
            ],
        }
    )
    assert layout.panels[0].config.max == 5000


def test_level_panel_inverted_scale_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {
                "version": 1,
                "panels": [
                    _chart_panel(type="level", config={"min": 100, "max": 100})
                ],
            }
        )


def test_valid_led_panel_defaults():
    layout = PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [
                _chart_panel(
                    type="led",
                    config={"tag_id": str(uuid.uuid4()), "threshold": 80},
                )
            ],
        }
    )
    cfg = layout.panels[0].config
    assert cfg.direction == "above"
    assert cfg.on_label == "AKTIF"
    assert cfg.show_value is True


def _image_panel(**config) -> dict:
    return _chart_panel(
        type="image",
        config={"src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", **config},
    )


def test_valid_image_panel_data_uri_and_url():
    layout = PerspectiveLayout.model_validate(
        {"version": 1, "panels": [_image_panel()]}
    )
    assert layout.panels[0].config.fit == "contain"  # default
    PerspectiveLayout.model_validate(
        {
            "version": 1,
            "panels": [_image_panel(src="https://contoh.com/logo.png", fit="cover")],
        }
    )


def test_image_panel_bad_src_rejected():
    # javascript:/data:text tidak pernah boleh jadi src gambar
    for bad in ("javascript:alert(1)", "data:text/html;base64,PGI+", "file:///x.png"):
        with pytest.raises(ValidationError):
            PerspectiveLayout.model_validate(
                {"version": 1, "panels": [_image_panel(src=bad)]}
            )


def test_image_panel_unknown_field_rejected():
    with pytest.raises(ValidationError):
        PerspectiveLayout.model_validate(
            {"version": 1, "panels": [_image_panel(onclick="x")]}
        )


# ── Channel kind "screen" (references a Source: stream/web/vnc) ──────────────


def _screen_channel(**overrides) -> dict:
    body = {
        "number": 42,
        "name": "Cloud SCADA",
        "kind": "screen",
        "config": {"stream_id": str(uuid.uuid4())},
    }
    body.update(overrides)
    return body


def test_valid_screen_channel_passes():
    ch = ChannelCreateRequest.model_validate(_screen_channel())
    assert ch.config["crop"] is None  # whole frame by default
    assert ch.config["view_w"] == 1920  # ScreenSize default rides along


def test_screen_channel_requires_stream_id():
    with pytest.raises(ValidationError):
        ChannelCreateRequest.model_validate(_screen_channel(config={}))


def test_screen_channel_rejects_bad_stream_id():
    with pytest.raises(ValidationError):
        ChannelCreateRequest.model_validate(
            _screen_channel(config={"stream_id": "bukan-uuid"})
        )


def test_screen_channel_accepts_crop():
    ch = ChannelCreateRequest.model_validate(
        _screen_channel(
            config={
                "stream_id": str(uuid.uuid4()),
                "crop": {"x": 0, "y": 0, "w": 960, "h": 540},
                "src_w": 1920,
                "src_h": 1080,
            }
        )
    )
    assert ch.config["crop"]["w"] == 960


def test_old_video_kind_rejected():
    # "video" is no longer a channel kind — only "screen" + data kinds.
    with pytest.raises(ValidationError):
        ChannelCreateRequest.model_validate(
            _screen_channel(kind="video", config={"stream_id": str(uuid.uuid4())})
        )


# ── Sources (unified stream/web/vnc) ────────────────────────────────────────


def test_stream_source_requires_hls():
    StreamCreateRequest.model_validate(
        {"name": "Line A", "hls_url": "https://s.contoh.com/scada/index.m3u8"}
    )
    with pytest.raises(ValidationError):  # source_type stream but no hls_url
        StreamCreateRequest.model_validate({"name": "Line A"})


def test_web_source_requires_valid_url():
    src = StreamCreateRequest.model_validate(
        {"name": "HMI Lombok", "source_type": "web", "url": "https://vnet.wecon.com"}
    )
    assert src.source_type == "web"
    with pytest.raises(ValidationError):  # missing url
        StreamCreateRequest.model_validate({"name": "HMI", "source_type": "web"})
    with pytest.raises(ValidationError):  # bad scheme
        StreamCreateRequest.model_validate(
            {"name": "HMI", "source_type": "web", "url": "javascript:alert(1)"}
        )


def test_vnc_source_accepts_wss_and_password():
    src = StreamCreateRequest.model_validate(
        {
            "name": "PC SCADA",
            "source_type": "vnc",
            "url": "wss://vnc.contoh.com/websockify",
            "secret": "lihat123",
        }
    )
    assert src.secret == "lihat123"
    with pytest.raises(ValidationError):  # bad scheme
        StreamCreateRequest.model_validate(
            {"name": "PC", "source_type": "vnc", "url": "vnc://192.168.1.10:5900"}
        )


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
