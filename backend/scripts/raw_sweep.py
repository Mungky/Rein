#!/usr/bin/env python3
"""Sapu sisa baris scada_ring ke scada_raw — penutup Fase 5 sebelum langkah 7.

KENAPA ADA SISA
    Migrasi k1l2m3n4o5p6 MENYALIN scada_ring ke scada_raw (menyalin, bukan
    memindah — itu yang membuat Fase 5 bisa dibatalkan). Selama bridge lama di
    PC lapangan masih berjalan, ia terus menulis ke scada_ring, jadi baris yang
    masuk SESUDAH penyalinan itu belum ada di scada_raw.

    Selama masa itu tidak ada yang hilang: kaca pengintip scada_samples_all
    membaca kedua tabel. Tapi sebelum scada_ring boleh dihapus (langkah 7),
    sisa itu WAJIB dipindahkan dulu.

YANG DILAKUKAN
    Menyalin baris yang HANYA ada di scada_ring ke scada_raw, lengkap dengan
    site_id dari tag-nya. ON CONFLICT DO NOTHING, jadi aman diulang berkali-kali
    dan tidak pernah menimpa apa pun.

YANG TIDAK DILAKUKAN
    Tidak menghapus satu baris pun. scada_ring tetap utuh setelah skrip ini —
    penghapusannya adalah langkah 7 yang terpisah dan butuh persetujuan.

CARA PAKAI
    python backend/scripts/raw_sweep.py --dry-run   # lihat berapa yang tersisa
    python backend/scripts/raw_sweep.py             # salin
"""

import argparse
import os
import re
import sys

import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _dsn() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                break
    if not url:
        raise SystemExit("DATABASE_URL tidak ditemukan")
    return re.sub(r"\?.*$", "", url.replace("postgresql+asyncpg://", "postgresql://"))


REMAINING = """
select count(*), min(ts), max(ts) from scada_ring r
 where not exists (select 1 from scada_raw w
                   where w.tag_id = r.tag_id and w.ts = r.ts)
"""

SWEEP = """
insert into scada_raw (tag_id, ts, site_id, value)
select r.tag_id, r.ts, t.site_id, r.value
  from scada_ring r
  join scada_tags t on t.id = r.tag_id
 where not exists (select 1 from scada_raw w
                   where w.tag_id = r.tag_id and w.ts = r.ts)
on conflict do nothing
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(_dsn(), connect_timeout=30)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("select count(*) from scada_ring")
    ring = cur.fetchone()[0]
    cur.execute("select count(*) from scada_raw")
    raw = cur.fetchone()[0]
    cur.execute(REMAINING)
    n, lo, hi = cur.fetchone()

    print(f"scada_ring          : {ring:,}")
    print(f"scada_raw           : {raw:,}")
    print(f"Sisa belum tersalin : {n:,}")
    if n:
        print(f"  rentangnya        : {lo}  ->  {hi}")

    if args.dry_run:
        print("\n--dry-run: tidak ada yang ditulis.")
        return 0
    if n == 0:
        print("\nTidak ada yang perlu disapu — scada_raw sudah memuat semuanya.")
        return 0

    cur.execute(SWEEP)
    print(f"\nDisalin: {cur.rowcount:,} baris")

    cur.execute(REMAINING)
    left = cur.fetchone()[0]
    cur.execute("select count(*) from scada_raw")
    raw_after = cur.fetchone()[0]
    cur.execute("select count(*) from scada_ring")
    ring_after = cur.fetchone()[0]

    print(f"scada_raw sekarang  : {raw_after:,}")
    print(f"scada_ring (utuh)   : {ring_after:,}")
    print(f"Sisa belum tersalin : {left:,}")
    print()
    if left == 0:
        print(">> LULUS. Setiap baris scada_ring kini ada di scada_raw.")
        print("   scada_ring aman dihapus (langkah 7) — butuh persetujuan pemilik.")
    else:
        print(">> MASIH ADA SISA. Kemungkinan bridge lama belum benar-benar mati;")
        print("   cek: python backend/scripts/check_bridge_lane.py --watch 60")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
