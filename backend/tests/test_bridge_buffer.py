"""W3 — bridge disk store-and-forward crash recovery.

The promise: a value received by the bridge but not yet flushed to Supabase
survives a hard process kill / PC restart instead of leaving a hole in the
history. These tests drive the real ingest path (_on_message writes the SQLite
buffer), simulate a crash (no graceful shutdown), then a fresh Bridge instance
on the same buffer file and prove the value is replayed to Supabase.

The bridge lives at deploy/data/bridge.py (outside the app package); it's loaded
by path. Supabase is stubbed with a fake psycopg connection that records the
INSERTs, so nothing touches a real database.
"""

import importlib.util
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BRIDGE_PATH = Path(__file__).resolve().parents[2] / "deploy" / "data" / "bridge.py"


def _load_bridge():
    spec = importlib.util.spec_from_file_location("rnet_bridge", BRIDGE_PATH)
    mod = importlib.util.module_from_spec(spec)
    # Register before exec so @dataclass (which looks the module up in
    # sys.modules by __module__) resolves during import.
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


bridge_mod = _load_bridge()
Bridge = bridge_mod.Bridge


# --- Supabase stub ---------------------------------------------------------- #


class FakeCursor:
    def __init__(self, sink, fail):
        self._sink = sink
        self._fail = fail

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def execute(self, sql, params=None):
        if self._fail:
            raise RuntimeError("database down")
        self._sink.append((sql, params))

    def executemany(self, sql, seq):
        if self._fail:
            raise RuntimeError("database down")
        for params in seq:
            self._sink.append((sql, params))


class FakeConn:
    def __init__(self, sink, fail=False):
        self._sink = sink
        self._fail = fail
        self.closed = False

    def cursor(self):
        return FakeCursor(self._sink, self._fail)


class FakeMsg:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


def _inserts(sink, table):
    return [p for (sql, p) in sink if f"INSERT INTO {table}" in sql]


# --- tests ------------------------------------------------------------------ #


def test_crash_recovery_replays_unflushed_value(tmp_path):
    buf = str(tmp_path / "buf.db")
    site, tag, topic = "site-1", str(uuid.uuid4()), "rnet/plant/temp"

    # --- process A: receive a value, then get killed before any flush ---
    a = Bridge("", buffer_path=buf)
    # topic -> {field or None -> tag}; None = "this topic carries one number"
    a._routes = {site: {topic: {None: tag}}}
    a._xform = {tag: (1.0, 0.0, None)}
    a._on_message(None, site, FakeMsg(topic, b'{"value": 72.5}'))

    buffered = a._buffer_all()
    assert len(buffered) == 1 and buffered[0][0] == tag  # value is on disk
    a._buf.close()  # simulate the OS releasing the killed process's file handle

    # --- process B: restart on the same buffer file, recover ---
    b = Bridge("", buffer_path=buf)
    b._interval = {tag: 60}  # store tag → scada_samples
    b._ring = set()
    sink = []
    b._db = lambda: FakeConn(sink)

    b.recover_buffer()

    sent = _inserts(sink, "scada_samples")
    assert len(sent) == 1
    tag_id, ts, value = sent[0]
    assert tag_id == tag and value == 72.5  # the exact value reached Supabase
    assert b._buffer_all() == []  # buffer cleared after confirmed store


def test_recovery_routes_ring_tag_to_scada_raw(tmp_path):
    """Recovered ring values land in scada_raw (phase 5), not scada_samples,
    and carry the tag's plant so the row is complete — a recovered row must be
    indistinguishable from one written live."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    site = str(uuid.uuid4())
    a = Bridge("", buffer_path=buf)
    a._buffer_put(tag, datetime.now(timezone.utc), 3.0)
    a._buf.close()

    b = Bridge("", buffer_path=buf)
    b._interval = {tag: 5}
    b._ring = {tag}  # ring tag → scada_raw, not scada_samples
    b._site_of = {tag: site}
    sink = []
    b._db = lambda: FakeConn(sink)
    b.recover_buffer()

    raw = _inserts(sink, "scada_raw")
    assert len(raw) == 1
    assert raw[0][2] == site  # site_id stamped onto the recovered row
    assert _inserts(sink, "scada_samples") == []
    assert _inserts(sink, "scada_ring") == []  # the old lane is no longer written


def test_recovery_without_site_mapping_still_stores(tmp_path):
    """A tag whose site is unknown (config not loaded yet) must still be
    recovered — site_id is metadata, losing a reading would be worse."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    a = Bridge("", buffer_path=buf)
    a._buffer_put(tag, datetime.now(timezone.utc), 4.0)
    a._buf.close()

    b = Bridge("", buffer_path=buf)
    b._interval = {tag: 5}
    b._ring = {tag}
    sink = []
    b._db = lambda: FakeConn(sink)
    b.recover_buffer()

    raw = _inserts(sink, "scada_raw")
    assert len(raw) == 1
    assert raw[0][2] is None


def test_recovery_keeps_rows_when_db_still_down(tmp_path):
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    a = Bridge("", buffer_path=buf)
    a._buffer_put(tag, datetime.now(timezone.utc), 9.0)
    a._buf.close()

    b = Bridge("", buffer_path=buf)
    b._interval = {tag: 60}
    b._ring = set()
    b._db = lambda: FakeConn([], fail=True)  # Supabase still unreachable

    b.recover_buffer()
    # Nothing was confirmed stored → the value stays for the next restart.
    assert len(b._buffer_all()) == 1


def test_flush_success_clears_buffer(tmp_path):
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)
    br._interval = {tag: 1}

    ts = datetime.now(timezone.utc)
    br._buffer_put(tag, ts, 5.0)
    br._pending[tag] = 5.0
    br._buf_ts[tag] = ts
    br._bucket[tag] = 0  # armed in the distant past → boundary already crossed

    sink = []
    br._db = lambda: FakeConn(sink)
    br.flush()

    assert len(_inserts(sink, "scada_samples")) == 1
    assert br._buffer_all() == []  # deleted only after Supabase confirmed


def test_flush_failure_keeps_buffer(tmp_path):
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)
    br._interval = {tag: 1}

    ts = datetime.now(timezone.utc)
    br._buffer_put(tag, ts, 5.0)
    br._pending[tag] = 5.0
    br._buf_ts[tag] = ts
    br._bucket[tag] = 0

    br._db = lambda: FakeConn([], fail=True)
    br.flush()

    assert len(br._buffer_all()) == 1  # store failed → disk copy retained
    assert br._pending.get(tag) == 5.0  # and re-queued in memory too


def test_newer_message_not_deleted_by_stale_flush(tmp_path):
    """A value flushed for an old ts must not delete a newer buffered value the
    ingest path wrote meanwhile (delete matches on the exact ts)."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)

    old_ts = datetime.now(timezone.utc)
    # flush() captured this old ts as the row to delete...
    br._buffer_delete_many  # (used below)

    # A newer message overwrote the buffer row (same tag PK, newer ts/value).
    newer_ts = datetime.now(timezone.utc).replace(microsecond=999999)
    br._buffer_put(tag, newer_ts, 88.0)

    # The stale delete for old_ts removes nothing → newer value survives.
    br._buffer_delete_many([(tag, old_ts.isoformat())])
    remaining = br._buffer_all()
    assert len(remaining) == 1 and remaining[0][2] == 88.0


# --- D-9: the buffer is a QUEUE, not one slot per sensor -------------------


def test_outage_keeps_every_bucket_not_just_the_last(tmp_path):
    """THE D-9 SCENARIO. Supabase unreachable across several buckets: every
    stamped bucket must survive on disk, not just the most recent reading.

    Before the fix the buffer's primary key was tag_id alone, so each new
    reading overwrote the previous unsent one — an hour of outage left exactly
    one value per sensor, while the file header promised store-and-forward."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)
    br._interval = {tag: 1}
    br._ring = set()
    br._db = lambda: FakeConn([], fail=True)  # Supabase down for the whole test

    base = datetime(2026, 7, 27, 10, 0, tzinfo=timezone.utc)
    for i in range(5):
        ts = base + timedelta(seconds=i)
        br._buffer_put(tag, ts, float(i))
        br._buf_ts[tag] = ts
        br._pending[tag] = float(i)
        br._bucket[tag] = 0  # boundary already crossed → flush stamps a row
        br.flush()           # fails; must SEAL this bucket on disk

    rows = br._buffer_all()
    assert len(rows) == 5, f"expected 5 queued buckets, got {len(rows)}"
    assert {r[2] for r in rows} == {0.0, 1.0, 2.0, 3.0, 4.0}


def test_in_flight_value_is_still_replaced_while_healthy(tmp_path):
    """The queue must not grow on every message when nothing is wrong: readings
    inside the SAME unflushed bucket still collapse to the newest one."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)

    base = datetime(2026, 7, 27, 10, 0, tzinfo=timezone.utc)
    for i in range(10):
        ts = base + timedelta(seconds=i)
        br._buffer_put(tag, ts, float(i))
        br._buf_ts[tag] = ts  # still in flight — nothing sealed it

    rows = br._buffer_all()
    assert len(rows) == 1
    assert rows[0][2] == 9.0  # the newest


def test_queue_survives_restart_and_replays_all_of_it(tmp_path):
    """A sealed queue must still be there after the process dies, and recovery
    must replay every entry — not just one."""
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    a = Bridge("", buffer_path=buf)
    base = datetime(2026, 7, 27, 10, 0, tzinfo=timezone.utc)
    for i in range(4):
        a._buffer_put(tag, base + timedelta(seconds=i), float(i))
        # no _buf_ts bookkeeping → each write is a distinct queued entry
    a._buf.close()

    b = Bridge("", buffer_path=buf)
    b._interval = {tag: 1}
    b._ring = set()
    sink = []
    b._db = lambda: FakeConn(sink)
    b.recover_buffer()

    assert len(_inserts(sink, "scada_samples")) == 4
    assert b._buffer_all() == []  # cleared only after confirmed storage


def test_queue_has_a_hard_ceiling(tmp_path, monkeypatch):
    """An unbounded queue is its own outage — it would fill the field PC's
    disk. Past the cap the OLDEST entries are dropped."""
    monkeypatch.setattr(bridge_mod, "BUFFER_MAX_ROWS", 10)
    buf = str(tmp_path / "buf.db")
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=buf)

    base = datetime(2026, 7, 27, 10, 0, tzinfo=timezone.utc)
    for i in range(25):
        br._buffer_put(tag, base + timedelta(seconds=i), float(i))

    rows = br._buffer_all()
    assert len(rows) == 10
    assert min(r[2] for r in rows) == 15.0  # oldest dropped, newest kept


def test_old_buffer_file_is_migrated_not_discarded(tmp_path):
    """A field PC updating mid-outage must not lose what it was holding."""
    import sqlite3

    path = str(tmp_path / "buf.db")
    old = sqlite3.connect(path)
    old.execute(
        "CREATE TABLE pending_samples ("
        "tag_id TEXT PRIMARY KEY, ts TEXT NOT NULL, value REAL NOT NULL)"
    )
    tag = str(uuid.uuid4())
    old.execute(
        "INSERT INTO pending_samples VALUES (?, ?, ?)",
        (tag, datetime(2026, 7, 27, 9, 0, tzinfo=timezone.utc).isoformat(), 42.0),
    )
    old.commit()
    old.close()

    br = Bridge("", buffer_path=path)
    rows = br._buffer_all()
    assert len(rows) == 1 and rows[0][2] == 42.0

    # ...and the migrated table now accepts MULTIPLE rows per tag.
    br._buffer_put(tag, datetime(2026, 7, 27, 9, 1, tzinfo=timezone.utc), 43.0)
    assert len(br._buffer_all()) == 2
