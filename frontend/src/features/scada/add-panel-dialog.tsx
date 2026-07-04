"use client";

/** Add-panel dialog — dead simple by design: pick a panel type (only Video
 *  is active in Phase 1), pick a stream, done. */

import { useState } from "react";
import { BarChart3, Bell, MonitorPlay, Table2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Panel, Stream } from "./types";

const PANEL_TYPES = [
  { type: "video", label: "Video Stream", icon: MonitorPlay, available: true },
  { type: "chart", label: "Grafik Sensor", icon: BarChart3, available: false },
  { type: "table", label: "Tabel Historian", icon: Table2, available: false },
  { type: "alarm", label: "Alarm", icon: Bell, available: false },
] as const;

export function AddPanelDialog({
  streams,
  existingPanels,
  onAdd,
  onClose,
}: {
  streams: Stream[];
  existingPanels: Panel[];
  onAdd: (panel: Panel) => void;
  onClose: () => void;
}) {
  const enabledStreams = streams.filter((s) => s.enabled);
  const [streamId, setStreamId] = useState(enabledStreams[0]?.id ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const stream = enabledStreams.find((s) => s.id === streamId);
    if (!stream) return;
    // Place the new panel below everything else; the grid compacts it up
    const bottomY = existingPanels.reduce(
      (max, p) => Math.max(max, p.grid.y + p.grid.h),
      0
    );
    onAdd({
      id: crypto.randomUUID(),
      type: "video",
      title: stream.name,
      grid: { x: 0, y: bottomY, w: existingPanels.length === 0 ? 12 : 6, h: 8 },
      config: { stream_id: stream.id, object_fit: "contain", muted: true },
    });
  }

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
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {PANEL_TYPES.map(({ type, label, icon: Icon, available }) => (
              <div
                key={type}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-[var(--r-lg)] border px-3 py-3",
                  available
                    ? "border-primary bg-primary/5 text-text"
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
              </div>
            ))}
          </div>

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
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="submit"
            disabled={enabledStreams.length === 0}
            className="btn btn-primary btn-sm"
          >
            Tambah Panel
          </button>
        </div>
      </form>
    </div>
  );
}
