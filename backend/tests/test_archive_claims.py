"""Stale-claim release (audit B1) — the reaper that unfreezes retention.

What is worth testing here is narrow but sharp. release_stale is four lines of
SQL, and every one of the four is load-bearing:

  - the WHERE must exclude drive_file_id IS NOT NULL, or it would delete the
    PROOF that a month is on Drive and re-authorise archiving something already
    archived (harmless) while un-authorising a DROP (not harmless — it is the
    freeze this module exists to prevent, just moved),
  - the WHERE must exclude fresh claims, or two backends racing normally would
    reap each other constantly,
  - the table name must be allowlisted, because it is interpolated,
  - the cutoff must actually be `now - STALE_H`, not a constant.

The caller's half of the contract — "if my claim vanished while I was
uploading, write nothing and walk away" — is tested next to the caller, in
test_rollup_archiver.py.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import archive_claims as ac

UTC = timezone.utc
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)


def run(coro):
    return asyncio.run(coro)


class _Session:
    """Records the DELETE it is handed and reports N reaped rows."""

    def __init__(self, reaped=()):
        self._reaped = list(reaped)
        self.sql = None
        self.params = None
        self.commits = 0

    async def execute(self, stmt, params=None):
        self.sql = " ".join(str(stmt).split())
        self.params = params
        return SimpleNamespace(all=lambda: [(r,) for r in self._reaped])

    async def commit(self):
        self.commits += 1


def test_only_unfinished_claims_are_released():
    """drive_file_id IS NOT NULL is the evidence a DROP is allowed to trust.
    Reaping it would be deleting the proof, not the claim."""
    db = _Session()
    run(ac.release_stale(db, "scada_rollup_archives", NOW))

    assert "DELETE FROM scada_rollup_archives" in db.sql
    assert "drive_file_id IS NULL" in db.sql
    assert "created_at < :cutoff" in db.sql


def test_the_cutoff_is_now_minus_the_configured_window(monkeypatch):
    monkeypatch.setattr(ac, "STALE_H", 6)
    db = _Session()
    run(ac.release_stale(db, "scada_rollup_archives", NOW))

    assert db.params["cutoff"] == NOW - timedelta(hours=6)


def test_an_explicit_window_overrides_the_default(monkeypatch):
    """partitions/archiver tests pin the clock; this knob lets them pin the
    window too without touching module state."""
    monkeypatch.setattr(ac, "STALE_H", 6)
    db = _Session()
    run(ac.release_stale(db, "scada_rollup_archives", NOW, stale_h=48))

    assert db.params["cutoff"] == NOW - timedelta(hours=48)


def test_a_healthy_pass_releases_nothing_and_still_commits():
    db = _Session()
    assert run(ac.release_stale(db, "scada_rollup_archives", NOW)) == 0
    assert db.commits == 1


def test_the_count_returned_is_the_number_reaped():
    db = _Session(reaped=["Lombok 2026-07-01", "Bekasi 2026-07-01"])
    assert run(ac.release_stale(db, "scada_rollup_archives", NOW)) == 2


def test_an_unknown_table_is_refused_before_any_sql_runs():
    """The table name is interpolated into the statement — a bind parameter
    cannot name a table. The allowlist is the entire defence, so it must fail
    before execute(), not inside it."""
    db = _Session()
    with pytest.raises(ValueError):
        run(ac.release_stale(db, "profiles; DROP TABLE documents", NOW))
    assert db.sql is None


def test_the_live_ledger_is_accepted():
    """A rename that misses this module would otherwise turn the reaper into a
    silent no-op — and a silent no-op is the exact bug B1 was."""
    db = _Session()
    run(ac.release_stale(db, "scada_rollup_archives", NOW))
    assert "scada_rollup_archives" in db.sql


def test_the_retired_tag_ledger_is_refused():
    """scada_tag_archives has no claim writer since the store lane was retired.
    Accepting it would be dead capability that reads as "that lane still runs"."""
    with pytest.raises(ValueError):
        run(ac.release_stale(_Session(), "scada_tag_archives", NOW))


def test_every_allowlisted_ledger_has_a_label_expression():
    """The log line names the bucket; a missing entry would KeyError inside the
    reaper, i.e. exactly when something has already gone wrong."""
    assert set(ac.LEDGERS) == set(ac._LABEL_COLS)
