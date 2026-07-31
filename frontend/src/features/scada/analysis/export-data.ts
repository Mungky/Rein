/** Unduhan data untuk workbench Analisis — CSV.
 *
 *  Export RENTANG dirakit di server (satu permintaan, satu berkas) — lihat
 *  exportRangeToFile. Export SATU SENSOR dari drawer Riwayat masih dirakit di
 *  browser: 500 baris, kecil dan instan, jadi tidak sepadan dengan satu
 *  perjalanan tambahan ke server.
 *
 *  Dulu keduanya menghasilkan .xlsx, dan yang di browser memakai SheetJS
 *  (dependensi `xlsx`). Isinya cuma waktu dan angka, jadi xlsx membayar mahal —
 *  di kabel maupun di ukuran bundle — untuk kemampuan yang tidak dipakai satu
 *  pun. Sekarang keduanya CSV, dan SheetJS keluar dari bundle. */

import { format } from "date-fns";
import { scadaApi } from "@/lib/api/scada";
import type { Lane, Tag } from "../types";

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
 *  berkas dan mengirimkannya; browser cuma menerima berkas. Satu sensor datang
 *  sebagai .csv polos, beberapa sensor sebagai .zip berisi satu CSV per sensor
 *  — bukan satu berkas lebar, karena sensor punya laju sampling berbeda-beda
 *  dan kolom waktu bersama akan didominasi sel kosong. */
export async function exportRangeToFile(opts: {
  tags: Tag[];
  sheetName: string;
  start: Date;
  end: Date;
  /** Lajur mana yang dibaca. "raw" = tiap nilai, tapi hanya 24-48 jam terakhir
   *  yang tersedia; "rollup" = satu baris per menit, 30-61 hari. */
  lane?: Lane;
}): Promise<void> {
  const { tags, sheetName, start, end, lane = "raw" } = opts;
  const { blob, filename } = await scadaApi.exportData(
    tags.map((t) => t.id),
    start,
    end,
    lane
  );
  // Nama sebenarnya datang dari Content-Disposition; ini cuma jaring pengaman
  // kalau header itu hilang di perjalanan (mis. lewat proxy yang membersihkan
  // header). Ekstensinya mengikuti aturan server: satu sensor .csv, sisanya .zip.
  const suffix = lane === "rollup" ? "-ringkasan-1menit" : "";
  const ext = tags.length > 1 ? "zip" : "csv";
  const fallback =
    `rnet-${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` +
    `-${format(start, "yyyyMMdd")}-${format(end, "yyyyMMdd")}${suffix}.${ext}`;
  triggerDownload(blob, filename ?? fallback);
}

/** Simpan blob sebagai unduhan. objectURL dilepas setelah klik supaya tab
 *  tidak menahan berkas di memori. */
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

/** Satu field CSV, dikutip hanya bila perlu.
 *
 *  Hanya label dan satuan yang bisa memuat koma — keduanya teks bebas yang
 *  diketik operator. Tanpa ini, satu koma di satuan menggeser setiap kolom di
 *  kanannya, dan berkasnya TETAP terparsing, jadi tidak ada yang sadar.
 *  Cocok dengan _field() di backend/app/services/data_export.py. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Export satu sensor dari drawer Riwayat: 500 nilai mentah terakhir.
 *  Ditulis lama → baru (dibalik dari urutan API yang terbaru-dulu) supaya
 *  grafik di spreadsheet terbaca kiri-ke-kanan menurut waktu.
 *
 *  WAKTUNYA LOKAL, DAN JUDULNYA SEKARANG MENGATAKAN ITU. Berkas ini pernah
 *  menulis waktu lokal browser di bawah judul `waktu_utc` — berkasnya
 *  berbohong, dan menumpuknya dengan export server berarti mencampur baris
 *  yang selisih tujuh jam di bawah satu judul kolom.
 *
 *  Judulnya "waktu_lokal", bukan "waktu_wib" seperti berkas dari server.
 *  Disengaja: berkas ini ditulis browser, dan singkatan zona yang bisa dibaca
 *  browser (`Intl` memberi "GMT+7") tidak sama dengan yang ditulis server
 *  (`%Z` memberi "WIB"). Menebaknya berarti mengambil risiko menulis zona yang
 *  salah; "lokal" selalu benar. Waktunya sendiri identik selama zona browser
 *  sama dengan setelan R-Net, yang berlaku untuk semua pengguna di sini. */
export async function exportTagToCsv(tag: Tag): Promise<void> {
  const res = await scadaApi.getRecentSamples(tag.id, 500);
  const rows = [...res.items].reverse();
  const unit = tag.unit ? ` (${tag.unit})` : "";
  const csv =
    [csvField("waktu_lokal"), csvField(`nilai${unit}`)].join(",") +
    "\n" +
    rows
      .map((s) => `${format(new Date(s.ts), "yyyy-MM-dd HH:mm:ss")},${s.value}`)
      .join("\n") +
    "\n";
  const name =
    `rnet-${tag.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` +
    `-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
}
