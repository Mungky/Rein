#!/usr/bin/env python3
"""Uji arsip per-plant TANPA menyentuh Drive dan TANPA menghapus apa pun.

Menjalankan bagian yang membangun file Excel-nya persis seperti pengarsip
sungguhan (streaming, satu sheet per sensor), lalu MENULIS FILENYA KE KOMPUTER
ANDA supaya bisa dibuka dan diperiksa. Tiga hal yang dilakukan pengarsip
sungguhan sesudah itu — unggah ke Google Drive, kirim email, hapus data dari
database — SEMUANYA DILEWATI di sini.

Aman dijalankan kapan saja, sesering apa pun, di database produksi.

CARA PAKAI
    # Lihat plant apa saja dan berapa sensor yang punya "Simpan data" nyala:
    python backend/scripts/archive_dry_run.py --list

    # Rakit file uji dari 7 hari terakhir untuk semua sensor tersimpan:
    python backend/scripts/archive_dry_run.py --days 7

    # Rentang spesifik, plant tertentu, keluaran ke folder pilihan:
    python backend/scripts/archive_dry_run.py \\
        --start 2026-07-01 --end 2026-08-01 --out D:\\uji-arsip

    # Ikut sertakan sensor mode ring (biasanya TIDAK diarsip) supaya ada data
    # contoh untuk dilihat walaupun belum ada sensor "Simpan data":
    python backend/scripts/archive_dry_run.py --days 1 --include-ring
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sqlalchemy import select  # noqa: E402

from app.services import archiver, rnet_settings  # noqa: E402
from db.models.scada import (  # noqa: E402
    ScadaSample,
    ScadaSampleAll,
    ScadaSite,
    ScadaTag,
)


def _parse(v: str) -> datetime:
    dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="hanya tampilkan daftar plant/sensor")
    ap.add_argument("--days", type=int, default=7, help="mundur N hari dari sekarang (default 7)")
    ap.add_argument("--start", type=_parse)
    ap.add_argument("--end", type=_parse)
    ap.add_argument("--out", default=".", help="folder keluaran (default: folder sekarang)")
    ap.add_argument("--include-ring", action="store_true",
                    help="ikutkan sensor mode ring (normalnya tidak diarsip)")
    args = ap.parse_args()

    from db.session import async_session_factory

    async with async_session_factory() as db:
        tags = (
            (await db.execute(select(ScadaTag).where(ScadaTag.enabled.is_(True))))
            .scalars().all()
        )
        sites = {s.id: s for s in (await db.execute(select(ScadaSite))).scalars().all()}

        chosen = [
            t for t in tags
            if args.include_ring or not rnet_settings.is_ring(t.config)
        ]
        by_site: dict = {}
        for t in chosen:
            by_site.setdefault(t.site_id, []).append(t)

        print(f"Sensor aktif        : {len(tags)}")
        print(f"Yang akan diarsipkan: {len(chosen)}"
              + ("  (termasuk mode ring, --include-ring)" if args.include_ring else
                 "  (hanya yang 'Simpan data' nyala)"))
        print()
        for site_id, group in by_site.items():
            name = sites[site_id].name if site_id in sites else "(tanpa plant)"
            print(f"  PLANT {name}  -> {len(group)} sheet")
            for t in group:
                print(f"      - {t.label}{(' (' + t.unit + ')') if t.unit else ''}")
        if not chosen:
            print("\nTidak ada sensor yang memenuhi syarat.")
            print("Belum ada sensor ber-'Simpan data'? Coba: --include-ring")
            return 0
        if args.list:
            return 0

        end = args.end or datetime.now(timezone.utc)
        start = args.start or (end - timedelta(days=args.days))
        os.makedirs(args.out, exist_ok=True)

        print()
        print(f"Rentang uji : {start}  ->  {end}")
        print(f"Keluaran    : {os.path.abspath(args.out)}")
        print()

        for site_id, group in by_site.items():
            site = sites.get(site_id)
            plant = (archiver._safe_sheet_title(site.name).replace(" ", "_")
                     if site else "Tanpa-Plant")
            fname = f"UJI-{plant}-{start:%Y%m%d}-{end:%Y%m%d}.xlsx"
            path = os.path.join(args.out, fname)
            # --include-ring means "show me whatever these sensors have", so
            # read the union view; otherwise mirror the real archiver exactly.
            counts = await archiver.build_plant_workbook(
                db, group, {t.id: (start, end) for t in group}, path,
                source=ScadaSampleAll if args.include_ring else ScadaSample,
            )
            size = os.path.getsize(path)
            print(f"  {fname}")
            print(f"     {len(group)} sheet, {sum(counts.values()):,} baris, "
                  f"{size/1024:.0f} KB")
            for t in group:
                print(f"       - {t.label:<20} {counts.get(t.id, 0):>9,} baris")

    print()
    print("SELESAI. Yang TIDAK dilakukan skrip ini:")
    print("  - tidak mengunggah apa pun ke Google Drive")
    print("  - tidak mengirim email")
    print("  - tidak menghapus satu baris pun dari database")
    print("  - tidak menyentuh jam siklus sensor")
    print()
    print("Buka file-nya di Excel dan periksa: satu sheet per sensor, kolom")
    print("Waktu (UTC) + Nilai, dan jumlah barisnya masuk akal untuk rentangnya.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
