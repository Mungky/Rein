"""Export dua lajur, sebagai CSV — mentah vs ringkasan per menit.

R-Net menyimpan di dua tempat dengan umur yang sangat berbeda: scada_raw
(24-48 jam) dan scada_rollup_1m (30-61 hari). Sampai belum lama ini export
hanya bisa membaca yang pertama, tanpa cara menyebutkannya — minta "bulan lalu"
dan yang keluar adalah berkas yang tampak lengkap padahal isinya sehari setengah.

Berkasnya kini CSV, bukan xlsx: satu sensor jadi .csv polos, banyak sensor jadi
.zip berisi satu CSV per sensor — bentuk yang sama dengan arsip bulanan ke Drive.

Yang diuji di sini adalah hal-hal yang kalau salah menghasilkan berkas yang
SALAH TAPI TERLIHAT BENAR:

  - bentuk berkasnya sesuai jumlah sensor (satu .csv vs .zip), karena pengguna
    yang mengunduh .zip berisi satu berkas akan mengira ada yang gagal,
  - baris ringkasan membawa jumlah_data, karena tanpa itu satu menit yang cuma
    dapat satu sampel tidak bisa dibedakan dari menit yang penuh,
  - lajur mentah memakai presisi DETIK — memotongnya ke menit akan meruntuhkan
    30 pembacaan jadi satu waktu yang terulang 30 kali,
  - nama berkas di dalam zip unik (label R-Net tidak unik),
  - sensor yang diam tetap dapat berkas berisi judul kolom,
  - satuan yang mengandung koma tidak menggeser kolom.

Semuanya jalan tanpa database: sesi dan streamernya di-stub.
"""

import asyncio
import csv as _csv
import io
import os
import tempfile
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import data_export

UTC = timezone.utc
LO = datetime(2026, 6, 1, tzinfo=UTC)
HI = datetime(2026, 7, 1, tzinfo=UTC)


def run(coro):
    return asyncio.run(coro)


def _tag(label="Suhu", unit="C"):
    return SimpleNamespace(id=uuid.uuid4(), label=label, unit=unit)


def _minutes(start, n):
    """(ts, avg, min, max, n) — bentuk baris scada_rollup_1m."""
    return [
        (start + timedelta(minutes=i), 10.0 + i, 9.0 + i, 11.0 + i, 12)
        for i in range(n)
    ]


def _seconds(start, n):
    """(ts, value) — bentuk baris scada_raw."""
    return [(start + timedelta(seconds=5 * i), 10.0 + i) for i in range(n)]


class _Session:
    """Melayani kedua streamer, dan menghormati paging keduanya.

    Dibedakan dari cara memanggilnya: lajur ringkasan memakai SQL mentah dengan
    dict params (stream_tag_month), lajur mentah memakai select SQLAlchemy yang
    param-nya harus dibaca dari statement terkompilasi (stream_raw_rows).

    Keduanya menghormati kursor dan LIMIT, bukan sekadar mengembalikan semuanya
    sekali jalan: kalau tidak, tes ini akan lolos meski keyset paging-nya rusak
    dan mengulang atau melewati baris."""

    def __init__(self, rows_by_tag):
        self._rows = rows_by_tag

    async def execute(self, stmt, params=None):
        if params is not None:  # stream_tag_month
            rows = self._rows.get(params["tag"], [])
            page = [r for r in rows if params["lo"] <= r[0] < params["hi"]]
            return SimpleNamespace(all=lambda: page[: params["lim"]])

        # stream_raw_rows — pola yang sama dipakai tes streaming di bawah.
        p = stmt.compile().params
        rows = next(
            (r for tid, r in self._rows.items() if str(tid) == str(p["tag_id_1"])), []
        )
        page = [r for r in rows if p["ts_1"] <= r[0] < p["ts_2"]][: stmt._limit]
        return SimpleNamespace(all=lambda: page)


def _build(tags, rows_by_tag, lane, lo=LO, hi=HI, tz=UTC):
    fd, path = tempfile.mkstemp()
    os.close(fd)
    try:
        counts, mime, ext = run(
            data_export.build_export(
                _Session(rows_by_tag), tags, lo, hi, lane, path, tz
            )
        )
        if ext == "zip":
            with zipfile.ZipFile(path) as zf:
                files = {n: zf.read(n).decode("utf-8") for n in zf.namelist()}
        else:
            with open(path, encoding="utf-8") as fh:
                files = {"__single__": fh.read()}
        return counts, mime, ext, files
    finally:
        os.unlink(path)


def _rows(text: str) -> list[str]:
    return [ln for ln in text.split("\n") if ln]


# --- bentuk berkas --------------------------------------------------------


def test_one_sensor_comes_back_as_a_plain_csv():
    """Membungkus satu berkas dalam zip memaksa satu langkah tambahan untuk
    kasus yang paling sering terjadi."""
    t = _tag()
    counts, mime, ext, files = _build([t], {t.id: _minutes(LO, 3)}, "rollup")

    assert ext == "csv" and mime.startswith("text/csv")
    assert set(files) == {"__single__"}
    assert counts[t.id] == 3


def test_several_sensors_come_back_as_a_zip_of_csvs():
    a, b = _tag("Suhu"), _tag("Tekanan")
    counts, mime, ext, files = _build(
        [a, b], {a.id: _minutes(LO, 2), b.id: _minutes(LO, 5)}, "rollup"
    )

    assert ext == "zip" and mime == "application/zip"
    assert set(files) == {"Suhu.csv", "Tekanan.csv"}
    assert counts[a.id] == 2 and counts[b.id] == 5


# --- isi: lajur ringkasan -------------------------------------------------


def test_summary_csv_carries_avg_min_max_and_n():
    """jumlah_data memisahkan "stabil" dari "cuma lapor sekali menit itu".
    Membuangnya membuat satu jam penuh lubang tampak persis seperti jam sehat."""
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: _minutes(LO, 2)}, "rollup")

    rows = _rows(files["__single__"])
    assert rows[0] == "waktu_utc,rata (C),min (C),maks (C),jumlah_data"
    assert rows[1] == "2026-06-01 00:00,10.0,9.0,11.0,12"
    assert len(rows) == 3


def test_summary_timestamps_are_minute_precision():
    """Tiap baris MEMANG satu bucket menit — detiknya akan selalu nol."""
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: _minutes(LO, 1)}, "rollup")
    assert _rows(files["__single__"])[1].startswith("2026-06-01 00:00,")


# --- isi: lajur mentah ----------------------------------------------------


def test_raw_csv_keeps_seconds():
    """Sensor mentah bisa 2 detik sekali. Memotong ke menit akan membuat 30
    pembacaan tampil dengan satu waktu yang sama — data yang terlihat rusak."""
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: _seconds(LO, 3)}, "raw")

    rows = _rows(files["__single__"])
    assert rows[0] == "waktu_utc,nilai (C)"
    assert rows[1] == "2026-06-01 00:00:00,10.0"
    assert rows[2] == "2026-06-01 00:00:05,11.0"


# --- hal-hal yang merusak berkas secara diam-diam -------------------------


def test_a_silent_sensor_still_gets_a_file_with_a_header():
    """Berkas kosong berkata "terpasang, tidak mengirim apa-apa". Berkas yang
    HILANG tidak berkata apa-apa, dan pembacanya mengira salah pilih."""
    quiet, busy = _tag("Diam"), _tag("Ramai")
    counts, _m, _e, files = _build([quiet, busy], {busy.id: _minutes(LO, 2)}, "rollup")

    assert counts[quiet.id] == 0
    assert _rows(files["Diam.csv"]) == [
        "waktu_utc,rata (C),min (C),maks (C),jumlah_data"
    ]


def test_duplicate_labels_get_distinct_file_names():
    """'Holding' muncul tiga kali di database asli. Dua anggota zip bernama
    sama = zip rusak di sebagian extractor, timpa diam-diam di sisanya."""
    a, b = _tag("Holding"), _tag("Holding")
    _c, _m, _e, files = _build(
        [a, b], {a.id: _minutes(LO, 1), b.id: _minutes(LO, 1)}, "rollup"
    )
    assert set(files) == {"Holding.csv", "Holding (2).csv"}


def test_a_unit_containing_a_comma_does_not_shift_the_columns():
    """Satuan itu teks bebas yang diketik operator. Tanpa dikutip, satu koma di
    dalamnya menggeser setiap kolom di kanannya — dan berkasnya tetap
    terparsing, jadi tidak ada yang sadar."""
    t = _tag("Aneh", unit="m3/h, gross")
    _c, _m, _e, files = _build([t], {t.id: _minutes(LO, 1)}, "rollup")

    header = _rows(files["__single__"])[0]
    assert "rata (m3/h, gross)" in header
    # Yang menentukan: parser CSV sungguhan tetap melihat lima kolom.
    assert len(next(_csv.reader(io.StringIO(header)))) == 5


def test_a_sensor_without_a_unit_gets_bare_column_names():
    t = _tag("Tanpa Unit", unit="")
    _c, _m, _e, files = _build([t], {t.id: []}, "rollup")
    assert _rows(files["__single__"])[0] == "waktu_utc,rata,min,maks,jumlah_data"


def test_rows_outside_the_window_are_not_exported():
    """Jendela itu janji yang dibuat berkas kepada penggunanya."""
    t = _tag()
    inside = _minutes(LO, 2)
    outside = _minutes(HI + timedelta(days=1), 5)
    counts, _m, _e, _f = _build([t], {t.id: inside + outside}, "rollup")
    assert counts[t.id] == 2


def test_values_are_not_rounded():
    """repr float Python adalah teks terpendek yang bolak-balik persis;
    membulatkan di sini membuat berkas tidak lagi cocok dengan databasenya."""
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: [(LO, 27.712963104248, 27.7, 27.72, 12)]}, "rollup")
    assert "27.712963104248" in files["__single__"]


# --- /coverage: jendela lajur dari nama partisi ---------------------------
#
# Endpoint ini yang sekarang menentukan rentang apa yang boleh diminta di
# drawer Export. Kalau salah, ia salah DIAM-DIAM: pengguna diberi rentang yang
# tidak bisa dilayani, berkasnya tetap jadi, isinya lebih pendek.

from app.routers.scada import (  # noqa: E402
    coverage_window,
    raw_partition_bounds,
    rollup_partition_bounds,
)
from app.services import partitions  # noqa: E402

NOW = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


def test_raw_window_spans_oldest_start_to_newest_end():
    names = ["scada_raw_2026_07_28", "scada_raw_2026_07_29", "scada_raw_2026_07_30"]
    lo, hi, n = coverage_window(names, partitions._RAW_RE, raw_partition_bounds, NOW)

    assert lo == datetime(2026, 7, 28, tzinfo=UTC)
    assert n == 3
    assert hi == NOW  # dijepit; batas atas partisi hari ini ada di 31 Juli 00:00


def test_pre_created_future_partitions_do_not_claim_future_data():
    """Manajer partisi membuat 7 hari laci KOSONG di depan supaya insert tak
    pernah ditolak tengah malam. Tanpa penjepitan, coverage akan melaporkan
    bahwa data hari Kamis depan sudah ada."""
    names = [f"scada_raw_2026_08_{d:02d}" for d in range(1, 8)]
    names.insert(0, "scada_raw_2026_07_29")
    _lo, hi, _n = coverage_window(names, partitions._RAW_RE, raw_partition_bounds, NOW)

    assert hi == NOW
    assert hi <= NOW, "coverage tidak boleh mengklaim data di masa depan"


def test_rollup_window_uses_month_boundaries():
    names = ["scada_rollup_1m_2026_06", "scada_rollup_1m_2026_07"]
    lo, hi, n = coverage_window(
        names, partitions._ROLLUP_RE, rollup_partition_bounds, NOW
    )

    assert lo == datetime(2026, 6, 1, tzinfo=UTC)
    assert hi == NOW
    assert n == 2


def test_december_rolls_over_to_the_next_year():
    """Pergantian tahun di aritmetika bulan adalah tempat bug klasiknya."""
    m = partitions._ROLLUP_RE.match("scada_rollup_1m_2026_12")
    assert rollup_partition_bounds(m, upper=True) == datetime(2027, 1, 1, tzinfo=UTC)


def test_a_lane_with_no_partitions_reports_nothing_rather_than_guessing():
    lo, hi, n = coverage_window([], partitions._RAW_RE, raw_partition_bounds, NOW)
    assert (lo, hi, n) == (None, None, 0)


def test_names_that_are_not_partitions_are_ignored():
    """`scada_raw` itu sendiri dan tabel lain cocok dengan pola LIKE-nya."""
    names = ["scada_raw", "scada_raw_backup", "scada_raw_2026_07_29"]
    lo, _hi, n = coverage_window(names, partitions._RAW_RE, raw_partition_bounds, NOW)
    assert n == 1 and lo == datetime(2026, 7, 29, tzinfo=UTC)


# --- keyset paging di stream_raw_rows -------------------------------------
#
# Pindahan dari test_archiver_plant.py, yang hilang bersama archiver.py. Ini
# yang menjaga sifat yang membuat export bisa dipercaya di jendela panjang:
# memori datar, dan setiap baris keluar TEPAT sekali.

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
    db = _StreamDB(rows)

    async def go():
        out = []
        async for r in data_export.stream_raw_rows(
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


# --- zona waktu tampilan --------------------------------------------------
#
# Penyimpanan UTC, layar WIB, dan sampai perbaikan ini berkasnya UTC juga —
# jadi memilih "30 Jul 00:00" di kalender menghasilkan baris pertama
# "2026-07-29 17:00:00". Datanya benar, jendelanya benar, dan sama sekali tidak
# terbaca sebagai jawaban atas yang ditanyakan.

from zoneinfo import ZoneInfo  # noqa: E402

WIB = ZoneInfo("Asia/Jakarta")


def test_rows_are_labelled_in_the_display_zone():
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: _minutes(LO, 1)}, "rollup", tz=WIB)

    rows = _rows(files["__single__"])
    # Sumbernya 2026-06-01 00:00 UTC; di WIB itu 07:00 pada hari yang sama.
    assert rows[1].startswith("2026-06-01 07:00,")


def test_the_column_is_named_after_the_zone_it_used():
    """Berkas harus menyebutkan zonanya sendiri. Judul yang salah lebih buruk
    daripada judul yang generik — pembacanya tidak punya cara tahu."""
    t = _tag()
    _c, _m, _e, wib = _build([t], {t.id: _minutes(LO, 1)}, "rollup", tz=WIB)
    _c, _m, _e, utc = _build([t], {t.id: _minutes(LO, 1)}, "rollup", tz=UTC)

    assert _rows(wib["__single__"])[0].startswith("waktu_wib,")
    assert _rows(utc["__single__"])[0].startswith("waktu_utc,")


def test_the_raw_lane_converts_too_and_keeps_seconds():
    t = _tag()
    _c, _m, _e, files = _build([t], {t.id: _seconds(LO, 1)}, "raw", tz=WIB)

    rows = _rows(files["__single__"])
    assert rows[0].startswith("waktu_wib,")
    assert rows[1] == "2026-06-01 07:00:00,10.0"


def test_the_window_itself_is_not_shifted():
    """Zona hanya MELABELI. Kalau ia ikut menggeser batas query, jendela yang
    diminta pengguna diam-diam bergerak 7 jam dan berkasnya berisi rentang yang
    salah — kegagalan yang sama, cuma pindah tempat."""
    t = _tag()
    inside = _minutes(LO, 2)
    outside = _minutes(HI + timedelta(days=1), 5)
    counts, _m, _e, _f = _build([t], {t.id: inside + outside}, "rollup", tz=WIB)
    assert counts[t.id] == 2
