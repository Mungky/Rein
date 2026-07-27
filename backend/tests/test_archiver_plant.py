"""Per-plant archive: grouping, streaming, staggering (audit D-7, D-8).

The archiver is the one component that DELETES data, so the tests here are
weighted towards the properties whose failure loses it:

  - a sheet per sensor, with unique titles (Excel rejects duplicates, and
    R-Net labels are not unique — 'Holding' appears three times live),
  - keyset streaming that returns every row exactly once, with no gap at a
    chunk boundary and no infinite loop,
  - staggering that only ever moves a cycle EARLIER, never later.

The delete-only-after-successful-upload rule is enforced by archive_plant_cycle
and is exercised against the real Drive in the release checklist; what is
verified here is everything that can be pinned without a database or network.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.services import archiver

UTC = timezone.utc


# --- sheet titles ---------------------------------------------------------


def test_duplicate_labels_get_unique_sheet_titles():
    """Three sensors named 'Holding' exist in the live database today. Excel
    refuses duplicate sheet titles, so this would have crashed the whole
    plant's archive."""
    out = archiver._unique_titles(["Holding", "Holding", "Holding", "Premix"])
    assert out == ["Holding", "Holding (2)", "Holding (3)", "Premix"]
    assert len(set(out)) == 4


def test_sheet_titles_stay_within_excel_limit():
    long = "Sensor dengan nama yang sangat panjang sekali melebihi batas"
    out = archiver._unique_titles([long, long, long])
    assert all(len(t) <= 31 for t in out)
    assert len(set(out)) == 3


def test_illegal_sheet_characters_are_stripped():
    assert "/" not in archiver._safe_sheet_title("Line/1")
    assert archiver._safe_sheet_title("[]:*?/\\") == "Sensor"  # nothing left → fallback


# --- staggering -----------------------------------------------------------


def test_stagger_is_stable_for_a_given_tag():
    """It must not move between passes, or a tag's due date would drift."""
    tid = uuid.uuid4()
    assert archiver.stagger_offset(tid) == archiver.stagger_offset(tid)


def test_stagger_never_pushes_a_cycle_later():
    """The offset is SUBTRACTED from the clock start. A positive offset can
    only make a cycle come due earlier, never overrun the configured window."""
    for _ in range(50):
        off = archiver.stagger_offset(uuid.uuid4())
        assert timedelta(0) <= off <= timedelta(days=archiver.STAGGER_DAYS)


def test_stagger_actually_spreads_tags_apart():
    """The whole point: tags configured in one sitting must not stay in
    lockstep. 200 tags should land across most of the window."""
    offsets = [archiver.stagger_offset(uuid.uuid4()).total_seconds() / 86400
               for _ in range(200)]
    assert max(offsets) - min(offsets) > archiver.STAGGER_DAYS * 0.8
    # and not clumped into one day
    assert len({int(o) for o in offsets}) >= archiver.STAGGER_DAYS


def test_stagger_can_be_disabled(monkeypatch):
    monkeypatch.setattr(archiver, "STAGGER_DAYS", 0)
    assert archiver.stagger_offset(uuid.uuid4()) == timedelta(0)


# --- streaming ------------------------------------------------------------


class _StreamDB:
    """Serves rows from a fixed list, honouring ts >= cursor, ts < end, LIMIT."""

    def __init__(self, rows):
        self.rows = sorted(rows)
        self.queries = 0

    async def execute(self, stmt):
        self.queries += 1
        compiled = stmt.compile()
        params = compiled.params
        lo = params["ts_1"]
        hi = params["ts_2"]
        limit = stmt._limit
        got = [r for r in self.rows if lo <= r[0] < hi][:limit]
        return _Rows(got)


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


def _collect(rows, chunk):
    import asyncio

    db = _StreamDB(rows)

    async def go():
        out = []
        async for r in archiver.stream_tag_rows(
            db, uuid.uuid4(), datetime(2026, 1, 1, tzinfo=UTC),
            datetime(2027, 1, 1, tzinfo=UTC), chunk=chunk,
        ):
            out.append(r)
        return out

    return asyncio.run(go()), db


def _make(n):
    base = datetime(2026, 3, 1, tzinfo=UTC)
    return [(base + timedelta(seconds=30 * i), float(i)) for i in range(n)]


def test_streaming_returns_every_row_exactly_once():
    rows = _make(250)
    got, _ = _collect(rows, chunk=100)
    assert got == rows


def test_no_row_is_lost_or_duplicated_at_a_chunk_boundary():
    """The keyset cursor advances past the last emitted ts. Off by one in
    either direction silently drops a reading or repeats it."""
    rows = _make(300)
    got, _ = _collect(rows, chunk=100)  # exact multiple — boundary on every page
    assert len(got) == 300
    assert len({r[0] for r in got}) == 300


def test_streaming_terminates_on_a_short_final_page():
    rows = _make(105)
    got, db = _collect(rows, chunk=100)
    assert len(got) == 105
    assert db.queries == 2  # full page, then the short one — no extra probe


def test_streaming_of_an_empty_window_costs_one_query():
    got, db = _collect([], chunk=100)
    assert got == []
    assert db.queries == 1


def test_streaming_does_not_load_everything_at_once():
    """Memory-flatness is the point of D-7: a long cycle must be many small
    pages, not one big fetch."""
    rows = _make(10_000)
    got, db = _collect(rows, chunk=1_000)
    assert len(got) == 10_000
    assert db.queries >= 10


# --- configuration sanity -------------------------------------------------


def test_plants_per_run_is_capped():
    """Without a cap, one due day stampedes every plant at once (D-8)."""
    assert 1 <= archiver.MAX_PLANTS_PER_RUN <= 10


def test_email_attachment_has_a_size_ceiling():
    """A per-plant workbook is far bigger than the old per-sensor one; past the
    ceiling the mail must carry the link instead of bouncing."""
    assert archiver.EMAIL_ATTACH_MAX_B > 0
