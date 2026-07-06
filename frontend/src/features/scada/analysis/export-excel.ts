/** Excel export for the Analisis workbench (TDengine-style data download).
 *  SheetJS is loaded via dynamic import only when the user clicks Export,
 *  so it never weighs down the page bundle. */

import { format } from "date-fns";
import { scadaApi } from "@/lib/api/scada";
import type { ChartRange, Tag, WorkbenchColumn } from "../types";
import { RANGE_MS } from "../panels/chart-panel";

const HISTORY_CHUNK = 4; // /history accepts max 4 tags per call

export interface ExportRow {
  tag: Tag;
  last: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
  custom: Record<string, number | string | null>;
}

/** Sheet 1 "Analisis": snapshot of the visible table.
 *  Sheet 2 "Riwayat": wide time-series (Waktu | tag1 | tag2 | …) over range. */
export async function exportSheetToExcel(opts: {
  sheetName: string;
  rows: ExportRow[];
  columns: WorkbenchColumn[];
  range: ChartRange;
}): Promise<void> {
  const XLSX = await import("xlsx");
  const { sheetName, rows, columns, range } = opts;

  /* ── Sheet 1: Analisis snapshot ── */
  const header = [
    "Nama",
    "Perangkat",
    "Unit",
    "Terkini",
    "Min",
    "Rata-rata",
    "Maks",
    ...columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name)),
  ];
  const body = rows.map((r) => [
    r.tag.label,
    r.tag.device_key,
    r.tag.unit,
    r.last,
    r.min,
    r.avg,
    r.max,
    ...columns.map((c) => r.custom[c.id] ?? null),
  ]);
  const analysisWs = XLSX.utils.aoa_to_sheet([header, ...body]);

  /* ── Sheet 2: Riwayat (wide) ── */
  const tagIds = rows.map((r) => r.tag.id);
  const end = new Date();
  const start = new Date(end.getTime() - RANGE_MS[range]);
  const chunks: string[][] = [];
  for (let i = 0; i < tagIds.length; i += HISTORY_CHUNK) {
    chunks.push(tagIds.slice(i, i + HISTORY_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((ids) => scadaApi.getHistory(ids, start, end, 720))
  );
  const series = results.flatMap((res) => res.series);

  const byTime = new Map<string, Record<string, number>>();
  for (const s of series) {
    for (const p of s.points) {
      let row = byTime.get(p.t);
      if (!row) {
        row = {};
        byTime.set(p.t, row);
      }
      row[s.tag_id] = p.avg;
    }
  }
  const times = [...byTime.keys()].sort();
  const historyHeader = [
    "Waktu",
    ...rows.map((r) => (r.tag.unit ? `${r.tag.label} (${r.tag.unit})` : r.tag.label)),
  ];
  const historyBody = times.map((t) => [
    format(new Date(t), "yyyy-MM-dd HH:mm"),
    ...tagIds.map((id) => byTime.get(t)?.[id] ?? null),
  ]);
  const historyWs = XLSX.utils.aoa_to_sheet([historyHeader, ...historyBody]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, analysisWs, "Analisis");
  XLSX.utils.book_append_sheet(wb, historyWs, "Riwayat");
  XLSX.writeFile(
    wb,
    `rnet-${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(end, "yyyyMMdd-HHmm")}.xlsx`
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
