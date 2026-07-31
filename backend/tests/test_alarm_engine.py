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
    _warn_bounds,
    _wants_silent,
    value_conditions,
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


def test_warn_bounds_parsing_matches_alarm_bounds():
    assert _warn_bounds(None) == (None, None)
    assert _warn_bounds({"warn_min": 20, "warn_max": 80}) == (20.0, 80.0)
    assert _warn_bounds({"warn_min": "20.5", "warn_max": "80"}) == (20.5, 80.0)
    assert _warn_bounds({"warn_min": "abc", "warn_max": ""}) == (None, None)


# --------------------------------------------------------------------------- #
# Value conditions: which kinds should be open for a reading
#
# The warn_* pair is why this section exists. The Data tab has always painted
# rows amber from warn_min/warn_max, but the engine only ever read
# alarm_min/alarm_max — so a sensor inside its warn band showed amber in the
# Data tab and "Normal" on Monitor at the same time, with nothing in the bell
# and nothing emailed. Two screens disagreeing about one sensor teaches the
# operator that neither can be trusted.
# --------------------------------------------------------------------------- #

CFG = {"warn_min": 20, "warn_max": 80, "alarm_min": 10, "alarm_max": 90}


def _open_kinds(value, config=CFG) -> set[str]:
    return {k for k, breached, _ in value_conditions(value, config) if breached}


def test_value_conditions_always_reports_every_kind():
    """All four kinds come back every time, breached or not.

    The caller needs the False rows: that is how an event opened by a threshold
    the user has since deleted gets cleared. Returning only the breached kinds
    is exactly the bug the old code had."""
    kinds = [k for k, _, _ in value_conditions(50, CFG)]
    assert kinds == ["high", "low", "warn_high", "warn_low"]


def test_inside_every_band_opens_nothing():
    assert _open_kinds(50) == set()


def test_warn_band_opens_only_warn():
    """The regression the user reported: amber in the Data tab, silence on Monitor."""
    assert _open_kinds(85) == {"warn_high"}
    assert _open_kinds(15) == {"warn_low"}


def test_alarm_band_opens_only_alarm_not_warn_as_well():
    """One severity at a time — kritis must not also raise waspada.

    Both bands are breached at 95, but a sensor listed twice (once red, once
    amber) reads as two problems. Matches the Data tab's tagStatusOf."""
    assert _open_kinds(95) == {"high"}
    assert _open_kinds(5) == {"low"}


def test_thresholds_are_exclusive_at_the_boundary():
    """Sitting exactly ON a threshold is not a breach — matches `>` / `<`.

    An inclusive comparison would make a sensor parked on a round number
    (a setpoint, very often) flap in and out of alarm on sensor noise."""
    assert _open_kinds(80) == set()
    assert _open_kinds(20) == set()
    assert _open_kinds(90) == {"warn_high"}
    assert _open_kinds(10) == {"warn_low"}


def test_warn_alone_works_without_any_alarm_bounds():
    """A sensor given only a warn band still reports. Half-configured is normal
    while someone is still tuning a new sensor."""
    assert _open_kinds(85, {"warn_max": 80}) == {"warn_high"}
    assert _open_kinds(15, {"warn_min": 20}) == {"warn_low"}


def test_alarm_alone_behaves_exactly_as_before_warn_existed():
    """Tags configured before the warn band existed must not change behaviour."""
    only_alarm = {"alarm_min": 10, "alarm_max": 90}
    assert _open_kinds(95, only_alarm) == {"high"}
    assert _open_kinds(5, only_alarm) == {"low"}
    assert _open_kinds(50, only_alarm) == set()


def test_no_bounds_at_all_opens_nothing():
    assert _open_kinds(1e9, {}) == set()
    assert _open_kinds(-1e9, None) == set()


def test_thresholds_reported_with_the_kind_that_used_them():
    """The email/panel prints this number, so it must be the bound that fired —
    not the alarm bound on a waspada row."""
    by_kind = {k: t for k, breached, t in value_conditions(85, CFG) if breached}
    assert by_kind == {"warn_high": 80.0}
    by_kind = {k: t for k, breached, t in value_conditions(95, CFG) if breached}
    assert by_kind == {"high": 90.0}


def test_inverted_bands_still_resolve_to_one_severity():
    """Nothing stops a user typing warn tighter than alarm the wrong way round.
    Whatever they typed, the sensor must not end up both red and amber."""
    weird = {"warn_min": 90, "warn_max": 10, "alarm_min": 20, "alarm_max": 80}
    for value in (5, 50, 95):
        opened = _open_kinds(value, weird)
        assert not ({"high", "low"} & opened and {"warn_high", "warn_low"} & opened)


# --------------------------------------------------------------------------- #
# Sensor-silence window: max(3 × interval, 60 s); ring tags = flat 60 s
# --------------------------------------------------------------------------- #


def test_silent_window_scales_with_the_tag_own_interval():
    """3x interval, 60 s floor, for EVERY tag.

    This replaced a branch that gave non-store tags a flat 60 s window. Once
    the store lane was retired every tag took that branch — and a `slowest` tag
    reports exactly once per 60 s, so a 60 s window made it silent between
    every pair of readings. The engine would open a `silent` event, the next
    reading would clear it, forever. That is the regression this pins."""
    s = _settings()
    assert _silent_after_s(s, {"sampling_level": "slow"}) == 90       # 30 s x 3
    assert _silent_after_s(s, {"sampling_level": "slowest"}) == 180   # 60 s x 3


def test_the_floor_still_protects_fast_levels():
    """fastest (2 s) x 3 = 6 s would fire on any momentary hiccup."""
    s = _settings()
    assert _silent_after_s(s, {"sampling_level": "fastest"}) == SILENT_FLOOR_S
    assert _silent_after_s(s, {"sampling_level": "fast"}) == SILENT_FLOOR_S
    assert _silent_after_s(s, {}) == SILENT_FLOOR_S  # no level → default "fast"


def test_a_slowest_tag_is_never_silent_between_two_normal_readings():
    """The failure stated as the operator would see it: readings arrive exactly
    one interval apart, which is healthy, and must not raise an alarm."""
    s = _settings()
    interval = s.level_slowest_s
    assert _silent_after_s(s, {"sampling_level": "slowest"}) > interval


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


def test_every_level_is_legal_for_every_tag():
    """The slow/slowest-only restriction existed solely to keep a month of rows
    under Excel's sheet limit in the store lane's archive. That lane is retired,
    so the restriction went with it — and a leftover `store_enabled` key in some
    old config must not resurrect it."""
    for level in ("fastest", "fast", "slow", "slowest"):
        validate_sampling_level({"sampling_level": level})
        validate_sampling_level({"store_enabled": True, "sampling_level": level})


def test_validate_level_rejects_unknown():
    with pytest.raises(ValueError):
        validate_sampling_level({"sampling_level": "turbo"})


def test_tag_create_request_rejects_an_unknown_level():
    with pytest.raises(ValueError):
        TagCreateRequest(
            sheet_id=uuid.uuid4(),
            source="simulator",
            device_key="SIM-01",
            label="Suhu",
            config={"sampling_level": "turbo"},
        )


# Reset-cycle math (parse_cycle_start / cycle_reset_at / add_months) was
# deleted with the store lane — there is no per-tag clock left to compute.


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


def test_message_warn_says_waspada_not_alarm():
    """Waspada is a heads-up, not a breach.

    Giving both the same "ALARM:" subject is how operators learn to skim past
    all of them — the word has to keep meaning something."""
    subject, body = build_message(
        _event("warn_high", trigger_value=82.0, threshold=80.0), _tag(), "triggered"
    )
    assert subject.startswith("WASPADA")
    assert "ALARM" not in subject
    assert "82" in subject and "80" in body
    assert "di atas batas waspada" in body
    assert "Belum melewati batas alarm" in body


def test_message_warn_low():
    subject, body = build_message(
        _event("warn_low", trigger_value=18.0, threshold=20.0),
        _tag("Level Tangki", "m"),
        "triggered",
    )
    assert subject.startswith("WASPADA")
    assert "di bawah batas waspada" in body


def test_message_warn_cleared_pairs_with_the_warn():
    """Clearing reuses the shared value wording, so the label must exist there
    too — a missing KIND_LABELS entry would raise KeyError mid-notification."""
    subject, body = build_message(
        _event("warn_high", trigger_value=82.0, threshold=80.0), _tag(), "cleared"
    )
    assert "NORMAL" in subject
    assert "di atas batas waspada" in body


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
