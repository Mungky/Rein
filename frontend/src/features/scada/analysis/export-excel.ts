/** Excel export for the Analisis workbench.
 *
 *  Export RENTANG dirakit di server (satu permintaan, satu file) — lihat
 *  exportRangeToExcel. Export SATU SENSOR dari drawer Riwayat masih dirakit di
 *  browser: 500 baris, kecil dan instan, jadi tidak sepadan dengan satu
 *  perjalanan tambahan ke server. SheetJS dimuat lewat dynamic import hanya
 *  saat dipakai, supaya tidak membebani bundle halaman. */

import { format } from "date-fns";
import { scadaApi } from "@/lib/api/scada";
import type { Tag } from "../types";

/** Export rentang [start, end] — DIRAKIT DI SERVER (audit D-7).
 *
 *  Yang lama: browser menarik /samples halaman demi halaman, mundur dari
 *  `end`, sampai 400 halaman x 5.000 baris PER SENSOR, semua sensor paralel.
 *  Sepuluh sensor = hingga 4.000 permintaan menghantam server hampir
 *  bersamaan, hasilnya (bisa 20 juta baris) dirakit di RAM tab, dan tiap
 *  halaman itu juga menulis satu baris log akses + satu query COUNT.
 *  Biasanya tab-nya yang mati duluan.
 *
 *  Yang sekarang: satu permintaan. Server mengalirkan baris dari database ke
 *  file dan mengirimkannya; browser cuma menerima file. Isi datanya sama —
 *  baris MENTAH apa adanya, tanpa bucket/rata-rata — tapi kini satu SHEET PER
 *  SENSOR, bukan satu sheet lebar berisi banyak sel kosong (sensor punya laju
 *  sampling berbeda-beda). */
export async function exportRangeToExcel(opts: {
  tags: Tag[];
  sheetName: string;
  start: Date;
  end: Date;
}): Promise<void> {
  const { tags, sheetName, start, end } = opts;
  const { blob, filename } = await scadaApi.exportXlsx(
    tags.map((t) => t.id),
    start,
    end
  );
  const fallback =
    `rnet-${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` +
    `-${format(start, "yyyyMMdd")}-${format(end, "yyyyMMdd")}.xlsx`;
  triggerDownload(blob, filename ?? fallback);
}

/** Simpan blob sebagai unduhan. objectURL dilepas setelah klik supaya tab
 *  tidak menahan file di memori. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
