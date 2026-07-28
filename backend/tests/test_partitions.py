"""Partition housekeeping — the half that can lose data, and the half that can't.

Two failure modes matter here and neither is caught by ordinary use:

  MISSING DRAWER AHEAD  -> Postgres REJECTS the insert and the reading is gone
                           forever. Silent, and only at midnight.
  DROPPING TOO EARLY    -> data deleted before it expired. Also silent.

Both are pure date arithmetic, so both can be pinned exactly with a stubbed
clock and a stubbed session — no database required.
"""

import asyncio
import sys
import types
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import partitions

UTC = timezone.utc


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    """Records SQL; answers partition-listing queries from `existing`.

    `nonempty` lists partitions that should look like they hold rows, so the
    "an empty drawer needs no archive" shortcut can be steered per test."""

    def __init__(self, log, existing, nonempty=()):
        self._log = log
        self._existing = list(existing)
        self._nonempty = set(nonempty)
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self._log.append(sql)
        if sql.startswith("SELECT 1 FROM public.") and sql.endswith("LIMIT 1"):
            name = sql.split("SELECT 1 FROM public.")[1].split()[0]
            return _Result([(1,)] if name in self._nonempty else [])
        if "FROM pg_class" in sql:
            pat = (params or {}).get("pat", "").replace("\\", "").replace("%", "")
            return _Result([(n,) for n in sorted(self._existing) if n.startswith(pat)])
        if sql.startswith("DROP TABLE public."):
            name = sql.split("DROP TABLE public.")[1].strip()
            if name in self._existing:
                self._existing.remove(name)
        if sql.startswith("CREATE TABLE IF NOT EXISTS public."):
            name = sql.split("public.")[1].split()[0]
            if name not in self._existing:
                self._existing.append(name)
        return _Result([])

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _install(monkeypatch, log, existing, ring_window_h=24, nonempty=(), archived=None):
    """Stub the session, the settings row, and the summary archive ledger.

    `archived` = the set of months rollup_archiver reports as verifiably on
    Drive. Default None means "assume everything is archived", so the tests that
    are about DATE ARITHMETIC are not also testing the archive gate; the tests
    that are about the gate pass it explicitly."""
    @asynccontextmanager
    async def factory():
        yield _Session(log, existing, nonempty)

    module = types.ModuleType("db.session")
    module.async_session_factory = factory
    monkeypatch.setitem(sys.modules, "db.session", module)

    async def fake_settings(_db):
        return SimpleNamespace(ring_window_h=ring_window_h)

    monkeypatch.setattr(partitions.rnet_settings, "get_settings", fake_settings)

    from app.services import rollup_archiver

    async def fake_archived(_db):
        if archived is not None:
            return set(archived)
        return {
            date(int(m[1]), int(m[2]), 1)
            for n in existing
            if (m := partitions._ROLLUP_RE.match(n))
        }

    monkeypatch.setattr(rollup_archiver, "fully_archived_months", fake_archived)


def _created(log):
    return [s.split("public.")[1].split()[0]
            for s in log if s.startswith("CREATE TABLE IF NOT EXISTS")]


def _dropped(log):
    return [s.split("DROP TABLE public.")[1].strip()
            for s in log if s.startswith("DROP TABLE public.")]


# --- creating ahead: the data-loss half -----------------------------------


def test_creates_a_full_runway_of_future_days(monkeypatch):
    log = []
    _install(monkeypatch, log, existing=[])
    now = datetime(2026, 7, 26, 13, 5, tzinfo=UTC)

    asyncio.run(partitions.maintain_once(now=now))

    made = [n for n in _created(log) if n.startswith("scada_raw_")]
    assert "scada_raw_2026_07_26" in made          # today
    assert "scada_raw_2026_07_27" in made          # tomorrow — the midnight case
    assert len(made) == partitions.RAW_AHEAD_DAYS + 1


def test_runway_crosses_month_and_year_boundaries(monkeypatch):
    """31 Dec + 7 days lands in January of the next year. Naive month/day
    arithmetic breaks exactly here."""
    log = []
    _install(monkeypatch, log, existing=[])

    asyncio.run(partitions.maintain_once(now=datetime(2026, 12, 31, 23, 30, tzinfo=UTC)))

    made = _created(log)
    assert "scada_raw_2026_12_31" in made
    assert "scada_raw_2027_01_01" in made
    assert "scada_raw_2027_01_07" in made
    assert "scada_rollup_1m_2027_01" in made  # summary drawer rolls over too


def test_leap_day_is_created(monkeypatch):
    log = []
    _install(monkeypatch, log, existing=[])

    asyncio.run(partitions.maintain_once(now=datetime(2028, 2, 26, 6, 0, tzinfo=UTC)))

    assert "scada_raw_2028_02_29" in _created(log)


def test_existing_partitions_are_not_recreated(monkeypatch):
    """Runs hourly — it must be quiet when there is nothing to do."""
    now = datetime(2026, 7, 26, 13, 5, tzinfo=UTC)
    have = [f"scada_raw_{(now + timedelta(days=d)):%Y_%m_%d}"
            for d in range(0, partitions.RAW_AHEAD_DAYS + 1)]
    have += ["scada_rollup_1m_2026_07", "scada_rollup_1m_2026_08"]
    log = []
    _install(monkeypatch, log, existing=have)

    res = asyncio.run(partitions.maintain_once(now=now))

    assert res["created_raw"] == 0
    assert res["created_rollup"] == 0


def test_partitions_are_created_before_any_are_dropped(monkeypatch):
    """If a pass is interrupted, the half that ran must be the half that
    prevents data loss."""
    log = []
    _install(monkeypatch, log, existing=["scada_raw_2026_07_01"])

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 13, 5, tzinfo=UTC)))

    first_drop = next(i for i, s in enumerate(log) if s.startswith("DROP TABLE"))
    last_create = max(i for i, s in enumerate(log)
                      if s.startswith("CREATE TABLE IF NOT EXISTS"))
    assert last_create < first_drop


# --- dropping behind: the correctness half --------------------------------


def test_a_day_is_kept_until_all_of_it_has_expired(monkeypatch):
    """The 24-48 h consequence, pinned. At 12:00 on the 26th with a 24 h
    window the cutoff is 12:00 on the 25th — the 25th's drawer still holds
    rows from 12:00-23:59 that are INSIDE the window, so it must survive."""
    log = []
    _install(monkeypatch, log, existing=[
        "scada_raw_2026_07_24", "scada_raw_2026_07_25", "scada_raw_2026_07_26",
    ])

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    dropped = _dropped(log)
    assert "scada_raw_2026_07_24" in dropped   # fully older than the cutoff
    assert "scada_raw_2026_07_25" not in dropped
    assert "scada_raw_2026_07_26" not in dropped


def test_retention_window_is_read_from_settings(monkeypatch):
    """An admin who widens ring_window_h to 72 h must keep three days."""
    log = []
    _install(monkeypatch, log, existing=[
        "scada_raw_2026_07_20", "scada_raw_2026_07_23", "scada_raw_2026_07_24",
        "scada_raw_2026_07_25", "scada_raw_2026_07_26",
    ], ring_window_h=72)

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    dropped = _dropped(log)
    assert "scada_raw_2026_07_20" in dropped
    assert "scada_raw_2026_07_23" not in dropped  # inside the 72 h window


def test_never_drops_below_the_floor(monkeypatch):
    """A clock jump or timezone mistake could make EVERY partition look
    expired. The newest MIN_KEEP_RAW must survive that regardless — tested
    against drop_expired_raw directly, so the drawers the creation step would
    have added cannot mask the guard."""
    log = []
    have = [f"scada_raw_2020_01_{d:02d}" for d in range(1, 6)]
    session = _Session(log, have)

    # Cutoff far in the future: every single partition looks expired.
    dropped = asyncio.run(
        partitions.drop_expired_raw(
            session, datetime(2030, 1, 1, tzinfo=UTC), window_h=24
        )
    )

    assert len(dropped) == len(have) - partitions.MIN_KEEP_RAW
    survivors = set(have) - set(dropped)
    assert survivors == {"scada_raw_2020_01_04", "scada_raw_2020_01_05"}  # the newest


def test_floor_protects_the_newest_not_an_arbitrary_pair(monkeypatch):
    """Order matters: protecting the OLDEST would keep the useless drawers and
    delete the live one."""
    log = []
    have = ["scada_raw_2026_07_20", "scada_raw_2026_07_25", "scada_raw_2026_07_26"]
    session = _Session(log, have)

    dropped = asyncio.run(
        partitions.drop_expired_raw(
            session, datetime(2030, 1, 1, tzinfo=UTC), window_h=24
        )
    )

    assert dropped == ["scada_raw_2026_07_20"]


def test_the_raw_sweep_never_catches_a_summary_partition(monkeypatch):
    """`scada_raw\\_%` and `scada_rollup_1m_%` are different sweeps with
    different rules — the raw one runs on a 24 h window and answers to nobody,
    so it must not be able to reach a summary month. Both lanes are given
    droppable partitions here so a leak would show up as the wrong name in the
    wrong bucket."""
    log = []
    _install(monkeypatch, log, existing=[
        "scada_raw_2020_01_01", "scada_raw_2020_01_02", "scada_raw_2020_01_03",
        "scada_rollup_1m_2020_01", "scada_rollup_1m_2026_06",
        "scada_rollup_1m_2026_07",
    ])

    res = asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    assert res["dropped_raw"] and all(
        n.startswith("scada_raw_") for n in res["dropped_raw"]
    )
    assert all(n.startswith("scada_rollup_1m_") for n in res["dropped_rollup"])
    # The current month is never a candidate either way.
    assert "scada_rollup_1m_2026_07" not in _dropped(log)


# --- the summary table: retention is gated on a verified archive -----------
#
# This lane is the only surviving record of anything older than ~48 h, so being
# old enough is NOT sufficient grounds to delete it. Every test below is about
# the second condition.


def test_default_keeps_at_least_thirty_days_of_summary(monkeypatch):
    """1 month behind = a summary row lives 30-61 days. Dropping to 0 here
    would silently switch retention off for the whole lane."""
    assert partitions.ROLLUP_KEEP_MONTHS >= 1


def test_summary_drop_respects_keep_months(monkeypatch):
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 2)
    _install(monkeypatch, log, existing=[
        "scada_rollup_1m_2026_03", "scada_rollup_1m_2026_04",
        "scada_rollup_1m_2026_05", "scada_rollup_1m_2026_06",
        "scada_rollup_1m_2026_07",
    ])

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    dropped = [n for n in _dropped(log) if n.startswith("scada_rollup_1m")]
    assert "scada_rollup_1m_2026_03" in dropped
    assert "scada_rollup_1m_2026_04" in dropped
    assert "scada_rollup_1m_2026_05" not in dropped  # within keep window
    assert "scada_rollup_1m_2026_06" not in dropped


def test_an_expired_month_is_kept_while_it_is_not_on_drive(monkeypatch):
    """THE test for this module. Drive down, credentials wrong, archiver
    switched off — whatever the reason, an unarchived month must survive being
    old. The failure this prevents is permanent and silent."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 1)
    have = [
        "scada_rollup_1m_2026_04", "scada_rollup_1m_2026_05",
        "scada_rollup_1m_2026_06", "scada_rollup_1m_2026_07",
    ]
    _install(monkeypatch, log, existing=have, nonempty=have, archived=set())

    res = asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    assert res["dropped_rollup"] == []
    assert not any(n.startswith("scada_rollup_1m") for n in _dropped(log))


def test_only_the_months_confirmed_on_drive_are_dropped(monkeypatch):
    """A partial backlog is the normal state: the archiver caps how many months
    it handles per pass. The ones it finished may go; the rest wait."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 1)
    have = [
        "scada_rollup_1m_2026_03", "scada_rollup_1m_2026_04",
        "scada_rollup_1m_2026_05", "scada_rollup_1m_2026_06",
        "scada_rollup_1m_2026_07",
    ]
    _install(
        monkeypatch, log, existing=have, nonempty=have,
        archived={date(2026, 3, 1), date(2026, 5, 1)},
    )

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    dropped = [n for n in _dropped(log) if n.startswith("scada_rollup_1m")]
    assert dropped == ["scada_rollup_1m_2026_03", "scada_rollup_1m_2026_05"]
    assert "scada_rollup_1m_2026_04" not in dropped  # expired but not archived


def test_an_empty_month_needs_no_archive(monkeypatch):
    """Drawers are created a month ahead. One that was never written to has no
    ledger row and never will — without this exemption empty partitions would
    accumulate forever."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 1)
    have = [
        "scada_rollup_1m_2026_04", "scada_rollup_1m_2026_05",
        "scada_rollup_1m_2026_06", "scada_rollup_1m_2026_07",
    ]
    # 2026_04 holds rows, 2026_05 is an empty leftover. Neither is archived.
    _install(
        monkeypatch, log, existing=have,
        nonempty=["scada_rollup_1m_2026_04"], archived=set(),
    )

    asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    dropped = [n for n in _dropped(log) if n.startswith("scada_rollup_1m")]
    assert dropped == ["scada_rollup_1m_2026_05"]


def test_summary_floor_survives_a_clock_jump(monkeypatch):
    """Same guarantee as the raw lane: even with every month archived and a
    cutoff far in the future, the newest MIN_KEEP_ROLLUP must not be dropped."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 1)
    have = [f"scada_rollup_1m_2020_{m:02d}" for m in range(1, 6)]
    _install(monkeypatch, log, existing=have, nonempty=have)
    session = _Session(log, have, nonempty=have)

    dropped = asyncio.run(
        partitions.drop_expired_rollup(session, datetime(2030, 1, 1, tzinfo=UTC))
    )

    assert len(dropped) == len(have) - partitions.MIN_KEEP_ROLLUP
    assert set(have) - set(dropped) == {
        "scada_rollup_1m_2020_04", "scada_rollup_1m_2020_05",
    }


def test_the_24h_lane_is_pruned_even_when_the_summary_side_blows_up(monkeypatch):
    """The two lanes must not be able to stop each other.

    They shared one transaction, so anything raised while pruning the summary
    rolled back the raw DROPs that had already run. That is not hypothetical:
    the summary side reads the archive ledger, which does not exist on any
    database that has not run `alembic upgrade head` — and production does not
    migrate on deploy. Symptom: the 24 h lane silently stops being pruned and
    grows ~2.8 GB/day/plant, with only "maintenance iteration failed" in the
    log."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 1)
    _install(monkeypatch, log, existing=[
        "scada_raw_2020_01_01", "scada_raw_2020_01_02", "scada_raw_2020_01_03",
        "scada_rollup_1m_2019_01", "scada_rollup_1m_2026_07",
    ])

    from app.services import rollup_archiver

    async def boom(_db):
        raise RuntimeError('relation "scada_rollup_archives" does not exist')

    monkeypatch.setattr(rollup_archiver, "fully_archived_months", boom)

    res = asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    # All three 2020 drawers are expired and none is protected (the floor holds
    # the newest two, which by then are the freshly-created future ones).
    assert res["dropped_raw"] == [
        "scada_raw_2020_01_01", "scada_raw_2020_01_02", "scada_raw_2020_01_03",
    ]
    assert res["dropped_rollup"] == []                      # summary side gave up
    assert res["future_raw"] == partitions.RAW_AHEAD_DAYS   # and the pass finished


def test_summary_drop_is_off_when_keep_months_is_zero(monkeypatch):
    """The escape hatch: ROLLUP_KEEP_MONTHS=0 still means keep forever, and it
    must short-circuit before the ledger is even consulted."""
    log = []
    monkeypatch.setattr(partitions, "ROLLUP_KEEP_MONTHS", 0)
    have = ["scada_rollup_1m_2019_01", "scada_rollup_1m_2019_02",
            "scada_rollup_1m_2026_07"]
    _install(monkeypatch, log, existing=have, nonempty=have)

    res = asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 12, 0, tzinfo=UTC)))

    assert res["dropped_rollup"] == []


# --- reporting -------------------------------------------------------------


def test_reports_remaining_runway(monkeypatch):
    """The number an operator needs to see before inserts start failing."""
    log = []
    _install(monkeypatch, log, existing=[])

    res = asyncio.run(partitions.maintain_once(now=datetime(2026, 7, 26, 13, 5, tzinfo=UTC)))

    assert res["future_raw"] == partitions.RAW_AHEAD_DAYS
