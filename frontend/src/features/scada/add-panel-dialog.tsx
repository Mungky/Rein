"use client";

/** Add-panel dialog — pick a panel type, fill its source, done.
 *  Alarm stays greyed out until its phase lands. */

import { useState } from "react";
import {
  BarChart3,
  Bell,
  Gauge,
  MonitorPlay,
  Table2,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RANGE_LABELS } from "./panels/chart-panel";
import type { ChartRange, Panel, Stream, Tag } from "./types";

type ActiveType = "video" | "chart" | "table" | "gauge" | "bar" | "alarm";

const PANEL_TYPES = [
  { type: "video", label: "Video Stream", icon: MonitorPlay, available: true },
  { type: "chart", label: "Grafik Sensor", icon: TrendingUp, available: true },
  { type: "table", label: "Tabel Sensor", icon: Table2, available: true },
  { type: "gauge", label: "Angka / Status", icon: Gauge, available: true },
  { type: "bar", label: "Bar Perbandingan", icon: BarChart3, available: true },
  { type: "alarm", label: "Alarm", icon: Bell, available: true },
] as const;

const MAX_TAGS: Record<"chart" | "table" | "bar" | "alarm", number> = {
  chart: 4,
  table: 8,
  bar: 8,
  alarm: 8,
};
const MIN_TAGS: Record<"chart" | "table" | "bar" | "alarm", number> = {
  chart: 1,
  table: 1,
  bar: 2,
  alarm: 1,
};

export function AddPanelDialog({
  streams,
  tags,
  existingPanels,
  onAdd,
  onClose,
}: {
  streams: Stream[];
  tags: Tag[];
  existingPanels: Panel[];
  onAdd: (panel: Panel) => void;
  onClose: () => void;
}) {
  const enabledStreams = streams.filter((s) => s.enabled);
  const enabledTags = tags.filter((t) => t.enabled);

  const [panelType, setPanelType] = useState<ActiveType>("video");
  const [streamId, setStreamId] = useState(enabledStreams[0]?.id ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [range, setRange] = useState<ChartRange>("24h");
  const [gaugeTagId, setGaugeTagId] = useState(enabledTags[0]?.id ?? "");
  const [warning, setWarning] = useState("");
  const [critical, setCritical] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  const isTagListType =
    panelType === "chart" ||
    panelType === "table" ||
    panelType === "bar" ||
    panelType === "alarm";
  const maxTags = isTagListType ? MAX_TAGS[panelType] : 0;

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id)
        ? prev.filter((t) => t !== id)
        : prev.length >= maxTags
          ? prev
          : [...prev, id]
    );
  }

  function switchType(type: ActiveType) {
    setPanelType(type);
    // chart↔table share the checkbox list but different limits — trim down
    if (type === "chart") setTagIds((prev) => prev.slice(0, MAX_TAGS.chart));
  }

  const canSubmit =
    panelType === "video"
      ? enabledStreams.length > 0
      : panelType === "gauge"
        ? gaugeTagId !== ""
        : tagIds.length >= MIN_TAGS[panelType];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Place the new panel below everything else; the grid compacts it up
    const bottomY = existingPanels.reduce(
      (max, p) => Math.max(max, p.grid.y + p.grid.h),
      0
    );
    const baseGrid = {
      x: 0,
      y: bottomY,
      w: existingPanels.length === 0 ? 12 : 6,
      h: 8,
    };
    const id = crypto.randomUUID();

    if (panelType === "video") {
      const stream = enabledStreams.find((s) => s.id === streamId);
      if (!stream) return;
      onAdd({
        id,
        type: "video",
        title: stream.name,
        grid: baseGrid,
        config: { stream_id: stream.id, object_fit: "contain", muted: true },
      });
      return;
    }

    if (panelType === "gauge") {
      const tag = enabledTags.find((t) => t.id === gaugeTagId);
      if (!tag) return;
      onAdd({
        id,
        type: "gauge",
        title: tag.label,
        grid: { ...baseGrid, w: 3, h: 5 },
        config: {
          tag_id: tag.id,
          warning: warning.trim() === "" ? null : Number(warning),
          critical: critical.trim() === "" ? null : Number(critical),
          direction,
        },
      });
      return;
    }

    if (tagIds.length < MIN_TAGS[panelType]) return;
    const firstTag = enabledTags.find((t) => t.id === tagIds[0]);

    if (panelType === "table") {
      onAdd({
        id,
        type: "table",
        title: `Ringkasan Sensor (${tagIds.length} tag)`,
        grid: { ...baseGrid, h: 6 },
        config: { tag_ids: tagIds, range },
      });
      return;
    }

    if (panelType === "bar") {
      onAdd({
        id,
        type: "bar",
        title: `Perbandingan (${tagIds.length} tag)`,
        grid: { ...baseGrid, h: 6 },
        config: { tag_ids: tagIds, range, metric: "avg" },
      });
      return;
    }

    if (panelType === "alarm") {
      onAdd({
        id,
        type: "alarm",
        title: `Alarm (${tagIds.length} tag)`,
        grid: { ...baseGrid, h: 6 },
        config: { tag_ids: tagIds, range },
      });
      return;
    }

    onAdd({
      id,
      type: "chart",
      title:
        tagIds.length === 1 && firstTag
          ? `Tren ${firstTag.label}`
          : `Tren Sensor (${tagIds.length} tag)`,
      grid: { ...baseGrid, h: 7 },
      config: { tag_ids: tagIds, range, show_minmax: tagIds.length === 1 },
    });
  }

  const noTagsHint = (
    <p className="text-[12px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
      Belum ada tag terdaftar. Tambahkan lewat tab Analisis
      (tombol &ldquo;+ Tambah Baris&rdquo;).
    </p>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        onSubmit={submit}
        className="modal-panel max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <MonitorPlay className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Tambah Panel
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Pilih jenis panel untuk layout ini
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
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {PANEL_TYPES.map(({ type, label, icon: Icon, available }) => (
              <button
                key={type}
                type="button"
                disabled={!available}
                onClick={() => available && switchType(type as ActiveType)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-[var(--r-lg)] border px-3 py-3",
                  available && panelType === type
                    ? "border-primary bg-primary/5 text-text"
                    : available
                      ? "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
                      : "border-border-soft bg-bg-sidebar text-text-light opacity-60"
                )}
              >
                <Icon className="size-5" />
                <span className="text-[12px] font-semibold">{label}</span>
                {!available && (
                  <span className="text-[10px] text-text-light">
                    Segera hadir
                  </span>
                )}
              </button>
            ))}
          </div>

          {panelType === "video" && (
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Sumber Video <span className="text-red">*</span>
              </label>
              {enabledStreams.length === 0 ? (
                <p className="text-[12px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
                  Belum ada stream terdaftar. Minta admin menambahkan stream
                  lewat tombol &ldquo;Kelola Stream&rdquo;.
                </p>
              ) : (
                <select
                  className="field-select cursor-pointer"
                  value={streamId}
                  onChange={(e) => setStreamId(e.target.value)}
                >
                  {enabledStreams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {isTagListType && (
            <>
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Tag Sensor ({panelType === "bar" ? `2–${maxTags}` : `maks. ${maxTags}`}){" "}
                  <span className="text-red">*</span>
                </label>
                {enabledTags.length === 0 ? (
                  noTagsHint
                ) : (
                  <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-[var(--r)] border border-border-soft p-1.5">
                    {enabledTags.map((t) => {
                      const checked = tagIds.includes(t.id);
                      const full = !checked && tagIds.length >= maxTags;
                      return (
                        <label
                          key={t.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-[12.5px]",
                            checked
                              ? "bg-primary/5 text-text"
                              : full
                                ? "text-text-light cursor-not-allowed"
                                : "text-text-muted hover:bg-bg-hover"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={full}
                            onChange={() => toggleTag(t.id)}
                            className="accent-[var(--rein-primary)]"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.label}
                            {t.unit ? ` (${t.unit})` : ""}
                          </span>
                          <span className="text-[10.5px] text-text-light">
                            {t.device_key}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Rentang Waktu
                </label>
                <select
                  className="field-select cursor-pointer"
                  value={range}
                  onChange={(e) => setRange(e.target.value as ChartRange)}
                >
                  {(Object.keys(RANGE_LABELS) as ChartRange[]).map((r) => (
                    <option key={r} value={r}>
                      {RANGE_LABELS[r]} terakhir
                    </option>
                  ))}
                </select>
              </div>

              {panelType === "alarm" && (
                <p className="text-[11px] text-text-light rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2">
                  Ambang alarm (batas min/maks) diatur per tag di tab{" "}
                  <span className="font-semibold">Analisis</span> → kolom Sumber.
                </p>
              )}
            </>
          )}

          {panelType === "gauge" && (
            <>
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Tag Sensor <span className="text-red">*</span>
                </label>
                {enabledTags.length === 0 ? (
                  noTagsHint
                ) : (
                  <select
                    className="field-select cursor-pointer"
                    value={gaugeTagId}
                    onChange={(e) => setGaugeTagId(e.target.value)}
                  >
                    {enabledTags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.unit ? ` (${t.unit})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Ambang Waspada
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="field-input"
                    placeholder="Kosong = tanpa ambang"
                    value={warning}
                    onChange={(e) => setWarning(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Ambang Kritis
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="field-input"
                    placeholder="Kosong = tanpa ambang"
                    value={critical}
                    onChange={(e) => setCritical(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Arah Bahaya
                </label>
                <select
                  className="field-select cursor-pointer"
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as "above" | "below")
                  }
                >
                  <option value="above">Bahaya jika nilai TERLALU TINGGI</option>
                  <option value="below">Bahaya jika nilai TERLALU RENDAH</option>
                </select>
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
            type="submit"
            disabled={!canSubmit}
            className="btn btn-primary btn-sm"
          >
            Tambah Panel
          </button>
        </div>
      </form>
    </div>
  );
}
