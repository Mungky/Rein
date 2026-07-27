"""Ring retention sweep — batching + termination (audit data D-3).

The sweep replaced one unbounded `DELETE ... WHERE ts < cutoff` per bridge per
minute with a single batched sweeper on the backend. What matters, and what a
database is not needed to verify, is the loop's contract:

  - it keeps taking batches while they come back FULL (there is more backlog),
  - it stops on the first SHORT batch (nothing expired is left),
  - it never runs away: MAX_BATCHES caps one cycle,
  - it reads the window from scada_settings rather than hardcoding 24 h,
  - it only ever touches scada_ring.

A stub session factory records every statement and dictates each batch's
rowcount, so all of the above is observable.
"""

import asyncio
import sys
import types
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app.services import ring_pruner


class _Result:
    def __init__(self, rowcount):
        self.rowcount = rowcount


class _Session:
    def __init__(self, log, rowcounts, settings):
        self._log = log
        self._rowcounts = rowcounts
        self._settings = settings
        self.commits = 0

    async def execute(self, stmt, params=None):
        self._log.append((str(stmt), params))
        return _Result(self._rowcounts.pop(0) if self._rowcounts else 0)

    async def get(self, _model, _pk):
        return self._settings

    async def commit(self):
        self.commits += 1


def _install_factory(monkeypatch, log, rowcounts, ring_window_h=24):
    """Stub db.session.async_session_factory — imported inside prune_once()."""
    settings = SimpleNamespace(ring_window_h=ring_window_h)
    sessions = []

    @asynccontextmanager
    async def factory():
        s = _Session(log, rowcounts, settings)
        sessions.append(s)
        yield s

    module = types.ModuleType("db.session")
    module.async_session_factory = factory
    monkeypatch.setitem(sys.modules, "db.session", module)
    return sessions


def test_stops_on_first_short_batch(monkeypatch):
    """Two full batches then a short one → exactly three deletes, no more."""
    log = []
    _install_factory(monkeypatch, log, [ring_pruner.BATCH, ring_pruner.BATCH, 7])

    total = asyncio.run(ring_pruner.prune_once())

    deletes = [s for s, _ in log if "DELETE FROM scada_ring" in s]
    assert len(deletes) == 3
    assert total == ring_pruner.BATCH * 2 + 7


def test_empty_table_costs_exactly_one_batch(monkeypatch):
    """The common case — nothing expired — must not loop."""
    log = []
    _install_factory(monkeypatch, log, [0])

    assert asyncio.run(ring_pruner.prune_once()) == 0
    assert len([s for s, _ in log if "DELETE" in s]) == 1


def test_cap_bounds_a_huge_backlog(monkeypatch):
    """Every batch full → stop at MAX_BATCHES so one cycle cannot run forever."""
    log = []
    # More full batches available than the cap allows.
    _install_factory(monkeypatch, log, [ring_pruner.BATCH] * (ring_pruner.MAX_BATCHES + 5))

    total = asyncio.run(ring_pruner.prune_once())

    assert len([s for s, _ in log if "DELETE" in s]) == ring_pruner.MAX_BATCHES
    assert total == ring_pruner.BATCH * ring_pruner.MAX_BATCHES


def test_window_comes_from_settings_and_batch_is_bounded(monkeypatch):
    """The cutoff follows the admin-tunable ring_window_h, and every batch
    carries a LIMIT — the two properties the old bridge statement lacked."""
    log = []
    _install_factory(monkeypatch, log, [0], ring_window_h=6)

    asyncio.run(ring_pruner.prune_once())

    sql, params = next((s, p) for s, p in log if "DELETE" in s)
    assert params == {"hours": 6, "batch": ring_pruner.BATCH}
    assert "LIMIT :batch" in sql
    assert "make_interval(hours => :hours)" in sql


def test_never_touches_the_historian_lane(monkeypatch):
    """scada_samples rows may only be deleted by the archiver, after a
    successful export to Drive. This sweep must never mention that table."""
    log = []
    _install_factory(monkeypatch, log, [ring_pruner.BATCH, 0])

    asyncio.run(ring_pruner.prune_once())

    assert all("scada_samples" not in sql for sql, _ in log)


def test_each_batch_commits_on_its_own(monkeypatch):
    """An interrupted cycle keeps the work it already did."""
    log = []
    sessions = _install_factory(monkeypatch, log, [ring_pruner.BATCH, 3])

    asyncio.run(ring_pruner.prune_once())

    # One session for the settings read, then one per delete batch.
    delete_sessions = [s for s in sessions if s.commits]
    assert len(delete_sessions) == 2
    assert all(s.commits == 1 for s in delete_sessions)
