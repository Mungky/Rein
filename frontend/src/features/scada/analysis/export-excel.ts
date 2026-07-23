/** Excel export for the Analisis workbench (TDengine-style data download).
 *  SheetJS is loaded via dynamic import only when the user clicks Export,
 *  so it never weighs down the page bundle. */

import { format } from "date-fns";
import { scadaApi } from "@/lib/api/scada";
import type { Tag } from "../types";

const HISTORY_CHUNK = 4; // /history accepts max 4 tags per call
const HISTORY_WINDOW_MS = 44 * 24 * 3600_000; // /history caps spans at 45 days

export type ExportRangeKey = "today" | "week" | "month" | "all";

export const EXPORT_RANGE_LABELS: Record<ExportRangeKey, string> = {
  today: "Hari ini",
  week: "Minggu ini",
  month: "Bulan ini",
  all: "Semua (1 bulan)",
};

function rangeStart(range: ExportRangeKey, now: Date): Date {
  const d = new Date(now);
  if (range === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "week") {
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  if (range === "month") {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
  }
  // "all" = the DB's 90-day window; older months live in the Drive archive
  return new Date(now.getTime() - 90 * 24 * 3600_000);
}

/** Wide time-series export (Waktu | tag1 | tag2 | …) for the chosen range.
 *  Long ranges are fetched in ≤44-day windows (the /history span cap) and
 *  merged; tags are chunked by 4 (the /history tag cap). */
export async function exportRangeToExcel(opts: {
  tags: Tag[];
  sheetName: string;
  range: ExportRangeKey;
}): Promise<void> {
  const XLSX = await import("xlsx");
  const { tags, sheetName, range } = opts;
  const end = new Date();
  const start = rangeStart(range, end);
  const tagIds = tags.map((t) => t.id);

  const windows: [Date, Date][] = [];
  for (let t = start.getTime(); t < end.getTime(); t += HISTORY_WINDOW_MS) {
    windows.push([new Date(t), new Date(Math.min(t + HISTORY_WINDOW_MS, end.getTime()))]);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < tagIds.length; i += HISTORY_CHUNK) {
    chunks.push(tagIds.slice(i, i + HISTORY_CHUNK));
  }

  const byTime = new Map<string, Record<string, number>>();
  for (const [ws, we] of windows) {
    const results = await Promise.all(
      chunks.map((ids) => scadaApi.getHistory(ids, ws, we, 720))
    );
    for (const res of results) {
      for (const s of res.series) {
        for (const p of s.points) {
          let row = byTime.get(p.t);
          if (!row) {
            row = {};
            byTime.set(p.t, row);
          }
          row[s.tag_id] = p.avg;
        }
      }
    }
  }

  const times = [...byTime.keys()].sort();
  const header = [
    "Waktu",
    ...tags.map((t) => (t.unit ? `${t.label} (${t.unit})` : t.label)),
  ];
  const body = times.map((t) => [
    format(new Date(t), "yyyy-MM-dd HH:mm"),
    ...tagIds.map((id) => byTime.get(t)?.[id] ?? null),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(
    wb,
    `rnet-${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range}-${format(end, "yyyyMMdd-HHmm")}.xlsx`
  );
}

/** Single-tag export used by the Riwayat drawer: raw recent samples. */
export async function exportTagToExcel(tag: Tag): Promise<void> {
  const XLSX = await import("xlsx");
  const res = await scadaApi.getRecentSamples(tag.id, 500);
  const ws = XLSX.utils.aoa_to_sheet([
    ["Waktu", `Nilai${tag.unit ? ` (${tag.unit})` : ""}`],
    ...res.items.map((s) => [format(new Date(s.ts), "yyyy-MM-dd HH:mm"), s.value]),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Riwayat");
  XLSX.writeFile(
    wb,
    `rnet-${tag.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`
  );
}
