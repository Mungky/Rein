"use client";

/** Admin — R-Net tab: sampling-level durations + storage retention knobs.
 *  These drive the whole storage pipeline (bridge, historian, alarm engine,
 *  archiver) — each picks up changes on its next loop. */

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Save } from "lucide-react";
import { scadaApi } from "@/lib/api/scada";
import type { RnetSettings } from "@/features/scada/types";
import { ErrorBanner, LoadingState } from "./shared";

const LEVEL_FIELDS: { key: keyof RnetSettings; label: string; hint: string }[] = [
  { key: "level_fastest_s", label: "Fastest (detik)", hint: "Level tercepat — mode 24 jam saja" },
  { key: "level_fast_s", label: "Fast (detik)", hint: "Cepat — mode 24 jam saja" },
  { key: "level_slow_s", label: "Slow (detik)", hint: "Boleh dipakai saat simpan data" },
  { key: "level_slowest_s", label: "Slowest (detik)", hint: "Paling hemat — boleh saat simpan data" },
];

const RETENTION_FIELDS: { key: keyof RnetSettings; label: string; hint: string }[] = [
  { key: "ring_window_h", label: "Jendela ring (jam)", hint: "Berapa lama data mode 24-jam ditahan" },
  { key: "store_months", label: "Siklus simpan (bulan)", hint: "Akumulasi sebelum diarsip & direset" },
  { key: "reset_warn_days", label: "Pengingat reset (hari)", hint: "Alarm muncul H- ini sebelum reset" },
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
      const payload: Partial<RnetSettings> = {};
      for (const k of Object.keys(draft)) {
        const n = parseInt(draft[k], 10);
        if (!Number.isNaN(n)) (payload as Record<string, number>)[k] = n;
      }
      const updated = await scadaApi.updateRnetSettings(payload);
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
          Atur durasi tiap level Sampling Rate dan retensi. Sensor memilih salah
          satu level di halaman Data; nilai detiknya diatur di sini. Perubahan
          berlaku otomatis pada siklus berikutnya.
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {RETENTION_FIELDS.map((f) => (
            <NumberField key={f.key} field={f} value={draft[f.key] ?? ""} onChange={setField} />
          ))}
        </div>
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
