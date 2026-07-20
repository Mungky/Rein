"use client";

/** LED indicator panel — lampu status on/off dari satu tag. Menyala ("on")
 *  saat nilai berada di sisi `direction` dari ambang. Identity never rides on
 *  color alone: the on/off label always accompanies the lamp. */

import { format } from "date-fns";
import { Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedPanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";

export function LedPanel({ config, tags }: { config: LedPanelConfig; tags: Tag[] }) {
  const state = useTagValue(config.tag_id ?? null, tags);

  if (!config.tag_id) {
    return (
      <Center icon>
        LED belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
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

  if (state.value === null) {
    return <Center icon>Belum ada data untuk {label}.</Center>;
  }

  const value = state.value;
  const on =
    config.direction === "above"
      ? value >= config.threshold
      : value <= config.threshold;
  const onColor = config.on_color ?? "var(--rein-green)";
  const offColor = config.off_color ?? "var(--rein-text-light)";
  const lastTs = state.valueTs ? new Date(state.valueTs) : null;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-bg px-3 py-2 text-center">
      <span className="max-w-full truncate text-[11.5px] font-semibold text-text-muted">
        {label}
      </span>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className="aspect-square h-[min(70%,96px)] rounded-full border-4 transition-colors"
          style={{
            background: on ? onColor : "transparent",
            borderColor: on ? onColor : offColor,
            boxShadow: on ? `0 0 24px 4px ${onColor}` : undefined,
            opacity: on ? 1 : 0.5,
          }}
        />
      </div>

      <span className="text-[13px] font-bold text-text">
        {on ? config.on_label || "AKTIF" : config.off_label || "MATI"}
      </span>

      <span className={cn("text-[10px]", state.stale ? "text-amber" : "text-text-light")}>
        {config.show_value !== false && (
          <>
            Nilai: {value.toLocaleString("id")}
            {state.unit ? ` ${state.unit}` : ""}
            {" · "}
          </>
        )}
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
      {icon && <Lightbulb className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
