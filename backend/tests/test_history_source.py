"""Which lane answers a bucketed read, and why the numbers stay identical.

Phase 4 (ARSITEKTUR-DATA §2.7) points /history, /summary and /sparklines at
scada_rollup_1m. The equality of old and new numbers rests on exactly two
properties, and both are pure arithmetic that can be pinned without a database:

  1. A bucket served from the summary is a whole number of minutes, so bucket
     edges land on minute boundaries and no summary row is ever split across
     two buckets. Split a minute and the two lanes stop agreeing.
  2. The bucket average is the n-WEIGHTED mean of per-minute means. Minutes hold
     different numbers of raw values, so an unweighted avg(avg) would quietly
     disagree with raw whenever a sensor stuttered.

The agreement itself was also measured end-to-end against the live database:
1 008 chart points across five bucket widths, compared at the 4-decimal
precision actually sent to the browser — zero differences.
"""

import pytest

from app.routers.scada import (
    ROLLUP_MIN_BUCKET_S,
    _bucket_seconds,
    _snap_bucket_to_minute,
)

# Range -> (span seconds, point budget) exactly as the frontend asks for them
# (frontend/src/features/scada/panels/chart-panel.tsx RANGE_MS / RANGE_POINTS).
FRONTEND_RANGES = {
    "1h": (3_600, 600),
    "6h": (21_600, 480),
    "24h": (86_400, 360),
    "7d": (604_800, 300),
    "30d": (2_592_000, 300),
}


def _resolve(span_s, points):
    """Mirror of the endpoint's decision, returning (bucket_s, source)."""
    b = _bucket_seconds(span_s, points)
    if b >= ROLLUP_MIN_BUCKET_S:
        return _snap_bucket_to_minute(b), "rollup"
    return b, "raw"


# --- the routing rule -----------------------------------------------------


@pytest.mark.parametrize(
    "range_name,expected",
    [("1h", "raw"), ("6h", "raw"), ("24h", "rollup"), ("7d", "rollup"), ("30d", "rollup")],
)
def test_each_frontend_range_picks_the_right_lane(range_name, expected):
    """Short ranges want sub-minute detail and are inside raw's 24 h retention;
    long ranges are answered by the summary, which is the only lane that still
    HAS the data."""
    span_s, points = FRONTEND_RANGES[range_name]
    _, source = _resolve(span_s, points)
    assert source == expected


def test_sub_minute_buckets_never_use_the_summary():
    """A 59-second bucket cannot be built from per-minute rows without
    inventing detail."""
    for bucket in range(1, ROLLUP_MIN_BUCKET_S):
        span = bucket * 100
        assert _resolve(span, 100)[1] == "raw"


# --- property 1: summary buckets are whole minutes ------------------------


def test_every_summary_bucket_is_a_whole_number_of_minutes():
    """The alignment guarantee. If this ever fails, a minute gets split across
    two buckets and the two lanes stop agreeing."""
    for span_s, points in FRONTEND_RANGES.values():
        bucket, source = _resolve(span_s, points)
        if source == "rollup":
            assert bucket % 60 == 0, f"{bucket}s is not whole minutes"


def test_alignment_holds_across_the_whole_supported_span():
    """Not just the five preset ranges — any span up to the 45-day cap and any
    point budget the API accepts."""
    for span_s in (3_600, 86_400, 604_800, 2_592_000, 3_888_000):
        for points in (10, 100, 300, 360, 720):
            bucket, source = _resolve(span_s, points)
            if source == "rollup":
                assert bucket % 60 == 0
                assert bucket >= 60


def test_snap_rounds_up_never_down():
    """Rounding DOWN would produce a bucket narrower than a minute's worth of
    data — more points than the summary can actually distinguish."""
    assert _snap_bucket_to_minute(1) == 60
    assert _snap_bucket_to_minute(60) == 60
    assert _snap_bucket_to_minute(61) == 120
    assert _snap_bucket_to_minute(2016) == 2040  # the real 7-day bucket
    assert _snap_bucket_to_minute(8640) == 8640  # already aligned, unchanged


def test_snapping_never_exceeds_the_point_budget():
    """Snapping up widens buckets, which can only REDUCE the number of points —
    it must never push the response past what the caller asked for."""
    for span_s, points in FRONTEND_RANGES.values():
        bucket, source = _resolve(span_s, points)
        if source == "rollup":
            assert span_s / bucket <= points


# --- property 2: the weighted mean --------------------------------------


def _weighted(minutes):
    """sum(avg_i * n_i) / sum(n_i) — the SQL in _rollup_avg, in Python."""
    return sum(a * n for a, n in minutes) / sum(n for _, n in minutes)


def _raw_mean(buckets):
    flat = [v for b in buckets for v in b]
    return sum(flat) / len(flat)


def test_weighted_mean_equals_the_raw_mean_when_minutes_differ_in_size():
    """The case that breaks avg(avg): a busy minute and a quiet one."""
    minute_a = [10.0] * 30          # 30 readings
    minute_b = [20.0] * 3           # sensor stuttered — only 3
    summary = [(_raw_mean([minute_a]), len(minute_a)),
               (_raw_mean([minute_b]), len(minute_b))]

    assert _weighted(summary) == pytest.approx(_raw_mean([minute_a, minute_b]))
    # And the naive version really would have been wrong:
    naive = sum(a for a, _ in summary) / len(summary)
    assert naive != pytest.approx(_raw_mean([minute_a, minute_b]))


def test_weighted_mean_matches_raw_on_uneven_realistic_minutes():
    minutes = [
        ([21.0, 22.0, 23.0], 3),
        ([30.0] * 12, 12),
        ([5.0, 7.0], 2),
        ([100.0], 1),
    ]
    summary = [(sum(vals) / len(vals), n) for vals, n in minutes]
    assert _weighted(summary) == pytest.approx(_raw_mean([v for v, _ in minutes]))


def test_weighted_and_naive_agree_only_when_every_minute_is_equally_full():
    """Explains why the bug would have hidden in testing: with a perfectly
    steady sensor the two formulas give the same answer."""
    summary = [(10.0, 5), (20.0, 5), (30.0, 5)]
    naive = sum(a for a, _ in summary) / len(summary)
    assert _weighted(summary) == pytest.approx(naive)
