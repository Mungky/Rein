"use client";

/** "Impor Sensor" — tempel satu daftar, jadi banyak sensor sekaligus.
 *
 *  Sebelum ini sensor hanya bisa dibuat satu per satu. Itu wajar untuk plant
 *  percontohan 14 sensor dan tidak masuk akal untuk klien 300 sensor: daftar
 *  tag-nya sudah ada dalam bentuk spreadsheet dari sisi PLC, dan mengetik ulang
 *  300 formulir adalah biaya terbesar memasang klien baru — lebih besar dari
 *  apa pun soal MQTT atau penyimpanan.
 *
 *  SEMUA-ATAU-TIDAK SAMA SEKALI. Server memeriksa seluruh baris dulu; kalau ada
 *  satu saja bermasalah, TIDAK ADA yang dibuat. Daftar setengah jadi lebih
 *  buruk daripada ditolak: tidak ada yang tahu 300 sensor itu yang mana yang
 *  masuk, dan menempel ulang filenya akan menggandakan yang sudah terlanjur. */

import { useMemo, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { scadaApi } from "@/lib/api/scada";
import type { Site } from "../types";

/** Kolom yang dikenali, sesuai urutan contoh. Nama header tidak wajib urut —
 *  yang dibaca adalah namanya, bukan posisinya. */
const KOLOM = [
  "nama", "satuan", "topik", "perangkat",
  "level", "simpan", "alarm_min", "alarm_max", "warn_min", "warn_max",
  "skala", "offset", "desimal",
] as const;

const CONTOH = `nama,satuan,topik,perangkat,level,simpan,alarm_min,alarm_max
Level Tangki 1,cm,rnet/lombok/gw/lombok1,waterlevel1,fast,,0,200
Level Tangki 2,cm,rnet/lombok/gw/lombok1,waterlevel2,fast,,0,200
Suhu Heating,°C,rnet/lombok/gw/lombok1,temperature1,slow,ya,60,95`;

const LEVELS = ["fastest", "fast", "slow", "slowest"];

interface Baris {
  n: number;                       // nomor baris seperti di spreadsheet
  nilai: Record<string, string>;
  galat: string | null;            // masalah yang ketahuan di sini (sebelum kirim)
}

/** Pengurai CSV kecil yang menghormati tanda kutip.
 *
 *  Split(",") biasa sudah cukup sampai ada satu nama sensor berisi koma —
 *  "Tangki 1, sisi utara" — dan sejak itu seluruh barisnya bergeser satu kolom
 *  tanpa ada yang sadar. Ini menangani kutip ganda dan kutip di dalam kutip
 *  (""), yang persis dikeluarkan Excel dan Google Sheets. */
function uraiCSV(teks: string): string[][] {
  const baris: string[][] = [];
  let sel = "";
  let kolom: string[] = [];
  let dalamKutip = false;
  const t = teks.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dalamKutip) {
      if (c === '"') {
        if (t[i + 1] === '"') { sel += '"'; i++; }
        else dalamKutip = false;
      } else sel += c;
      continue;
    }
    if (c === '"') dalamKutip = true;
    else if (c === "," || c === ";" || c === "\t") { kolom.push(sel); sel = ""; }
    else if (c === "\n") { kolom.push(sel); baris.push(kolom); kolom = []; sel = ""; }
    else sel += c;
  }
  if (sel !== "" || kolom.length > 0) { kolom.push(sel); baris.push(kolom); }
  return baris.filter((r) => r.some((s) => s.trim() !== ""));
}

const angka = (s: string): number | null => {
  const v = s.trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ya = (s: string): boolean =>
  ["ya", "y", "true", "1", "on", "aktif"].includes(s.trim().toLowerCase());

export function ImportTagsDialog({
  sheetId,
  sites,
  onImported,
  onClose,
}: {
  sheetId: string;
  sites: Site[];
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const enabledSites = sites.filter((s) => s.enabled);
  const [siteId, setSiteId] = useState(enabledSites[0]?.id ?? "");
  const [teks, setTeks] = useState("");
  const [kirim, setKirim] = useState(false);
  // Galat per baris DARI SERVER (duplikat, dsb) — yang tidak bisa diketahui di
  // sini karena butuh melihat sensor yang sudah ada.
  const [galatServer, setGalatServer] = useState<
    { row: number; label: string; message: string }[]
  >([]);

  const { baris, kolomTakDikenal } = useMemo(() => {
    const isi = uraiCSV(teks);
    if (isi.length === 0) return { baris: [] as Baris[], kolomTakDikenal: [] as string[] };
    const header = isi[0].map((h) => h.trim().toLowerCase());
    const takDikenal = header.filter((h) => h !== "" && !KOLOM.includes(h as never));
    const out: Baris[] = [];
    for (let i = 1; i < isi.length; i++) {
      const nilai: Record<string, string> = {};
      header.forEach((h, k) => { if (h) nilai[h] = (isi[i][k] ?? "").trim(); });
      let galat: string | null = null;
      if (!nilai.nama) galat = "kolom 'nama' kosong";
      else if (!nilai.topik) galat = "kolom 'topik' kosong";
      else if (!nilai.perangkat) galat = "kolom 'perangkat' kosong";
      else if (nilai.level && !LEVELS.includes(nilai.level.toLowerCase()))
        galat = `level '${nilai.level}' tidak dikenal (fastest/fast/slow/slowest)`;
      out.push({ n: i + 1, nilai, galat });
    }
    return { baris: out, kolomTakDikenal: takDikenal };
  }, [teks]);

  const galatLokal = baris.filter((b) => b.galat);
  const siap = baris.length > 0 && galatLokal.length === 0 && siteId !== "";

  async function impor() {
    if (!siap) return;
    setKirim(true);
    setGalatServer([]);
    try {
      const res = await scadaApi.importTags({
        sheet_id: sheetId,
        site_id: siteId,
        rows: baris.map(({ nilai }) => ({
          label: nilai.nama,
          unit: nilai.satuan ?? "",
          mqtt_topic: nilai.topik,
          device_key: nilai.perangkat ?? "",
          sampling_level: nilai.level ? nilai.level.toLowerCase() : null,
          // Kolom `simpan` masih diterima server lalu diabaikan — lajur
          // penyimpanan kedua sudah pensiun. Tetap dikirim supaya spreadsheet
          // operator yang sudah memuat kolom itu tidak perlu diubah.
          store_enabled: ya(nilai.simpan ?? ""),
          alarm_min: angka(nilai.alarm_min ?? ""),
          alarm_max: angka(nilai.alarm_max ?? ""),
          warn_min: angka(nilai.warn_min ?? ""),
          warn_max: angka(nilai.warn_max ?? ""),
          scale: angka(nilai.skala ?? ""),
          offset: angka(nilai.offset ?? ""),
          decimals: angka(nilai.desimal ?? ""),
        })),
      });
      if (res.errors.length > 0) {
        setGalatServer(res.errors);
        toast.error(
          `${res.errors.length} baris bermasalah — tidak ada sensor yang dibuat`
        );
        return;
      }
      await onImported();
      toast.success(`${res.created} sensor dibuat`);
      onClose();
    } catch {
      toast.error("Gagal mengimpor — tidak ada sensor yang dibuat");
    } finally {
      setKirim(false);
    }
  }

  return (
    <Drawer
      title="Impor Sensor"
      subtitle="Tempel daftar sensor dari spreadsheet — semua sekaligus"
      icon={<FileUp className="size-5" />}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-text-muted">
            {baris.length > 0 && `${baris.length} baris terbaca`}
            {galatLokal.length > 0 && (
              <span className="text-red"> · {galatLokal.length} bermasalah</span>
            )}
          </span>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={impor}
            disabled={!siap || kirim}
            className="btn btn-primary btn-sm"
          >
            {kirim && <Loader2 className="size-3.5 animate-spin" />}
            Impor {baris.length > 0 ? `${baris.length} sensor` : ""}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {enabledSites.length === 0 ? (
          <p className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5 text-[12px] text-text-muted">
            Belum ada site (broker). Buat dulu lewat{" "}
            <span className="font-semibold">Kelola Site</span>.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-text-muted">
                Site (Broker) <span className="text-red">*</span>
              </label>
              <select
                className="field-select cursor-pointer"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                {enabledSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.mqtt_host})
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-text-light">
                Semua sensor di daftar ini masuk ke site tersebut.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[12px] font-semibold text-text-muted">
                  Daftar sensor (CSV) <span className="text-red">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTeks(CONTOH)}
                    className="cursor-pointer text-[11px] font-semibold text-primary hover:underline"
                  >
                    Isi contoh
                  </button>
                  <label className="cursor-pointer text-[11px] font-semibold text-primary hover:underline">
                    Pilih file…
                    <input
                      type="file"
                      accept=".csv,.txt,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        f.text().then(setTeks).catch(() => toast.error("File tidak terbaca"));
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
              <textarea
                className="field-input h-40 resize-y font-mono text-[11.5px]"
                placeholder={CONTOH}
                value={teks}
                onChange={(e) => setTeks(e.target.value)}
                spellCheck={false}
              />
              <p className="mt-1.5 text-[11px] text-text-light">
                Baris pertama = judul kolom. Wajib:{" "}
                <span className="font-mono text-text-muted">nama</span>,{" "}
                <span className="font-mono text-text-muted">topik</span>. Opsional:{" "}
                <span className="font-mono text-text-muted">
                  satuan, field, perangkat, level, simpan, alarm_min, alarm_max,
                  warn_min, warn_max, skala, offset, desimal
                </span>
                . Pemisah koma, titik koma, atau tab.
              </p>
              {kolomTakDikenal.length > 0 && (
                <p className="mt-1.5 text-[11px] text-amber">
                  Kolom tidak dikenal, akan diabaikan:{" "}
                  <span className="font-mono">{kolomTakDikenal.join(", ")}</span>
                </p>
              )}
            </div>

            {/* Pratinjau: apa yang AKAN dibuat, sebelum ada yang dibuat. */}
            {baris.length > 0 && (
              <div className="overflow-hidden rounded-[var(--r-lg)] border border-border-soft">
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <thead className="sticky top-0 bg-bg-sidebar text-text-muted">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold">#</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Nama</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Topik</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Perangkat</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baris.map((b) => {
                        const svr = galatServer.find((g) => g.row === b.n - 1);
                        const pesan = b.galat ?? svr?.message ?? null;
                        return (
                          <tr
                            key={b.n}
                            className={
                              pesan
                                ? "border-t border-border-soft bg-red/10"
                                : "border-t border-border-soft"
                            }
                          >
                            <td className="px-2 py-1 tabular-nums text-text-light">{b.n}</td>
                            <td className="px-2 py-1 text-text">{b.nilai.nama || "—"}</td>
                            <td className="truncate px-2 py-1 font-mono text-[10.5px] text-text-muted">
                              {b.nilai.topik || "—"}
                            </td>
                            <td className="px-2 py-1 font-mono text-[10.5px] text-text-muted">
                              {b.nilai.perangkat || <span className="text-text-light">—</span>}
                            </td>
                            <td className="px-2 py-1 text-red">{pesan ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {galatServer.length > 0 && (
              <p className="rounded-[var(--r)] border border-red/40 bg-red/10 px-3 py-2.5 text-[11.5px] text-text-muted">
                <span className="font-semibold text-red">
                  Tidak ada sensor yang dibuat.
                </span>{" "}
                Perbaiki {galatServer.length} baris bertanda merah di atas lalu impor
                lagi — daftar ini sengaja tidak dibuat sebagian, supaya tidak ada
                sensor yang terlanjur masuk tanpa Anda tahu yang mana.
              </p>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
