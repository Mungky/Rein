"use client";

/** "Atur Sumber" — where a tag's data comes from, edited inline in Analisis.
 *  One path only: **Node-RED** (over MQTT under the hood) — Node-RED is the
 *  universal translator that speaks to any PLC/device and forwards values to
 *  the broker; R-Net just listens. Pick a site (broker), type the topic, set
 *  alarm bounds + storage interval. Saving PATCHes the tag; the standalone
 *  bridge picks it up within ~30s (no restart). The old "Simulator" mode
 *  (fake demo data) was removed — Node-RED's fake-factory flow is the test
 *  rig now, so no misleading placeholder values ever appear. */

import { useState } from "react";
import { Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { scadaApi } from "@/lib/api/scada";
import type { Site, Tag } from "../types";

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

  const [siteId, setSiteId] = useState(tag.site_id ?? enabledSites[0]?.id ?? "");
  const [topic, setTopic] = useState(String(cfg.mqtt_topic ?? ""));
  const [alarmMin, setAlarmMin] = useState(
    cfg.alarm_min === undefined || cfg.alarm_min === null ? "" : String(cfg.alarm_min)
  );
  const [alarmMax, setAlarmMax] = useState(
    cfg.alarm_max === undefined || cfg.alarm_max === null ? "" : String(cfg.alarm_max)
  );
  // Waspada = zona kuning DI DALAM batas alarm (mendekati bahaya, belum bahaya).
  const [warnMin, setWarnMin] = useState(
    cfg.warn_min === undefined || cfg.warn_min === null ? "" : String(cfg.warn_min)
  );
  const [warnMax, setWarnMax] = useState(
    cfg.warn_max === undefined || cfg.warn_max === null ? "" : String(cfg.warn_max)
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

  const canSave = siteId !== "" && topic.trim() !== "" && enabledSites.length > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      // Preserve settings owned by the row-detail dropdown (store_enabled,
      // sampling_level, store_cycle_start) — this dialog only owns
      // topic/alarm/scaling. Spreading ...cfg keeps them intact.
      const config: Record<string, unknown> = { ...cfg, mqtt_topic: topic.trim() };
      delete config.alarm_min;
      delete config.alarm_max;
      delete config.warn_min;
      delete config.warn_max;
      delete config.scale;
      delete config.offset;
      delete config.decimals;
      delete config.silent_alarm; // sensor-bisu is automatic now
      const min = alarmMin.trim().replace(",", ".");
      const max = alarmMax.trim().replace(",", ".");
      const wmin = warnMin.trim().replace(",", ".");
      const wmax = warnMax.trim().replace(",", ".");
      if (min !== "" && Number.isFinite(Number(min))) config.alarm_min = Number(min);
      if (max !== "" && Number.isFinite(Number(max))) config.alarm_max = Number(max);
      if (wmin !== "" && Number.isFinite(Number(wmin))) config.warn_min = Number(wmin);
      if (wmax !== "" && Number.isFinite(Number(wmax))) config.warn_max = Number(wmax);
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
      await onSaved();
      onClose();
    } catch {
      toast.error("Gagal menyimpan sumber");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Sumber Data — Node-RED"
      subtitle={`${tag.label} — dari mana nilainya diambil`}
      icon={<Radio className="size-5" />}
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
        <div className="flex flex-col gap-4">
          {enabledSites.length === 0 ? (
            <p className="text-[12px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
              Belum ada site (broker). Buat dulu lewat tombol{" "}
              <span className="font-semibold">Kelola Site</span> di toolbar Analisis
              — isi alamat broker yang sama dengan yang dipakai Node-RED.
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
                  Topik <span className="text-red">*</span>
                </label>
                <input
                  className="field-input font-mono"
                  placeholder="rnet/pabrik1/boiler1/temperature"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={300}
                />
                <p className="mt-1.5 text-[11px] text-text-light">
                  Samakan persis dengan topik di node <span className="font-mono">mqtt out</span> Node-RED.
                </p>
              </div>
              {/* Ambang status — dipakai SEMUA panel gauge/level sensor ini
                  (satu sumber). Urut nilai: Alarm bawah < Waspada bawah <
                  aman < Waspada atas < Alarm atas. */}
              <div className="rounded-[var(--r-lg)] border border-border-soft bg-bg-sidebar p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-text">
                    Ambang Status <span className="font-normal text-text-light">(opsional)</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10px] font-semibold">
                    <span className="text-amber">● Waspada</span>
                    <span className="text-red">● Alarm</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Alarm bila &lt; <span className="text-red">(bawah)</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="min"
                      value={alarmMin}
                      onChange={(e) => setAlarmMin(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Alarm bila &gt; <span className="text-red">(atas)</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="maks"
                      value={alarmMax}
                      onChange={(e) => setAlarmMax(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Waspada bila &lt; <span className="text-amber">(bawah)</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="mendekati min"
                      value={warnMin}
                      onChange={(e) => setWarnMin(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                      Waspada bila &gt; <span className="text-amber">(atas)</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      className="field-input"
                      placeholder="mendekati maks"
                      value={warnMax}
                      onChange={(e) => setWarnMax(e.target.value)}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-text-light">
                  Waspada = kuning saat nilai mulai mendekati batas; Alarm = merah
                  saat melewatinya (memicu notifikasi). Kosongkan yang tidak perlu.
                </p>
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
    </Drawer>
  );
}
