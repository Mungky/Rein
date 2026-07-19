"""Alarm engine + notifier unit tests — the pure decision logic.

The DB-bound state transitions (open/clear dedup) are enforced by the partial
unique index uq_scada_alarm_open + atomic UPDATE..RETURNING claims, exercised
against the real database in the E2E checklist (PANDUAN-NODE-RED.md). These
tests pin down everything that can be verified without a database: threshold
parsing, silence windows, storage-interval rules, and notification text.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.alarm_engine import (
    SILENT_FLOOR_S,
    _bounds,
    _silent_after_s,
    _wants_silent,
)
from app.services.historian import _storage_interval
from app.services.notifier import build_message
from app.schemas.scada import (
    ALLOWED_STORAGE_INTERVALS,
    TagCreateRequest,
    validate_storage_interval,
)


# --------------------------------------------------------------------------- #
# Threshold parsing
# --------------------------------------------------------------------------- #


def test_bounds_absent_config():
    assert _bounds(None) == (None, None)
    assert _bounds({}) == (None, None)


def test_bounds_numeric_and_string_values():
    assert _bounds({"alarm_min": 10, "alarm_max": 90}) == (10.0, 90.0)
    # The frontend may persist numbers as strings — both must work
    assert _bounds({"alarm_min": "10.5", "alarm_max": "90"}) == (10.5, 90.0)


def test_bounds_garbage_is_ignored():
    assert _bounds({"alarm_min": "abc", "alarm_max": ""}) == (None, None)


# --------------------------------------------------------------------------- #
# Sensor-silence window: max(3 × interval, 60 s); ring tags = flat 60 s
# --------------------------------------------------------------------------- #


def test_silent_window_ring_mode_uses_floor():
    # store_enabled off → ring mode (~1 s data) → the 60 s floor IS the window
    assert _silent_after_s({}) == SILENT_FLOOR_S
    assert _silent_after_s({"storage_interval_s": 3600}) == SILENT_FLOOR_S


def test_silent_window_interval_mode():
    assert _silent_after_s({"store_enabled": True}) == 180  # default 60 s → 3×
    assert (
        _silent_after_s({"store_enabled": True, "storage_interval_s": 5})
        == SILENT_FLOOR_S
    )
    assert (
        _silent_after_s({"store_enabled": True, "storage_interval_s": 3600})
        == 3 * 3600
    )


def test_wants_silent_automatic_for_mqtt():
    assert _wants_silent(SimpleNamespace(source="mqtt"))
    assert not _wants_silent(SimpleNamespace(source="simulator"))


# --------------------------------------------------------------------------- #
# Storage-interval rules
# --------------------------------------------------------------------------- #


def test_simulator_tags_floored_to_60s():
    tag = SimpleNamespace(config={"storage_interval_s": 5})
    assert _storage_interval(tag) == 60
    tag = SimpleNamespace(config={"storage_interval_s": 300})
    assert _storage_interval(tag) == 300


def test_validate_interval_accepts_allowed_set_for_mqtt():
    for interval in ALLOWED_STORAGE_INTERVALS:
        validate_storage_interval("mqtt", {"storage_interval_s": interval})


def test_validate_interval_rejects_sub_minute_simulator():
    with pytest.raises(ValueError):
        validate_storage_interval("simulator", {"storage_interval_s": 5})
    # …but a minute or slower is fine
    validate_storage_interval("simulator", {"storage_interval_s": 300})


def test_validate_interval_rejects_off_menu_values():
    with pytest.raises(ValueError):
        validate_storage_interval("mqtt", {"storage_interval_s": 7})
    with pytest.raises(ValueError):
        validate_storage_interval("mqtt", {"storage_interval_s": "cepat"})


def test_tag_create_request_enforces_interval():
    with pytest.raises(ValueError):
        TagCreateRequest(
            sheet_id=uuid.uuid4(),
            source="simulator",
            device_key="SIM-01",
            label="Suhu",
            config={"storage_interval_s": 5},
        )


# --------------------------------------------------------------------------- #
# Notification text (Bahasa Indonesia, plain text)
# --------------------------------------------------------------------------- #


def _event(kind: str, **kw) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        kind=kind,
        triggered_at=datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc),
        trigger_value=kw.get("trigger_value"),
        threshold=kw.get("threshold"),
    )


def _tag(label="Suhu Boiler 1", unit="°C") -> SimpleNamespace:
    return SimpleNamespace(label=label, unit=unit)


def test_message_high_alarm_mentions_value_and_threshold():
    subject, body = build_message(
        _event("high", trigger_value=92.0, threshold=85.0), _tag(), "triggered"
    )
    assert "ALARM" in subject and "92" in subject
    assert "85" in body and "di atas batas" in body


def test_message_low_alarm():
    subject, body = build_message(
        _event("low", trigger_value=1.2, threshold=5.0), _tag("Level Tangki", "m"), "triggered"
    )
    assert "Level Tangki" in subject
    assert "di bawah batas" in body


def test_message_silent_alarm():
    subject, body = build_message(_event("silent"), _tag(), "triggered")
    assert "SENSOR BISU" in subject
    assert "berhenti mengirim data" in body


def test_message_cleared_pairs_with_alarm():
    subject, body = build_message(
        _event("high", trigger_value=92.0, threshold=85.0), _tag(), "cleared"
    )
    assert "NORMAL" in subject
    assert "batas aman" in body
