"use client";

/** Level/tank panel — vertical fill that follows one tag on a min–max scale
 *  (cocok untuk tangki air / silo). Fill color follows status: normal =
 *  config.color (default chart blue), waspada/kritis = REIN status tokens.
 *  Posisi & ukuran tiap bagian datang dari kanvas komponen (config.layout). */

import { format } from "date-fns";
import { Droplets, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LevelPanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";
import { LayoutItem, LayoutSurface } from "./layout-box";
import { layoutMap, readTagThresholds, tagStatusOf } from "./elements";

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
  const tag = tags.find((t) => t.id === config.tag_id);
  const status = tagStatusOf(value, readTagThresholds(tag?.config));
  const fill =
    status === "kritis"
      ? "var(--rein-red)"
      : status === "waspada"
        ? "var(--rein-amber)"
        : config.color ?? "var(--rnet-chart-1)";
  const lastTs = state.valueTs ? new Date(state.valueTs) : null;
  const el = layoutMap("level", config.elements, config.layout);
  const device = tag?.device_key ?? "";

  return (
    <LayoutSurface>
      {el.title?.visible && (
        <LayoutItem box={el.title.box} className="font-semibold text-text-muted">
          {label}
        </LayoutItem>
      )}

      {el.graphic?.visible && (
        <LayoutItem box={el.graphic.box} text={false}>
          {/* Tangki: kerangka + cairan yang naik-turun */}
          <div
            className="relative h-full w-full overflow-hidden rounded-[10px] border-2 border-border bg-bg-sidebar"
            style={{ containerType: "size" }}
          >
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
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="font-bold tabular-nums text-text drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                style={{ fontSize: "14cqh" }}
              >
                {Math.round(f * 100)}%
              </span>
            </div>
          </div>
        </LayoutItem>
      )}

      {el.value?.visible && (
        <LayoutItem box={el.value.box} className="text-text">
          <span className="font-bold tabular-nums">{value.toLocaleString("id")}</span>
          {unit && (
            <span className="ml-[0.25em] text-[0.72em] text-text-muted">{unit}</span>
          )}
          <span className="ml-[0.4em] text-[0.6em] text-text-light">
            · skala {config.min.toLocaleString("id")}–{config.max.toLocaleString("id")}
          </span>
        </LayoutItem>
      )}

      {el.device?.visible && device && (
        <LayoutItem box={el.device.box} className="font-mono text-text-light">
          {device}
        </LayoutItem>
      )}

      {el.footer?.visible && (
        <LayoutItem
          box={el.footer.box}
          className={cn(state.stale ? "text-amber" : "text-text-light")}
        >
          {lastTs
            ? state.stale
              ? `Data usang (terakhir ${format(lastTs, "HH:mm")})`
              : `Diperbarui ${format(lastTs, "HH:mm")}`
            : null}
        </LayoutItem>
      )}
    </LayoutSurface>
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
