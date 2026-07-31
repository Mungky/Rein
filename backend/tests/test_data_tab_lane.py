"""Lajur mana yang menjawab grafik di tab Data.

Ini pernah salah tanpa memicu satu pun error: jendela 24 jam dijawab dari
ringkasan per-menit, padahal 24 jam persis jendela yang jadi alasan lajur
mentah ada. Penyebabnya aritmetika, bukan niat — 24 jam dibagi 360 titik =
bucket 240 detik, dan apa pun di atas 60 detik dialihkan ke ringkasan. Tidak
ada yang salah ketik; angkanya saja yang mendarat di sisi yang keliru.

Yang bikin sulit ketahuan: pada lebar bucket yang sama, kedua lajur
mengembalikan angka yang IDENTIK (rata-rata tertimbang, min-dari-min,
maks-dari-maks). Jadi tidak ada nilai yang salah, tidak ada tes yang merah —
yang hilang cuma detail, dan cuma di grafik.

Angkanya DIBACA dari sumber frontend, bukan disalin ke sini. Menyalinnya
berarti tes ini akan tetap hijau justru pada saat frontend-nya bergeser ke
sisi yang salah — persis kegagalan yang seharusnya ia tangkap.
"""

import pathlib
import re

from app.routers.scada import (
    MAX_HISTORY_POINTS,
    ROLLUP_MIN_BUCKET_S,
    _bucket_seconds,
)

_FE = (
    pathlib.Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "features"
    / "scada"
)
_DETAIL_ROW = _FE / "analysis" / "tag-detail-row.tsx"
_CHART_PANEL = _FE / "panels" / "chart-panel.tsx"

_ENTRY = re.compile(r'"(\w+)":\s*([\d_]+)')


def _ts_number_map(path: pathlib.Path, name: str) -> dict[str, int]:
    """{"24h": 1800} dari sebuah literal objek TypeScript."""
    src = path.read_text(encoding="utf-8")
    match = re.search(
        r"const " + name + r"[^=]*=\s*\{(.*?)\n\};", src, re.DOTALL
    )
    assert match, f"{name} tidak ditemukan di {path.name}"
    found = {k: int(v.replace("_", "")) for k, v in _ENTRY.findall(match.group(1))}
    assert found, f"{name} di {path.name} terbaca kosong — regex-nya meleset"
    return found


def _data_tab_ranges() -> dict[str, tuple[float, int]]:
    """{rentang: (span_detik, jatah_titik)} untuk tiap rentang di tab Data."""
    span_ms = _ts_number_map(_CHART_PANEL, "RANGE_MS")
    points = _ts_number_map(_DETAIL_ROW, "DATA_RANGE_POINTS")
    return {k: (span_ms[k] / 1000, p) for k, p in points.items()}


def test_the_frontend_constants_are_actually_being_read():
    """Penjaga untuk penjaganya: regex yang meleset akan membuat setiap tes di
    bawah lolos tanpa memeriksa apa pun."""
    ranges = _data_tab_ranges()
    assert "24h" in ranges, f"rentang 24 jam tidak terbaca; yang ada: {sorted(ranges)}"
    assert ranges["24h"][0] == 86400


def test_every_data_tab_range_is_served_from_the_raw_lane():
    for name, (span_s, points) in _data_tab_ranges().items():
        bucket = _bucket_seconds(span_s, points)
        assert bucket < ROLLUP_MIN_BUCKET_S, (
            f"rentang {name}: bucket {bucket}s >= {ROLLUP_MIN_BUCKET_S}s, jadi "
            f"grafiknya akan dijawab dari ringkasan per-menit, bukan nilai mentah"
        )


def test_the_data_tab_budget_fits_under_the_server_cap():
    """Jatah di atas plafon ditolak 422 oleh Query(le=...) — grafiknya kosong,
    bukan sekadar kasar."""
    for name, (_span, points) in _data_tab_ranges().items():
        assert points <= MAX_HISTORY_POINTS, (
            f"rentang {name} minta {points} titik, plafon {MAX_HISTORY_POINTS}"
        )


def test_the_cap_is_high_enough_for_a_raw_24h_window():
    """Kalau plafonnya turun di bawah angka ini lagi, 24 jam jadi MUSTAHIL
    dilayani lajur mentah berapa pun jatah yang diminta. Itu kondisi lamanya
    (plafon 720 -> bucket terhalus 120 detik)."""
    needed = 86400 // (ROLLUP_MIN_BUCKET_S - 1) + 1
    assert MAX_HISTORY_POINTS >= needed, (
        f"plafon {MAX_HISTORY_POINTS} < {needed}: 24 jam terkunci di ringkasan"
    )


def test_the_data_tab_offers_nothing_longer_than_24h():
    """Rentang 7/30 hari sengaja dibuang dari tab Data: nilai mentahnya sudah
    dibuang bersama laci hariannya, jadi grafik sepanjang itu hanya bisa
    menggambar ringkasan sambil berpura-pura itu hal yang sama."""
    src = _DETAIL_ROW.read_text(encoding="utf-8")
    view = (_FE / "analysis" / "analysis-view.tsx").read_text(encoding="utf-8")
    match = re.search(r"const DATA_RANGES = \[(.*?)\] as const;", view, re.DOTALL)
    assert match, "DATA_RANGES tidak ditemukan di analysis-view.tsx"
    offered = set(re.findall(r'"(\w+)"', match.group(1)))

    assert offered == {"1h", "6h", "24h"}, f"pilihan rentang berubah: {sorted(offered)}"
    # Jatah titik hanya boleh mencakup rentang yang benar-benar bisa dipilih.
    assert set(_ts_number_map(_DETAIL_ROW, "DATA_RANGE_POINTS")) <= offered, (
        "DATA_RANGE_POINTS memuat rentang yang tidak ada di selektornya"
    )
    assert '"30d"' not in src and '"7d"' not in src
