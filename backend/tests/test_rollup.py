"""Per-minute rollup — window, partitions, idempotence (ARSITEKTUR-DATA §2.5).

The aggregation itself is plain SQL and is verified against the real database
(see the phase-3 verification queries). What needs pinning here is everything
AROUND the query, because getting any of it wrong corrupts the summary silently:

  - the window must end at the last CLOSED minute — summarising a minute still
    in progress would freeze a partial average forever, since ON CONFLICT DO
    NOTHING means it is never revisited,
  - the window must look BACK far enough that a restart heals itself,
  - month partitions must exist before the insert, including across a month
    boundary, because a missing partition is an error, not an auto-create,
  - the backfill must chunk, commit per chunk, and snap to minute boundaries.

A stub session factory records every statement.
"""

import asyncio
import sys
import types
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.services import rollup


class _Result:
    def __init__(self, rowcount=0):
        self.rowcount = rowcount


class _Session:
    def __init__(self, log):
        self._log = log
        self.commits = 0

    async def execute(self, stmt, params=None):
        self._log.append((" ".join(str(stmt).split()), params))
        return _Result(1)

    async def commit(self):
        self.commits += 1


def _install(monkeypatch, log):
    sessions = []

    @asynccontextmanager
    async def factory():
        s = _Session(log)
        sessions.append(s)
        yield s

    module = types.ModuleType("db.session")
    module.async_session_factory = factory
    monkeypatch.setitem(sys.modules, "db.session", module)
    return sessions


def _inserts(log):
    return [(s, p) for s, p in log if s.startswith("INSERT INTO scada_rollup_1m")]


def _partitions(log):
    return [s for s, _ in log if "PARTITION OF" in s]


# --- window ---------------------------------------------------------------


def test_window_ends_at_last_closed_minute(monkeypatch):
    """10:35:47 → the window must stop at 10:35:00. The 10:35 minute is still
    running; freezing its partial average would be permanent."""
    log = []
    _install(monkeypatch, log)
    now = datetime(2026, 7, 26, 10, 35, 47, 123456, tzinfo=timezone.utc)

    asyncio.run(rollup.rollup_once(now=now))

    _, params = _inserts(log)[0]
    assert params["end"] == datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)
    assert params["end"].second == 0 and params["end"].microsecond == 0


def test_window_looks_back_so_a_restart_heals(monkeypatch):
    """Minutes missed while the backend was down are re-examined, not lost."""
    log = []
    _install(monkeypatch, log)
    now = datetime(2026, 7, 26, 10, 35, 0, tzinfo=timezone.utc)

    asyncio.run(rollup.rollup_once(now=now))

    _, params = _inserts(log)[0]
    assert params["end"] - params["start"] == timedelta(minutes=rollup.LOOKBACK_MIN)


def test_exactly_on_the_minute_still_excludes_the_current_minute(monkeypatch):
    """At 10:35:00.000 the 10:35 minute has zero seconds of data in it yet."""
    log = []
    _install(monkeypatch, log)
    now = datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)

    asyncio.run(rollup.rollup_once(now=now))

    _, params = _inserts(log)[0]
    assert params["end"] == now


# --- partitions -----------------------------------------------------------


def test_partition_created_before_insert(monkeypatch):
    """Order matters: a row with no partition is an error."""
    log = []
    _install(monkeypatch, log)

    asyncio.run(rollup.rollup_once(now=datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)))

    kinds = ["part" if "PARTITION OF" in s else "ins" for s, _ in log
             if "PARTITION OF" in s or s.startswith("INSERT")]
    assert kinds == ["part", "ins"]
    assert "scada_rollup_1m_2026_07" in _partitions(log)[0]


def test_month_boundary_creates_both_drawers(monkeypatch):
    """A window straddling midnight on the 1st needs last month AND this one."""
    log = []
    _install(monkeypatch, log)
    # 00:05 on 1 Aug with a 10-minute lookback reaches back into 31 Jul.
    asyncio.run(rollup.rollup_once(now=datetime(2026, 8, 1, 0, 5, tzinfo=timezone.utc)))

    parts = _partitions(log)
    assert len(parts) == 2
    assert any("scada_rollup_1m_2026_07" in p for p in parts)
    assert any("scada_rollup_1m_2026_08" in p for p in parts)


def test_december_partition_rolls_into_january(monkeypatch):
    """Month arithmetic must not produce month 13."""
    log = []
    _install(monkeypatch, log)

    asyncio.run(rollup.rollup_once(now=datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc)))

    part = _partitions(log)[0]
    assert "scada_rollup_1m_2026_12" in part
    assert "'2027-01-01" in part  # upper bound wrapped correctly


def test_partition_creation_is_idempotent(monkeypatch):
    """Called every cycle — must never fail on an existing drawer."""
    log = []
    _install(monkeypatch, log)

    asyncio.run(rollup.rollup_once(now=datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)))

    assert all("IF NOT EXISTS" in p for p in _partitions(log))


# --- the insert itself ----------------------------------------------------


def test_insert_is_idempotent_and_stamps_the_plant(monkeypatch):
    """Re-running a minute must not duplicate or overwrite it, and every row
    carries its plant so per-plant archive/delete stays cheap (audit D-1)."""
    log = []
    _install(monkeypatch, log)

    asyncio.run(rollup.rollup_once(now=datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)))

    sql, _ = _inserts(log)[0]
    assert "ON CONFLICT (ts, tag_id) DO NOTHING" in sql
    assert "t.site_id" in sql
    assert "count(*)" in sql  # n: distinguishes "quiet" from "broken"


def test_never_writes_to_the_raw_lanes(monkeypatch):
    """The rollup only ever READS raw. Any write there would be a bug."""
    log = []
    _install(monkeypatch, log)

    asyncio.run(rollup.rollup_once(now=datetime(2026, 7, 26, 10, 35, tzinfo=timezone.utc)))

    for sql, _ in log:
        if sql.startswith(("INSERT", "UPDATE", "DELETE")):
            assert "scada_rollup_1m" in sql.split("FROM")[0]


# --- backfill -------------------------------------------------------------


def test_backfill_chunks_by_hour_and_commits_each(monkeypatch):
    log = []
    sessions = _install(monkeypatch, log)
    start = datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 26, 3, 0, tzinfo=timezone.utc)

    asyncio.run(rollup.backfill(start, end, chunk_h=1))

    ins = _inserts(log)
    assert len(ins) == 3
    assert [p["start"].hour for _, p in ins] == [0, 1, 2]
    assert [p["end"].hour for _, p in ins] == [1, 2, 3]
    assert all(s.commits == 1 for s in sessions)


def test_backfill_last_chunk_is_clipped_to_end(monkeypatch):
    """A range that is not a whole number of chunks must not overshoot."""
    log = []
    _install(monkeypatch, log)
    start = datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 26, 2, 30, tzinfo=timezone.utc)

    asyncio.run(rollup.backfill(start, end, chunk_h=1))

    assert _inserts(log)[-1][1]["end"] == end


def test_backfill_snaps_to_minute_boundaries(monkeypatch):
    """Sub-minute bounds would slice a minute in half and store a partial one."""
    log = []
    _install(monkeypatch, log)
    start = datetime(2026, 7, 26, 0, 0, 37, 500000, tzinfo=timezone.utc)
    end = datetime(2026, 7, 26, 0, 30, 12, tzinfo=timezone.utc)

    asyncio.run(rollup.backfill(start, end))

    _, p = _inserts(log)[0]
    assert p["start"] == datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc)
    assert p["end"] == datetime(2026, 7, 26, 0, 30, tzinfo=timezone.utc)


def test_backfill_empty_range_does_nothing(monkeypatch):
    log = []
    _install(monkeypatch, log)
    t = datetime(2026, 7, 26, 5, 0, tzinfo=timezone.utc)

    assert asyncio.run(rollup.backfill(t, t)) == 0
    assert _inserts(log) == []
