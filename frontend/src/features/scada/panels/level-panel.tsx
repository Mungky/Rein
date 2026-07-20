"use client";

/** Level/tank panel — vertical fill that follows one tag on a min–max scale
 *  (cocok untuk tangki air / silo). Fill color follows status: normal =
 *  config.color (default chart blue), waspada/kritis = REIN status tokens. */

import { format } from "date-fns";
import { Droplets, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LevelPanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";

type Status = "normal" | "waspada" | "kritis";

function statusOf(value: number, config: LevelPanelConfig): Status {
  const bad = (threshold: number) =>
    config.direction === "above" ? value >= threshold : value <= threshold;
  if (config.critical !== null && bad(config.critical)) return "kritis";
  if (config.warning !== null && bad(config.warning)) return "waspada";
  return "normal";
}

export function LevelPanel({ config, tags }: { config: LevelPanelConfig; tags: Tag[] }) {
  const state = useTagValue(config.tag_id ?? null, tags);

  if (!config.tag_id) {
    return (
      <Center icon>
        Level belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
        untuk memilih sensor.
      </Center>
    );
  }
  if (state.error && !state.loaded) {
    return <Center>Gagal memuat nilai — mencoba lagi…</Center>;
  }
  if (!state.loaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }

  const label = config.label || state.label;
  const unit = config.unit ?? state.unit;

  if (state.value === null) {
    return <Center icon>Belum ada data untuk {label}.</Center>;
  }

  const value = state.value;
  const span = config.max - config.min || 1;
  const f = Math.min(1, Math.max(0, (value - config.min) / span));
  const status = statusOf(value, config);
  const fill =
    status === "kritis"
      ? "var(--rein-red)"
      : status === "waspada"
        ? "var(--rein-amber)"
        : config.color ?? "var(--rnet-chart-1)";
  const lastTs = state.valueTs ? new Date(state.valueTs) : null;

  return (
    <div className="flex h-full w-full flex-col items-center gap-1.5 bg-bg px-3 py-2 text-center">
      <span className="max-w-full truncate text-[11.5px] font-semibold text-text-muted">
        {label}
      </span>

      {/* Tangki: kerangka + cairan yang naik-turun */}
      <div className="relative min-h-0 w-full flex-1">
        <div className="absolute inset-x-1/2 top-0 h-full w-[min(58%,110px)] -translate-x-1/2 overflow-hidden rounded-[10px] border-2 border-border bg-bg-sidebar">
          <div
            className="absolute inset-x-0 bottom-0 transition-[height] duration-700"
            style={{ height: `${f * 100}%`, background: fill, opacity: 0.85 }}
          />
          {/* Garis ukur 25/50/75% */}
          {[0.25, 0.5, 0.75].map((m) => (
            <div
              key={m}
              className="absolute inset-x-0 border-t border-dashed border-text-light/30"
              style={{ bottom: `${m * 100}%` }}
            />
          ))}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
            <span className="text-[15px] font-bold tabular-nums text-text drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
              {Math.round(f * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-[16px] font-bold tabular-nums text-text">
          {value.toLocaleString("id")}
        </span>
        {unit && <span className="text-[11px] text-text-muted">{unit}</span>}
        <span className="text-[10px] text-text-light">
          · skala {config.min.toLocaleString("id")}–{config.max.toLocaleString("id")}
        </span>
      </div>

      <span className={cn("text-[10px]", state.stale ? "text-amber" : "text-text-light")}>
        {lastTs
          ? state.stale
            ? `Data usang (terakhir ${format(lastTs, "HH:mm")})`
            : `Diperbarui ${format(lastTs, "HH:mm")}`
          : null}
      </span>
    </div>
  );
}

function Center({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <Droplets className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
