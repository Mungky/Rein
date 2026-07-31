"use client";

/** Admin — R-Net tab: sampling-level durations + raw retention.
 *
 *  These are the real knobs behind the whole storage pipeline: the bridge reads
 *  the level durations to size its interval buckets, the alarm engine derives
 *  its silence window from them, and the partition manager reads ring_window_h
 *  to decide when a day of raw values may be dropped. Each picks up a change on
 *  its next loop — no restart, no deploy.
 *
 *  Linked to directly from the sensor dropdown in R-Net (/admin?tab=rnet),
 *  because "durasi tiap level diatur admin" was previously a sentence with no
 *  route attached and nobody found this screen. */

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Save } from "lucide-react";
import { scadaApi } from "@/lib/api/scada";
import type { RnetSettings } from "@/features/scada/types";
import { ErrorBanner, LoadingState } from "./shared";

// Keempat level berlaku untuk SEMUA sensor. Batasan "slow/slowest saja saat
// simpan data" sudah tidak ada — lajur yang memerlukannya sudah pensiun.
const LEVEL_FIELDS: { key: keyof RnetSettings; label: string; hint: string }[] = [
  { key: "level_fastest_s", label: "Fastest (detik)", hint: "Paling sering — paling banyak baris" },
  { key: "level_fast_s", label: "Fast (detik)", hint: "Bawaan untuk sensor baru" },
  { key: "level_slow_s", label: "Slow (detik)", hint: "Untuk besaran yang berubah pelan" },
  { key: "level_slowest_s", label: "Slowest (detik)", hint: "Paling hemat penyimpanan" },
];

// store_months & reset_warn_days sengaja TIDAK ditampilkan lagi: keduanya
// mengatur siklus arsip-lalu-hapus milik lajur yang sudah pensiun. Kolomnya
// dibiarkan ada di database (menghapus kolom tak bisa dibalik dan tak membeli
// apa pun), tapi menampilkannya berarti menawarkan kenop yang tidak tersambung
// ke apa-apa.
/** Field yang isinya TEKS, bukan angka — lihat handleSave. */
const TEXT_FIELDS = new Set<string>(["display_timezone"]);

/** Zona IANA yang relevan untuk Indonesia, plus UTC untuk yang ingin berkasnya
 *  sama dengan penyimpanannya. Kolom bebas diketik juga (datalist), karena
 *  membatasi daftar akan salah begitu ada plant di luar negeri. */
const TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "UTC",
];

const RETENTION_FIELDS: { key: keyof RnetSettings; label: string; hint: string }[] = [
  {
    key: "ring_window_h",
    label: "Retensi nilai mentah (jam)",
    hint: "Laci harian dibuang utuh, jadi umur nyatanya 1-2× angka ini",
  },
];

export function RnetTab() {
  const [settings, setSettings] = useState<RnetSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    scadaApi
      .getRnetSettings()
      .then((s) => {
        setSettings(s);
        setDraft(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat"))
      .finally(() => setLoading(false));
  }, []);

  const setField = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Angka lewat parseInt; TEKS harus dilewatkan apa adanya. Tanpa
      // pemisahan ini display_timezone selalu NaN dan diam-diam tidak pernah
      // ikut terkirim — tersimpan menurut layar, tidak berubah di database.
      const payload: Record<string, number | string> = {};
      for (const k of Object.keys(draft)) {
        if (TEXT_FIELDS.has(k)) {
          const v = draft[k].trim();
          if (v) payload[k] = v;
          continue;
        }
        const n = parseInt(draft[k], 10);
        if (!Number.isNaN(n)) payload[k] = n;
      }
      const updated = await scadaApi.updateRnetSettings(
        payload as Partial<RnetSettings>
      );
      setSettings(updated);
      setDraft(Object.fromEntries(Object.entries(updated).map(([k, v]) => [k, String(v)])));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Memuat pengaturan R-Net…" />;
  if (!settings) return <ErrorBanner message={error ?? "Gagal memuat"} onClose={() => setError(null)} />;

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">R-Net — Penyimpanan Data</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Atur durasi tiap level Sampling Rate, retensi, dan zona waktu yang
          dipakai berkas. Sensor memilih salah satu level di halaman Data;
          nilai detiknya diatur di sini. Perubahan berlaku otomatis pada siklus
          berikutnya.
        </p>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="surface p-5 mb-4">
        <h3 className="text-[13px] font-bold text-text mb-3">Durasi Level Sampling</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LEVEL_FIELDS.map((f) => (
            <NumberField key={f.key} field={f} value={draft[f.key] ?? ""} onChange={setField} />
          ))}
        </div>
      </div>

      <div className="surface p-5 mb-4">
        <h3 className="text-[13px] font-bold text-text mb-3">Retensi</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {RETENTION_FIELDS.map((f) => (
            <NumberField key={f.key} field={f} value={draft[f.key] ?? ""} onChange={setField} />
          ))}
        </div>
        {/* Yang TIDAK bisa diatur di sini, dan kenapa: supaya tidak ada yang
            mencari-cari kenop untuk lapisan kedua. */}
        <p className="text-[11.5px] text-text-muted mt-3 leading-relaxed">
          Setelah nilai mentah kedaluwarsa, <strong>ringkasan per menit</strong>{" "}
          (rata-rata, min, maks, jumlah data) tetap tersimpan ±30 hari untuk
          semua sensor, lalu diarsipkan otomatis per plant ke Google Drive.
          Bagian itu tidak punya setelan — ia berlaku sama untuk semua sensor,
          dan sebuah bulan tidak akan pernah dihapus sebelum salinannya
          terbukti ada di Drive.
        </p>
      </div>

      <div className="surface p-5 mb-4">
        <h3 className="text-[13px] font-bold text-text mb-3">Zona Waktu Berkas</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Zona waktu tampilan
            </span>
            <input
              className="field-input font-mono"
              list="rnet-timezones"
              value={draft.display_timezone ?? ""}
              onChange={(e) => setField("display_timezone", e.target.value)}
              placeholder="Asia/Jakarta"
              maxLength={64}
            />
            <datalist id="rnet-timezones">
              {TIMEZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <span className="text-[11px] text-text-light mt-1 block">
              Nama IANA. Nama yang tidak dikenal ditolak saat disimpan.
            </span>
          </label>
        </div>
        <p className="text-[11.5px] text-text-muted mt-3 leading-relaxed">
          Dipakai untuk <strong>menamai waktu</strong> di berkas export CSV,
          arsip bulanan di Google Drive, dan email alarm — nama kolomnya ikut
          berubah (<span className="font-mono">waktu_wib</span>,{" "}
          <span className="font-mono">waktu_utc</span>). Penyimpanannya sendiri
          tetap UTC dan tidak tersentuh; yang berubah hanya labelnya. Batas
          bulan arsip Drive juga tetap UTC, jadi arsip Juli dibaca mulai
          1&nbsp;Juli 07:00 WIB.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="btn btn-primary btn-sm gap-1.5"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Simpan
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-green">
            <CheckCircle className="size-3.5" /> Tersimpan
          </span>
        )}
      </div>
    </div>
  );
}

function NumberField({
  field,
  value,
  onChange,
}: {
  field: { key: keyof RnetSettings; label: string; hint: string };
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-muted mb-1 block tracking-tight">
        {field.label}
      </label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="field-input h-9 w-full text-[13px]"
      />
      <p className="mt-1 text-[10.5px] leading-snug text-text-light">{field.hint}</p>
    </div>
  );
}
