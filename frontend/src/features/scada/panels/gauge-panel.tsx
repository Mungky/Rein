"use client";

/** Gauge/stat panel — one big current value with threshold-driven status.
 *  Status uses the reserved REIN status tokens (green/amber/red), never the
 *  chart series palette, and always ships icon + text — never color alone. */

import { useCallback, useState } from "react";
import { format } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "../store";
import type { GaugePanelConfig, SummaryItem, Tag } from "../types";
import { usePanelRefresh } from "./use-panel-refresh";

const STATS_WINDOW_MS = 86_400_000; // min/max footer selalu 24 jam terakhir
const STALE_MS = 3 * 60_000; // sampler cadence ×3 → data dianggap usang

type Status = "normal" | "waspada" | "kritis";

function statusOf(value: number, config: GaugePanelConfig): Status {
  const bad = (threshold: number) =>
    config.direction === "above" ? value >= threshold : value <= threshold;
  if (config.critical !== null && bad(config.critical)) return "kritis";
  if (config.warning !== null && bad(config.warning)) return "waspada";
  return "normal";
}

const STATUS_UI: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; text: string; ring: string }
> = {
  normal: {
    label: "Normal",
    icon: CheckCircle2,
    text: "text-green",
    ring: "ring-green/30",
  },
  waspada: {
    label: "Waspada",
    icon: AlertTriangle,
    text: "text-amber",
    ring: "ring-amber/40",
  },
  kritis: {
    label: "Kritis",
    icon: AlertOctagon,
    text: "text-red",
    ring: "ring-red/40",
  },
};

export function GaugePanel({ config, tags }: { config: GaugePanelConfig; tags: Tag[] }) {
  const [item, setItem] = useState<SummaryItem | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - STATS_WINDOW_MS);
      const res = await scadaApi.getSummary([config.tag_id], start, end);
      setItem(res.items[0] ?? null);
      setFetchedAt(end.getTime());
      setLoaded(true);
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_id]);

  usePanelRefresh(load);

  // Live overlay: the store's realtime value (scada_tag_latest) beats the
  // 60 s summary snapshot whenever it's newer — the big number ticks live.
  const live = useScadaStore((s) => s.liveValues[config.tag_id]);

  const tag = tags.find((t) => t.id === config.tag_id);
  const unit = item?.unit || tag?.unit || "";
  const label = item?.label || tag?.label || "Tag";

  if (error && !loaded) {
    return <Center>Gagal memuat nilai — mencoba lagi…</Center>;
  }
  if (!loaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (item === null && !live) {
    return <Center>Tag tidak ditemukan (mungkin dinonaktifkan).</Center>;
  }

  const liveNewer =
    live &&
    (!item?.last_ts || new Date(live.ts).getTime() > new Date(item.last_ts).getTime());
  const value = liveNewer ? live!.value : item?.last ?? null;
  const valueTsIso = liveNewer ? live!.ts : item?.last_ts ?? null;

  if (value === null) {
    return <Center icon>Belum ada data untuk {label}.</Center>;
  }

  const status = statusOf(value, config);
  const ui = STATUS_UI[status];
  const StatusIcon = ui.icon;
  const lastTs = valueTsIso ? new Date(valueTsIso) : null;
  // fetchedAt refreshes every 60 s; a live value newer than it yields a
  // negative delta → never stale. (No Date.now() in render — purity rule.)
  const stale = lastTs !== null && fetchedAt - lastTs.getTime() > STALE_MS;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-bg px-3 py-2 text-center">
      <span className="max-w-full truncate text-[11.5px] font-semibold text-text-muted">
        {label}
      </span>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[clamp(24px,12cqh,44px)] font-bold leading-none tabular-nums text-text">
          {value.toLocaleString("id")}
        </span>
        {unit && <span className="text-[13px] text-text-muted">{unit}</span>}
      </div>

      <span
        className={cn(
          "flex items-center gap-1 rounded-[var(--r-pill)] px-2 py-0.5 text-[11px] font-semibold ring-1",
          ui.text,
          ui.ring
        )}
      >
        <StatusIcon className="size-3.5" />
        {ui.label}
      </span>

      <span className={cn("text-[10px]", stale ? "text-amber" : "text-text-light")}>
        {item !== null && item.min !== null && item.max !== null && (
          <>
            24 jam: {item.min.toLocaleString("id")}–{item.max.toLocaleString("id")}
            {" · "}
          </>
        )}
        {lastTs
          ? stale
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
      {icon && <Gauge className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
