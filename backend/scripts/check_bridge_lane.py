#!/usr/bin/env python3
"""Apakah bridge di PC lapangan SUDAH menulis ke scada_raw? — cek mandiri.

Dipakai setelah menyalin deploy/data/bridge.py yang baru ke PC lapangan dan
me-restart-nya (Fase 5 langkah 4). Skrip ini HANYA MEMBACA — tidak mengubah
atau menghapus apa pun, aman dijalankan kapan saja dan sesering apa pun.

CARA PAKAI
    python backend/scripts/check_bridge_lane.py

    # Amati 60 detik untuk melihat lajur mana yang benar-benar bertambah:
    python backend/scripts/check_bridge_lane.py --watch 60

YANG DICARI
    Bridge LAMA menulis ke scada_ring. Bridge BARU menulis ke scada_raw.
    Selama masa transisi keduanya terbaca oleh grafik (lewat kaca pengintip
    scada_samples_all), jadi tampilan tidak berubah apa pun hasilnya — satu-
    satunya cara memastikan adalah melihat lajur mana yang tumbuh.
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone

import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _dsn() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        env = os.path.join(ROOT, ".env")
        for line in open(env, encoding="utf-8"):
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                break
    if not url:
        raise SystemExit("DATABASE_URL tidak ditemukan (env atau .env)")
    return re.sub(r"\?.*$", "", url.replace("postgresql+asyncpg://", "postgresql://"))


def snapshot(cur) -> dict:
    out = {}
    for tbl in ("scada_raw", "scada_ring"):
        cur.execute(f"select count(*), max(ts) from {tbl}")
        n, newest = cur.fetchone()
        out[tbl] = {"n": n, "newest": newest}
    cur.execute("select now()")
    out["now"] = cur.fetchone()[0]
    return out


def age(now, ts) -> str:
    if ts is None:
        return "belum pernah"
    s = (now - ts).total_seconds()
    if s < 90:
        return f"{s:.0f} detik lalu"
    if s < 5400:
        return f"{s/60:.0f} menit lalu"
    return f"{s/3600:.1f} jam lalu"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--watch", type=int, default=0, metavar="DETIK",
                    help="amati selama N detik untuk melihat lajur mana yang tumbuh")
    args = ap.parse_args()

    conn = psycopg2.connect(_dsn(), connect_timeout=30)
    conn.autocommit = True
    cur = conn.cursor()

    a = snapshot(cur)
    print("=" * 66)
    print("LAJUR MANA YANG DIPAKAI BRIDGE SEKARANG?")
    print("=" * 66)
    print(f"  jam server : {a['now']}")
    print()
    print(f"  {'LAJUR':<26} {'BARIS':>10}  DATA TERBARU")
    print(f"  {'scada_raw  (bridge BARU)':<26} {a['scada_raw']['n']:>10,}  "
          f"{age(a['now'], a['scada_raw']['newest'])}")
    print(f"  {'scada_ring (bridge LAMA)':<26} {a['scada_ring']['n']:>10,}  "
          f"{age(a['now'], a['scada_ring']['newest'])}")

    if args.watch:
        print()
        print(f"  Mengamati {args.watch} detik…")
        time.sleep(args.watch)
        b = snapshot(cur)
        d_raw = b["scada_raw"]["n"] - a["scada_raw"]["n"]
        d_ring = b["scada_ring"]["n"] - a["scada_ring"]["n"]
        print()
        print(f"  {'LAJUR':<26} {'BARIS BARU':>12}")
        print(f"  {'scada_raw  (bridge BARU)':<26} {d_raw:>12,}")
        print(f"  {'scada_ring (bridge LAMA)':<26} {d_ring:>12,}")
        print()
        print("  " + "-" * 62)
        if d_raw > 0 and d_ring == 0:
            print("  >> BERHASIL. Bridge baru aktif; lajur lama sudah berhenti.")
            print("     Beri tahu Claude — penyalinan terakhir + langkah 7 bisa jalan.")
        elif d_raw > 0 and d_ring > 0:
            print("  >> DUA-DUANYA menulis. Kemungkinan masih ada bridge lama yang")
            print("     jalan (PC lain, atau proses lama belum benar-benar mati).")
            print("     Cek Task Manager di PC lapangan untuk python.exe ganda.")
        elif d_raw == 0 and d_ring > 0:
            print("  >> Masih bridge LAMA. Salinan bridge.py belum terpakai —")
            print("     pastikan file di C:\\rein-scada sudah ditimpa DAN prosesnya")
            print("     di-restart (bukan cuma filenya diganti).")
        else:
            print("  >> Tidak ada data masuk sama sekali selama pengamatan.")
            print("     Plant/broker mungkin sedang mati, atau interval sampling")
            print("     sensornya lebih panjang dari durasi pengamatan ini.")
            print("     Coba lagi dengan --watch 120.")
        print("  " + "-" * 62)
    else:
        print()
        print("  Angka di atas cuma potret sesaat. Untuk memastikan lajur mana yang")
        print("  AKTIF, jalankan ulang dengan pengamatan:")
        print("      python backend/scripts/check_bridge_lane.py --watch 60")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
