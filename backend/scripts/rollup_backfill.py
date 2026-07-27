#!/usr/bin/env python3
"""Isi scada_rollup_1m untuk data mentah yang SUDAH ada — sekali jalan.

Tugas latar (app/services/rollup.py) hanya melihat ~10 menit terakhir, jadi data
mentah yang masuk sebelum fitur ringkasan ini ada tidak pernah tersentuh.
Skrip ini mengejar ketertinggalan itu.

Aman diulang: kunci utama (ts, tag_id) + ON CONFLICT DO NOTHING, jadi
menjalankannya dua kali menghasilkan tabel yang sama persis.

PAKAI
    # Semua data mentah yang masih ada (bawaan):
    python backend/scripts/rollup_backfill.py

    # Rentang tertentu (UTC):
    python backend/scripts/rollup_backfill.py --start 2026-07-25T14:00 --end 2026-07-26T03:00

    # Lihat rencananya saja, jangan tulis apa-apa:
    python backend/scripts/rollup_backfill.py --dry-run
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sqlalchemy import text  # noqa: E402

from app.services import rollup  # noqa: E402


def _parse(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _raw_bounds() -> tuple[datetime | None, datetime | None]:
    from db.session import async_session_factory

    async with async_session_factory() as db:
        row = (
            await db.execute(text("SELECT min(ts), max(ts) FROM scada_samples_all"))
        ).one()
    return row[0], row[1]


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", type=_parse, help="Awal rentang (UTC, ISO 8601)")
    ap.add_argument("--end", type=_parse, help="Akhir rentang (UTC, ISO 8601)")
    ap.add_argument("--chunk-hours", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true", help="Tampilkan rencana saja")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    lo, hi = await _raw_bounds()
    if lo is None:
        print("Tidak ada data mentah sama sekali — tidak ada yang diringkas.")
        return 0

    start = args.start or lo
    # Jangan pernah meringkas menit yang belum selesai.
    now_minute = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    end = min(args.end or hi, now_minute)

    print(f"Data mentah tersedia : {lo}  ->  {hi}")
    print(f"Akan diringkas       : {start}  ->  {end}")
    print(f"Potongan per         : {args.chunk_hours} jam")
    if args.dry_run:
        print("\n--dry-run: tidak ada yang ditulis.")
        return 0
    if start >= end:
        print("\nRentang kosong — tidak ada yang dikerjakan.")
        return 0

    written = await rollup.backfill(start, end, chunk_h=args.chunk_hours)
    print(f"\nSelesai. {written:,} baris ringkasan baru ditulis.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
