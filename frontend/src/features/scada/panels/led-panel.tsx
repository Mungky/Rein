"use client";

/** LED indicator panel — lampu status on/off dari satu tag. Menyala ("on")
 *  saat nilai berada di sisi `direction` dari ambang. Identity never rides on
 *  color alone: the on/off label always accompanies the lamp.
 *  Posisi & ukuran tiap bagian datang dari kanvas komponen (config.layout). */

import { format } from "date-fns";
import { Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedPanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";
import { LayoutItem, LayoutSurface } from "./layout-box";
import { layoutMap } from "./elements";

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
  const el = layoutMap("led", config.elements, config.layout);
  // Kompat: config.show_value lama tetap dihormati bila elements belum diatur
  const showValue = config.elements
    ? el.value?.visible === true
    : config.show_value !== false;
  const device = tags.find((t) => t.id === config.tag_id)?.device_key ?? "";

  return (
    <LayoutSurface>
      {el.title?.visible && (
        <LayoutItem box={el.title.box} className="font-semibold text-text-muted">
          {label}
        </LayoutItem>
      )}

      {el.graphic?.visible && (
        <LayoutItem box={el.graphic.box} text={false}>
          <div className="flex h-full w-full items-center justify-center">
            <div
              className="aspect-square h-full max-h-full max-w-full rounded-full border-solid transition-colors"
              style={{
                background: on ? onColor : "transparent",
                borderColor: on ? onColor : offColor,
                borderWidth: "max(2px, 4%)",
                boxShadow: on ? `0 0 24px 4px ${onColor}` : undefined,
                opacity: on ? 1 : 0.5,
              }}
            />
          </div>
        </LayoutItem>
      )}

      {el.status?.visible && (
        <LayoutItem box={el.status.box} className="font-bold text-text">
          {on ? config.on_label || "AKTIF" : config.off_label || "MATI"}
        </LayoutItem>
      )}

      {showValue && el.value && (
        <LayoutItem box={el.value.box} className="tabular-nums text-text-muted">
          {value.toLocaleString("id")}
          {state.unit ? ` ${state.unit}` : ""}
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
      {icon && <Lightbulb className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
