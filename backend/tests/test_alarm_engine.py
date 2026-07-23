"""Alarm engine + notifier unit tests — the pure decision logic.

The DB-bound state transitions (open/clear dedup) are enforced by the partial
unique index uq_scada_alarm_open + atomic UPDATE..RETURNING claims, exercised
against the real database in the E2E checklist (PANDUAN-NODE-RED.md). These
tests pin down everything that can be verified without a database: threshold
parsing, silence windows, sampling-level rules, cycle math, and notification
text.
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
from app.services import rnet_settings
from app.services.notifier import build_message
from app.schemas.scada import (
    SAMPLING_LEVELS,
    TagCreateRequest,
    validate_sampling_level,
)


def _settings(**over) -> SimpleNamespace:
    """A ScadaSettings-like row with the default level durations + retention."""
    base = dict(
        level_fastest_s=2,
        level_fast_s=5,
        level_slow_s=30,
        level_slowest_s=60,
        ring_window_h=24,
        store_months=1,
        reset_warn_days=7,
    )
    base.update(over)
    return SimpleNamespace(**base)


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
    # store off → ring mode → the 60 s floor IS the window, regardless of level
    s = _settings()
    assert _silent_after_s(s, {}) == SILENT_FLOOR_S
    assert _silent_after_s(s, {"sampling_level": "slowest"}) == SILENT_FLOOR_S


def test_silent_window_store_mode_uses_level():
    s = _settings()
    # slow = 30 s → 3× = 90 s
    assert _silent_after_s(s, {"store_enabled": True, "sampling_level": "slow"}) == 90
    # slowest = 60 s → 3× = 180 s
    assert (
        _silent_after_s(s, {"store_enabled": True, "sampling_level": "slowest"}) == 180
    )


def test_wants_silent_automatic_for_mqtt():
    assert _wants_silent(SimpleNamespace(source="mqtt"))
    assert not _wants_silent(SimpleNamespace(source="simulator"))


# --------------------------------------------------------------------------- #
# Sampling-level resolution + rules
# --------------------------------------------------------------------------- #


def test_level_seconds_maps_names():
    s = _settings()
    assert rnet_settings.level_seconds(s, "fastest") == 2
    assert rnet_settings.level_seconds(s, "slowest") == 60
    # unknown / missing → the fast default
    assert rnet_settings.level_seconds(s, None) == 5


def test_resolve_interval_floors():
    s = _settings()
    # simulator floor 60 clamps fast(5) up to 60
    assert rnet_settings.resolve_interval(s, {"sampling_level": "fast"}, floor_s=60) == 60
    # bridge floor 1 keeps fastest at 2
    assert rnet_settings.resolve_interval(s, {"sampling_level": "fastest"}, floor_s=1) == 2


def test_validate_level_accepts_all_for_ring():
    for level in SAMPLING_LEVELS:
        validate_sampling_level({"sampling_level": level})


def test_validate_level_blocks_fast_when_storing():
    for bad in ("fastest", "fast"):
        with pytest.raises(ValueError):
            validate_sampling_level({"store_enabled": True, "sampling_level": bad})
    # slow / slowest are fine while storing
    validate_sampling_level({"store_enabled": True, "sampling_level": "slow"})
    validate_sampling_level({"store_enabled": True, "sampling_level": "slowest"})


def test_validate_level_rejects_unknown():
    with pytest.raises(ValueError):
        validate_sampling_level({"sampling_level": "turbo"})


def test_tag_create_request_enforces_level():
    with pytest.raises(ValueError):
        TagCreateRequest(
            sheet_id=uuid.uuid4(),
            source="simulator",
            device_key="SIM-01",
            label="Suhu",
            config={"store_enabled": True, "sampling_level": "fast"},
        )


# --------------------------------------------------------------------------- #
# Reset cycle math (shared by alarm reminder + archiver)
# --------------------------------------------------------------------------- #


def test_parse_cycle_start_roundtrip():
    iso = rnet_settings.now_iso()
    dt = rnet_settings.parse_cycle_start({"store_cycle_start": iso})
    assert dt is not None and dt.tzinfo is not None
    assert rnet_settings.parse_cycle_start({}) is None
    assert rnet_settings.parse_cycle_start({"store_cycle_start": "junk"}) is None


def test_cycle_reset_at_adds_months():
    s = _settings(store_months=1)
    start = datetime(2026, 1, 31, 12, 0, tzinfo=timezone.utc)
    reset = rnet_settings.cycle_reset_at(s, start)
    # +1 calendar month, day clamped into February
    assert reset.month == 2 and reset.year == 2026


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


def test_message_expiring_reminder():
    subject, body = build_message(_event("expiring"), _tag(), "triggered")
    assert "PENGINGAT RESET" in subject
    assert "direset" in body


def test_message_expiring_cleared_is_new_cycle():
    subject, body = build_message(_event("expiring"), _tag(), "cleared")
    assert "SIKLUS BARU" in subject
    assert "direset" in body


def test_message_cleared_pairs_with_alarm():
    subject, body = build_message(
        _event("high", trigger_value=92.0, threshold=85.0), _tag(), "cleared"
    )
    assert "NORMAL" in subject
    assert "batas aman" in body
