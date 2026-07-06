"""Simulator determinism — the historian's core promise.

Backfilled history and the live sampler both call `sim_value`; they only line
up (and multi-writer ON CONFLICT dedup only works) if the value is a pure
function of (tag id, minute).
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.historian import _aligned_minute, sim_value


def _tag(config: dict | None = None, tag_id: uuid.UUID | None = None):
    return SimpleNamespace(id=tag_id or uuid.uuid4(), config=config or {})


NOON = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)


def test_same_tag_same_minute_same_value():
    tag = _tag()
    assert sim_value(tag, NOON) == sim_value(tag, NOON)


def test_different_tags_differ_at_same_minute():
    cfg = {"base": 50, "amplitude": 10, "noise": 1}
    values = {sim_value(_tag(cfg), NOON) for _ in range(5)}
    assert len(values) > 1  # distinct seeds → distinct waveforms


def test_values_vary_over_time():
    tag = _tag({"base": 50, "amplitude": 10, "period_s": 3600, "noise": 0})
    values = {sim_value(tag, NOON + timedelta(minutes=m)) for m in range(30)}
    assert len(values) > 1


def test_clamped_to_config_min_max():
    tag = _tag({"base": 95, "amplitude": 30, "noise": 5, "min": 0, "max": 100})
    for m in range(0, 300, 7):
        v = sim_value(tag, NOON + timedelta(minutes=m))
        assert 0 <= v <= 100


def test_decimals_respected():
    tag = _tag({"decimals": 1})
    v = sim_value(tag, NOON)
    assert v == round(v, 1)


def test_aligned_minute_strips_seconds():
    at = datetime(2026, 7, 5, 12, 34, 56, 789000, tzinfo=timezone.utc)
    aligned = _aligned_minute(at)
    assert aligned.second == 0 and aligned.microsecond == 0
    assert aligned.minute == 34
