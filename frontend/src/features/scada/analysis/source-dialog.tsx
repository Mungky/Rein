"use client";

/** "Atur Sumber" — where a tag's data comes from, edited inline in Analisis.
 *  Two modes:
 *   - Simulator: pick a preset waveform (demo data).
 *   - MQTT: pick a site (broker), type the topic, and optional alarm min/max.
 *  Saving PATCHes the tag; the standalone bridge picks up MQTT tags within
 *  ~30s (no restart). Operators never touch Supabase — this is the whole UI. */

import { useState } from "react";
import { Loader2, Radio, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { Site, Tag } from "../types";
import { PRESETS, presetOf, type PresetKey } from "../presets";

type Mode = "simulator" | "mqtt";

export function SourceDialog({
  tag,
  sites,
  onSaved,
  onClose,
}: {
  tag: Tag;
  sites: Site[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const cfg = tag.config as Record<string, unknown>;
  const enabledSites = sites.filter((s) => s.enabled || s.id === tag.site_id);

  const [mode, setMode] = useState<Mode>(tag.source === "mqtt" ? "mqtt" : "simulator");
  const [preset, setPreset] = useState<PresetKey>(presetOf(tag.config));
  const [siteId, setSiteId] = useState(tag.site_id ?? enabledSites[0]?.id ?? "");
  const [topic, setTopic] = useState(String(cfg.mqtt_topic ?? ""));
  const [alarmMin, setAlarmMin] = useState(
    cfg.alarm_min === undefined || cfg.alarm_min === null ? "" : String(cfg.alarm_min)
  );
  const [alarmMax, setAlarmMax] = useState(
    cfg.alarm_max === undefined || cfg.alarm_max === null ? "" : String(cfg.alarm_max)
  );
  // Scaling / calibration: stored = raw * scale + offset, rounded to `decimals`.
  const [scale, setScale] = useState(
    cfg.scale === undefined || cfg.scale === null ? "" : String(cfg.scale)
  );
  const [offset, setOffset] = useState(
    cfg.offset === undefined || cfg.offset === null ? "" : String(cfg.offset)
  );
  const [decimals, setDecimals] = useState(
    cfg.decimals === undefined || cfg.decimals === null ? "" : String(cfg.decimals)
  );
  const [saving, setSaving] = useState(false);

  // Live preview of what a raw reading of 100 becomes after scaling
  const scaleNum = scale.trim() === "" ? 1 : Number(scale.trim().replace(",", "."));
  const offsetNum = offset.trim() === "" ? 0 : Number(offset.trim().replace(",", "."));
  const decNum = decimals.trim() === "" ? null : Number(decimals.trim());
  const previewValid = Number.isFinite(scaleNum) && Number.isFinite(offsetNum);
  const previewStored = previewValid
    ? (() => {
        const v = 100 * scaleNum + offsetNum;
        return decNum !== null && Number.isFinite(decNum)
          ? v.toFixed(Math.max(0, Math.min(6, decNum)))
          : String(v);
      })()
    : "—";

  const canSave =
    mode === "simulator" ||
    (siteId !== "" && topic.trim() !== "" && enabledSites.length > 0);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      if (mode === "simulator") {
        await scadaApi.updateTag(tag.id, {
          source: "simulator",
          config: { ...PRESETS[preset].config },
          unit: PRESETS[preset].unit,
        });
      } else {
        const config: Record<string, unknown> = { mqtt_topic: topic.trim() };
        const min = alarmMin.trim().replace(",", ".");
        const max = alarmMax.trim().replace(",", ".");
        if (min !== "" && Number.isFinite(Number(min))) config.alarm_min = Number(min);
        if (max !== "" && Number.isFinite(Number(max))) config.alarm_max = Number(max);
        // Scaling / calibration — omit no-op values to keep config clean
        const sc = scale.trim().replace(",", ".");
        const of = offset.trim().replace(",", ".");
        const dec = decimals.trim();
        if (sc !== "" && Number.isFinite(Number(sc)) && Number(sc) !== 1)
          config.scale = Number(sc);
        if (of !== "" && Number.isFinite(Number(of)) && Number(of) !== 0)
          config.offset = Number(of);
        if (dec !== "" && Number.isInteger(Number(dec)))
          config.decimals = Number(dec);
        await scadaApi.updateTag(tag.id, {
          source: "mqtt",
          site_id: siteId,
          config,
        });
      }
      await onSaved();
      onClose();
    } catch {
      toast.error("Gagal menyimpan sumber");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <Radio className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Sumber Data
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5 truncate">
              {tag.label} — dari mana nilainya diambil
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { m: "simulator", label: "Simulator", desc: "Data contoh" },
                { m: "mqtt", label: "MQTT", desc: "Sensor asli" },
              ] as const
            ).map(({ m, label, desc }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-[var(--r-lg)] border px-3 py-2.5 text-left",
                  mode === m
                    ? "border-primary bg-primary/5 text-text"
                    : "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
                )}
              >
                <span className="text-[13px] font-semibold">{label}</span>
                <span className="text-[11px] text-text-light">{desc}</span>
              </button>
            ))}
          </div>

          {mode === "simulator" ? (
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Jenis Simulator
              </label>
              <select
                className="field-select cursor-pointer"
                value={preset}
                onChange={(e) => setPreset(e.target.value as PresetKey)}
              >
                {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                  <option key={key} value={key}>
                    {PRESETS[key].label} ({PRESETS[key].unit})
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-text-light">
                Mengganti jenis akan menyetel ulang unit dan pola datanya.
              </p>
            </div>
          ) : enabledSites.length === 0 ? (
            <p className="text-[12px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
              Belum ada site MQTT. Buat dulu lewat tombol{" "}
              <span className="font-semibold">Kelola Site</span> di toolbar Analisis.
            </p>
          ) : (
            <>
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
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
              </div>
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Topik MQTT <span className="text-red">*</span>
                </label>
                <input
                  className="field-input font-mono"
                  placeholder="rnet/tanobel/boiler1/temperature"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={300}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Alarm bila &lt;
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="field-input"
                    placeholder="min (opsional)"
                    value={alarmMin}
                    onChange={(e) => setAlarmMin(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Alarm bila &gt;
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="field-input"
                    placeholder="maks (opsional)"
                    value={alarmMax}
                    onChange={(e) => setAlarmMax(e.target.value)}
                  />
                </div>
              </div>

              {/* Scaling / kalibrasi — mentah → satuan teknik */}
              <div className="rounded-[var(--r-lg)] border border-border-soft bg-bg-sidebar p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-text">
                    Scaling / Kalibrasi <span className="font-normal text-text-light">(opsional)</span>
                  </span>
                  <code className="text-[10.5px] text-text-muted">
                    tersimpan = mentah × skala + offset
                  </code>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Skala
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="1"
                      value={scale}
                      onChange={(e) => setScale(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Offset
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="0"
                      value={offset}
                      onChange={(e) => setOffset(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Desimal
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="6"
                      className="field-input"
                      placeholder="auto"
                      value={decimals}
                      onChange={(e) => setDecimals(e.target.value)}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-text-light">
                  {previewValid ? (
                    <>Contoh: nilai mentah <span className="font-mono text-text-muted">100</span> tersimpan jadi{" "}
                    <span className="font-mono font-semibold text-text">{previewStored}</span> {tag.unit}.</>
                  ) : (
                    <span className="text-red">Skala/offset harus berupa angka.</span>
                  )}{" "}
                  Berlaku untuk data baru saja; contoh 4–20&nbsp;mA → 0–100: skala 6.25, offset −25.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            className="btn btn-primary btn-sm"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
