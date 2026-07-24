/** Excel export for the Analisis workbench (TDengine-style data download).
 *  SheetJS is loaded via dynamic import only when the user clicks Export,
 *  so it never weighs down the page bundle. */

import { format } from "date-fns";
import { scadaApi } from "@/lib/api/scada";
import type { RecentSample, Tag } from "../types";

const PAGE_LIMIT = 5000; // maksimum baris per panggilan /samples
const MAX_PAGES = 400; // pengaman: 400 × 5000 = 2 juta baris/tag

/** Tarik SEMUA baris mentah satu tag dalam [start, end) persis seperti
 *  tersimpan di database — tanpa bucket/resample. Endpoint /samples urut
 *  terbaru-dulu dengan keyset `before` (ts < before); kita page mundur dari
 *  `end` sampai melewati `start`. Kembalian urut menaik (lama → baru). */
async function fetchRawRows(
  tagId: string,
  start: Date,
  end: Date
): Promise<RecentSample[]> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const out: RecentSample[] = [];
  let before: string | undefined = end.toISOString();

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await scadaApi.getSamplesPage(tagId, {
      before,
      limit: PAGE_LIMIT,
    });
    if (res.items.length === 0) break;
    for (const s of res.items) {
      const t = new Date(s.ts).getTime();
      if (t >= startMs && t < endMs) out.push(s);
    }
    const oldest = res.items[res.items.length - 1];
    // Sudah melewati awal jendela, atau tidak ada halaman lagi → berhenti.
    if (new Date(oldest.ts).getTime() < startMs || !res.has_more) break;
    before = oldest.ts;
  }

  out.reverse(); // terbaru-dulu → lama-dulu
  return out;
}

/** Wide time-series export (Waktu | tag1 | tag2 | …) atas jendela [start, end]
 *  dari kalender Dari/Sampai. Mengekspor ISI DATABASE apa adanya: setiap baris
 *  mentah pada resolusi aslinya (mis. 2 dtk untuk Fastest), TANPA
 *  bucket/rata-rata. Timestamp digabung antar-tag; sel kosong = tag itu tidak
 *  punya baris pada detik itu. Ditulis lama → baru. */
export async function exportRangeToExcel(opts: {
  tags: Tag[];
  sheetName: string;
  start: Date;
  end: Date;
}): Promise<void> {
  const XLSX = await import("xlsx");
  const { tags, sheetName, start, end } = opts;

  // Baris mentah per tag (paralel), lalu digabung ke peta ts → {tag: nilai}.
  const perTag = await Promise.all(
    tags.map((t) => fetchRawRows(t.id, start, end))
  );

  const byTime = new Map<string, Record<string, number>>();
  tags.forEach((t, i) => {
    for (const s of perTag[i]) {
      let row = byTime.get(s.ts);
      if (!row) {
        row = {};
        byTime.set(s.ts, row);
      }
      row[t.id] = s.value;
    }
  });

  const times = [...byTime.keys()].sort();
  const header = [
    "Waktu",
    ...tags.map((t) => (t.unit ? `${t.label} (${t.unit})` : t.label)),
  ];
  const body = times.map((t) => [
    // Detik ikut ditulis — data bisa per-2-detik, jangan dipangkas ke menit.
    format(new Date(t), "yyyy-MM-dd HH:mm:ss"),
    ...tags.map((tag) => byTime.get(t)?.[tag.id] ?? null),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(
    wb,
    `rnet-${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(start, "yyyyMMdd")}-${format(end, "yyyyMMdd")}.xlsx`
  );
}

/** Single-tag export used by the Riwayat drawer: raw recent samples.
 *  Ditulis lama → baru (dibalik dari urutan API yang terbaru-dulu) supaya
 *  grafik Excel terbaca kiri-ke-kanan menurut waktu. */
export async function exportTagToExcel(tag: Tag): Promise<void> {
  const XLSX = await import("xlsx");
  const res = await scadaApi.getRecentSamples(tag.id, 500);
  const rows = [...res.items].reverse();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Waktu", `Nilai${tag.unit ? ` (${tag.unit})` : ""}`],
    ...rows.map((s) => [format(new Date(s.ts), "yyyy-MM-dd HH:mm"), s.value]),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Riwayat");
  XLSX.writeFile(
    wb,
    `rnet-${tag.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`
  );
}
