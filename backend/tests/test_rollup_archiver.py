"""Summary-lane archiving — the component that makes deleting a month legal.

Weighting follows the blast radius. Nothing in rollup_archiver.py deletes
anything, but everything it writes is the evidence partitions.py deletes on, so
the properties tested hardest are the ones whose failure turns "archived" into a
lie:

  - a bucket is only marked done when a real Drive id came back,
  - a failed export releases its claim instead of leaving a half-written one,
  - the month gate is a SUPERSET check, so one missing plant blocks the month,
  - every sensor lands in the zip exactly once, under a name no other sensor
    took, with every row it had.

Everything here runs without a database or network — the session, Drive and
email are stubbed — which is what lets these paths be exercised at all.
"""

import asyncio
import os
import tempfile
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import rollup_archiver as ra

UTC = timezone.utc


def run(coro):
    return asyncio.run(coro)


# --- names ----------------------------------------------------------------


def test_duplicate_sensor_labels_get_distinct_file_names():
    """'Holding' appears three times in the live database. Two identical names
    in one zip is a silent overwrite on some extractors and a corrupt archive on
    others — either way a sensor's month disappears while the ledger says it was
    archived."""
    out = ra.unique_names(["Holding", "Holding", "Holding", "Premix"])
    assert out == ["Holding", "Holding (2)", "Holding (3)", "Premix"]
    assert len(set(out)) == 4


def test_names_that_differ_only_by_case_still_collide():
    """Zip entries are extracted onto Windows, where 'Suhu' and 'suhu' are the
    same file."""
    out = ra.unique_names(["Suhu", "suhu"])
    assert len({n.lower() for n in out}) == 2


def test_illegal_path_characters_are_replaced():
    assert "/" not in ra.safe_name("Line 1/Level")
    assert "\\" not in ra.safe_name("Line 1\\Level")
    assert ra.safe_name(":*?") == "___"
    assert ra.safe_name("") == "Sensor"
    assert ra.safe_name("   ") == "Sensor"


def test_a_name_cannot_escape_the_zip():
    """A label like '../..' must not become a path."""
    assert "/" not in ra.safe_name("../../etc/passwd")


# --- month arithmetic -----------------------------------------------------


def test_month_bounds_are_half_open():
    lo, hi = ra.month_bounds(date(2026, 7, 1))
    assert lo == datetime(2026, 7, 1, tzinfo=UTC)
    assert hi == datetime(2026, 8, 1, tzinfo=UTC)


def test_month_bounds_roll_over_the_year():
    lo, hi = ra.month_bounds(date(2026, 12, 1))
    assert hi == datetime(2027, 1, 1, tzinfo=UTC)


# --- which months are eligible -------------------------------------------


class _ListSession:
    """Answers only the partition-listing query."""

    def __init__(self, names):
        self._names = names

    async def execute(self, stmt, params=None):
        return SimpleNamespace(all=lambda: [(n,) for n in sorted(self._names)])


def test_only_months_past_the_retention_window_are_eligible(monkeypatch):
    monkeypatch.setattr(ra.partitions, "ROLLUP_KEEP_MONTHS", 1)
    db = _ListSession([
        "scada_rollup_1m_2026_05", "scada_rollup_1m_2026_06",
        "scada_rollup_1m_2026_07", "scada_rollup_1m_2026_08",
    ])

    months = run(ra.eligible_months(db, datetime(2026, 7, 26, tzinfo=UTC)))

    # July is the current month, June is the one being kept.
    assert months == [date(2026, 5, 1)]


def test_eligible_months_come_oldest_first(monkeypatch):
    """The backlog must drain from the far end, so the database shrinks."""
    monkeypatch.setattr(ra.partitions, "ROLLUP_KEEP_MONTHS", 1)
    db = _ListSession([
        "scada_rollup_1m_2026_03", "scada_rollup_1m_2025_11",
        "scada_rollup_1m_2026_01",
    ])

    months = run(ra.eligible_months(db, datetime(2026, 7, 26, tzinfo=UTC)))

    assert months == [date(2025, 11, 1), date(2026, 1, 1), date(2026, 3, 1)]


def test_nothing_is_eligible_while_retention_is_off(monkeypatch):
    """With ROLLUP_KEEP_MONTHS=0 no month is ever dropped, so uploading them is
    pure Drive quota."""
    monkeypatch.setattr(ra.partitions, "ROLLUP_KEEP_MONTHS", 0)
    db = _ListSession(["scada_rollup_1m_2019_01"])

    assert run(ra.eligible_months(db, datetime(2026, 7, 26, tzinfo=UTC))) == []


# --- the month gate -------------------------------------------------------


def _tag(label="S", site=None, unit=""):
    return SimpleNamespace(id=uuid.uuid4(), label=label, unit=unit, site_id=site)


class _GateSession:
    """Serves scada_tags / scada_sites for plant_buckets, and the ledger rows
    for fully_archived_months."""

    def __init__(self, tags, sites, ledger):
        self._tags = tags
        self._sites = sites
        self._ledger = ledger

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "scada_rollup_archives" in sql:
            return SimpleNamespace(all=lambda: list(self._ledger))
        rows = self._sites if "scada_sites" in sql else self._tags
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: list(rows))
        )


def test_a_month_is_complete_only_when_every_plant_is_on_drive():
    a, b = uuid.uuid4(), uuid.uuid4()
    sites = [SimpleNamespace(id=a, name="Lombok"), SimpleNamespace(id=b, name="Bekasi")]
    tags = [_tag(site=a), _tag(site=b)]
    db = _GateSession(tags, sites, ledger=[(date(2026, 5, 1), a)])

    assert run(ra.fully_archived_months(db)) == set()   # Bekasi still missing

    db = _GateSession(tags, sites, ledger=[(date(2026, 5, 1), a), (date(2026, 5, 1), b)])
    assert run(ra.fully_archived_months(db)) == {date(2026, 5, 1)}


def test_sensors_without_a_plant_are_their_own_bucket():
    """Simulator tags, and tags whose plant was deleted, still hold summary
    rows. If they were not a bucket, their data would be dropped with the month
    without ever being archived."""
    a = uuid.uuid4()
    sites = [SimpleNamespace(id=a, name="Lombok")]
    tags = [_tag(site=a), _tag(site=None)]

    db = _GateSession(tags, sites, ledger=[(date(2026, 5, 1), a)])
    assert run(ra.fully_archived_months(db)) == set()

    db = _GateSession(
        tags, sites, ledger=[(date(2026, 5, 1), a), (date(2026, 5, 1), None)]
    )
    assert run(ra.fully_archived_months(db)) == {date(2026, 5, 1)}


def test_a_new_plant_reopens_a_month_rather_than_letting_it_drop():
    """Buckets are recomputed every pass, so adding a plant makes a previously
    finished month incomplete again until its (empty) bucket is written. The
    conservative direction: kept too long, never deleted uncovered."""
    a, b = uuid.uuid4(), uuid.uuid4()
    ledger = [(date(2026, 5, 1), a)]
    one_plant = _GateSession([_tag(site=a)], [SimpleNamespace(id=a, name="L")], ledger)
    assert run(ra.fully_archived_months(one_plant)) == {date(2026, 5, 1)}

    two_plants = _GateSession(
        [_tag(site=a), _tag(site=b)],
        [SimpleNamespace(id=a, name="L"), SimpleNamespace(id=b, name="B")],
        ledger,
    )
    assert run(ra.fully_archived_months(two_plants)) == set()


def test_no_tags_at_all_means_no_month_is_ever_declared_complete():
    """An empty superset makes `wanted <= keys` trivially true, which would
    green-light dropping every month in the ledger."""
    db = _GateSession([], [], ledger=[(date(2026, 5, 1), None)])
    assert run(ra.fully_archived_months(db)) == set()


def test_plant_names_are_snapshotted_and_path_safe():
    a = uuid.uuid4()
    db = _GateSession(
        [_tag(site=a)], [SimpleNamespace(id=a, name="Lombok / Line 1")], []
    )
    buckets = run(ra.plant_buckets(db))
    _sid, plant, _tags = buckets[str(a)]
    assert "/" not in plant and " " not in plant


# --- building the zip -----------------------------------------------------


class _RowSession:
    """Serves stream_tag_month from an in-memory {tag_id: [(ts, avg, min, max, n)]}."""

    def __init__(self, data):
        self._data = data

    async def execute(self, stmt, params):
        rows = self._data.get(params["tag"], [])
        # The caller advances `lo` past the last row it saw, so honouring both
        # bounds on every call is what makes the paging real rather than a
        # stub that would pass even if the cursor never moved.
        window = [r for r in rows if params["lo"] <= r[0] < params["hi"]]
        return SimpleNamespace(all=lambda: window[: params["lim"]])


def _minutes(start, n, value=1.0):
    return [(start + timedelta(minutes=i), value + i, value, value + i, 12)
            for i in range(n)]


def _zip_to_dict(path):
    with zipfile.ZipFile(path) as zf:
        return {n: zf.read(n).decode("utf-8") for n in zf.namelist()}


def test_every_sensor_gets_a_csv_with_all_its_rows():
    t1, t2 = _tag("Suhu", unit="C"), _tag("Level")
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    db = _RowSession({t1.id: _minutes(lo, 5), t2.id: _minutes(lo, 3)})

    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        counts = run(ra.build_plant_zip(db, [t1, t2], lo, lo + timedelta(days=31), path))
        files = _zip_to_dict(path)
    finally:
        os.unlink(path)

    assert counts == {t1.id: 5, t2.id: 3}
    assert set(files) == {"Suhu.csv", "Level.csv"}
    # header + rows, and the unit is carried into the column names
    assert files["Suhu.csv"].splitlines()[0] == "waktu_utc,rata (C),min (C),maks (C),jumlah_data"
    assert len(files["Suhu.csv"].strip().splitlines()) == 6
    assert files["Suhu.csv"].splitlines()[1].startswith("2026-05-01 00:00,")


def test_a_silent_sensor_still_gets_a_file():
    """A missing file is ambiguous; an empty one says 'configured, reported
    nothing all month' — which is what an operator needs to see."""
    t1, t2 = _tag("Ada"), _tag("Bisu")
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    db = _RowSession({t1.id: _minutes(lo, 2)})

    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        counts = run(ra.build_plant_zip(db, [t1, t2], lo, lo + timedelta(days=31), path))
        files = _zip_to_dict(path)
    finally:
        os.unlink(path)

    assert counts[t2.id] == 0
    assert "Bisu.csv" in files
    assert len(files["Bisu.csv"].strip().splitlines()) == 1  # header only


def test_paging_returns_every_row_exactly_once():
    """The chunk boundary is where a keyset cursor drops or repeats a row, and
    either one is invisible in the finished file."""
    t = _tag("Padat")
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    db = _RowSession({t.id: _minutes(lo, 250)})

    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        counts = run(
            ra.build_plant_zip(db, [t], lo, lo + timedelta(days=31), path)
        )
        body = _zip_to_dict(path)["Padat.csv"]
    finally:
        os.unlink(path)

    lines = body.strip().splitlines()[1:]
    assert counts[t.id] == 250
    assert len(lines) == 250
    assert len({ln.split(",")[0] for ln in lines}) == 250  # no repeats


def test_rows_outside_the_month_are_not_exported():
    """The window is what makes the archive match the partition being dropped."""
    t = _tag("S")
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    hi = datetime(2026, 6, 1, tzinfo=UTC)
    db = _RowSession({t.id: _minutes(lo, 3) + _minutes(hi, 4)})

    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        counts = run(ra.build_plant_zip(db, [t], lo, hi, path))
    finally:
        os.unlink(path)

    assert counts[t.id] == 3


def test_values_survive_the_round_trip_unrounded():
    """The archive replaces the database; a rounded archive would quietly
    disagree with it."""
    t = _tag("S")
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    db = _RowSession({t.id: [(lo, 27.712963104248, 27.7, 27.72, 12)]})

    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        run(ra.build_plant_zip(db, [t], lo, lo + timedelta(days=31), path))
        body = _zip_to_dict(path)["S.csv"]
    finally:
        os.unlink(path)

    assert "27.712963104248" in body


# --- the claim: marked done only on a real upload -------------------------


class _ClaimSession:
    """Enough of an AsyncSession for archive_plant_month."""

    def __init__(self, rows=None, claim=True, claim_vanishes=False):
        self._rows = rows or {}
        self._claim = claim
        # True = our claim row is gone by the time the upload finishes, i.e.
        # archive_claims released it as stale and another pass took over.
        self._vanished = claim_vanishes
        self.deleted = []
        self.stored = {}
        self.rolled_back = False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "INSERT INTO scada_rollup_archives" in sql:
            got = uuid.uuid4() if self._claim else None
            return SimpleNamespace(scalar_one_or_none=lambda: got)
        rows = self._rows.get(params["tag"], []) if params else []
        page = [r for r in rows if r[0] >= params["lo"]][: params["lim"]]
        return SimpleNamespace(all=lambda: page)

    async def get(self, model, ident):
        # Zona waktu tampilan dibaca lewat db.get(ScadaSettings, 1). Dijawab
        # terpisah — kalau ikut masuk `stored`, baris setelan itu akan menyamar
        # jadi baris buku induk dan asersi di bawah memeriksa objek yang salah.
        if getattr(model, "__name__", "") == "ScadaSettings":
            return SimpleNamespace(display_timezone="UTC")
        if self._vanished:
            return None
        return self.stored.setdefault(
            ident,
            SimpleNamespace(
                id=ident, drive_file_id=None, web_link=None,
                row_count=0, tag_count=0,
            ),
        )

    async def delete(self, row):
        self.deleted.append(row)

    async def commit(self):
        pass

    async def rollback(self):
        self.rolled_back = True


def _stub_drive(monkeypatch, upload):
    from app.services import gdrive

    async def folder(_name, _parent=None):
        return "folder-id"

    monkeypatch.setattr(gdrive, "find_or_create_folder", folder)
    monkeypatch.setattr(gdrive, "upload_file_sync", upload)

    async def no_email(*_a, **_k):
        return None

    monkeypatch.setattr(ra, "_email_plant_month", no_email)


def test_a_bucket_is_marked_done_when_drive_returns_an_id(monkeypatch):
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    t = _tag("S")
    db = _ClaimSession({t.id: _minutes(lo, 4)})

    async def upload(_content, name, _mime, _folder):
        return {"id": "drive-123", "webViewLink": "https://x/" + name}

    _stub_drive(monkeypatch, upload)

    res = run(ra.archive_plant_month(db, uuid.uuid4(), "Lombok", [t], date(2026, 5, 1)))

    assert res["rows"] == 4
    assert res["drive_file_id"] == "drive-123"
    assert db.deleted == []
    row = next(iter(db.stored.values()))
    assert row.drive_file_id == "drive-123" and row.row_count == 4


def test_a_claim_released_mid_upload_is_not_written_back(monkeypatch):
    """Audit B1, the losing side of the race.

    Our claim sat unfinished long enough to be released as stale, and another
    pass re-claimed the bucket while we were still uploading. Writing our
    ledger row now would resurrect a claim nobody is tracking — and, worse,
    would mark the bucket done on the strength of an upload the owning pass
    knows nothing about. The correct move is to walk away: our file is a
    duplicate on Drive, and this function deletes nothing anyway."""
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    t = _tag("S")
    db = _ClaimSession({t.id: _minutes(lo, 4)}, claim_vanishes=True)

    async def upload(_content, name, _mime, _folder):
        return {"id": "drive-123", "webViewLink": "https://x/" + name}

    _stub_drive(monkeypatch, upload)

    res = run(ra.archive_plant_month(db, uuid.uuid4(), "Lombok", [t], date(2026, 5, 1)))

    assert res is None
    assert db.stored == {}       # no ledger row invented
    assert db.deleted == []      # and the peer's claim left alone
    assert db.rolled_back


def test_an_upload_that_returns_no_id_is_not_treated_as_archived(monkeypatch):
    """Drive answering 200 with an empty body would otherwise mark the month
    safe to delete. This is the exact shape of a silent data-loss bug."""
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    t = _tag("S")
    db = _ClaimSession({t.id: _minutes(lo, 4)})

    async def upload(*_a):
        return {}

    _stub_drive(monkeypatch, upload)

    res = run(ra.archive_plant_month(db, uuid.uuid4(), "Lombok", [t], date(2026, 5, 1)))

    assert res is None
    assert len(db.deleted) == 1          # claim released
    assert db.deleted[0].drive_file_id is None


def test_a_failed_upload_releases_the_claim_so_a_later_pass_retries(monkeypatch):
    lo = datetime(2026, 5, 1, tzinfo=UTC)
    t = _tag("S")
    db = _ClaimSession({t.id: _minutes(lo, 4)})

    async def upload(*_a):
        raise RuntimeError("Drive down")

    _stub_drive(monkeypatch, upload)

    res = run(ra.archive_plant_month(db, uuid.uuid4(), "Lombok", [t], date(2026, 5, 1)))

    assert res is None
    assert len(db.deleted) == 1


def test_a_bucket_already_claimed_by_another_backend_is_skipped(monkeypatch):
    """Laptop and server share one database; both may run this loop."""
    db = _ClaimSession(claim=False)
    _stub_drive(monkeypatch, None)

    res = run(ra.archive_plant_month(db, uuid.uuid4(), "Lombok", [_tag()], date(2026, 5, 1)))

    assert res is None
    assert db.deleted == []              # nothing to release — we never had it


def test_an_empty_month_completes_without_touching_drive(monkeypatch):
    """A plant that reported nothing must still finish its bucket, or it blocks
    the whole month forever."""
    db = _ClaimSession({})
    calls = []

    async def upload(*_a):
        calls.append(1)
        return {"id": "x"}

    _stub_drive(monkeypatch, upload)

    res = run(ra.archive_plant_month(db, None, "Tanpa-Plant", [_tag()], date(2026, 5, 1)))

    assert calls == []
    assert res["drive_file_id"] == "(kosong)"
    assert res["rows"] == 0
    row = next(iter(db.stored.values()))
    assert row.drive_file_id == "(kosong)"   # marked done, so the month can close
