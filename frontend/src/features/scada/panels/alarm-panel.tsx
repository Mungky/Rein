"use client";

/** Alarm panel — watches a set of tags and flags any whose latest value is
 *  outside its configured alarm band (tag.config.alarm_min / alarm_max, set in
 *  Analisis → Sumber). Breaching tags sort to the top in red; the rest show
 *  Normal. Status always ships icon + text, never color alone. */

import { useCallback, useMemo, useState } from "react";
import { AlertOctagon, Bell, CheckCircle2, Loader2, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { AlarmPanelConfig, SummaryItem, Tag } from "../types";
import { RANGE_MS } from "./chart-panel";
import { usePanelRefresh } from "./use-panel-refresh";

const STALE_MS = 3 * 60_000;

type Status = "kritis" | "normal" | "nodata" | "notset";

interface Bounds {
  min: number | null;
  max: number | null;
}

function boundsOf(tag: Tag | undefined): Bounds {
  const cfg = (tag?.config ?? {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    v === undefined || v === null || v === "" || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  return { min: num(cfg.alarm_min), max: num(cfg.alarm_max) };
}

function statusOf(last: number | null, b: Bounds): Status {
  if (last === null) return "nodata";
  if (b.min === null && b.max === null) return "notset";
  if ((b.max !== null && last > b.max) || (b.min !== null && last < b.min))
    return "kritis";
  return "normal";
}

const STATUS_UI: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; text: string; row: string }
> = {
  kritis: { label: "Alarm", icon: AlertOctagon, text: "text-red", row: "bg-red/5" },
  normal: { label: "Normal", icon: CheckCircle2, text: "text-green", row: "" },
  nodata: { label: "Tanpa data", icon: MinusCircle, text: "text-text-light", row: "" },
  notset: { label: "Tanpa ambang", icon: MinusCircle, text: "text-text-light", row: "" },
};

const ORDER: Record<Status, number> = { kritis: 0, nodata: 1, normal: 2, notset: 3 };

export function AlarmPanel({ config, tags }: { config: AlarmPanelConfig; tags: Tag[] }) {
  const [items, setItems] = useState<SummaryItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (config.tag_ids.length === 0) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - RANGE_MS[config.range]);
      const res = await scadaApi.getSummary(config.tag_ids, start, end);
      setItems(res.items);
      setFetchedAt(end.getTime());
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_ids, config.range]);

  usePanelRefresh(load);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const rows = useMemo(() => {
    if (!items) return [];
    return items
      .map((item) => {
        const tag = tagById.get(item.tag_id);
        const bounds = boundsOf(tag);
        const status = statusOf(item.last, bounds);
        return { item, tag, bounds, status, unit: item.unit || tag?.unit || "" };
      })
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  }, [items, tagById]);

  const alarmCount = rows.filter((r) => r.status === "kritis").length;

  if (config.tag_ids.length === 0) {
    return <Center icon>Belum ada tag dipilih untuk alarm ini.</Center>;
  }
  if (error && !items) {
    return <Center>Gagal memuat status — mencoba lagi…</Center>;
  }
  if (items === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (items.length === 0) {
    return <Center>Tag tidak ditemukan (mungkin dinonaktifkan).</Center>;
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Header strip: green when all clear, red when any tag is in alarm */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold",
          alarmCount > 0 ? "bg-red/10 text-red" : "bg-green/10 text-green"
        )}
      >
        <Bell className="size-3.5" />
        {alarmCount > 0
          ? `${alarmCount} alarm aktif`
          : "Semua normal"}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {rows.map(({ item, bounds, status, unit }) => {
              const ui = STATUS_UI[status];
              const Icon = ui.icon;
              const lastTs = item.last_ts ? new Date(item.last_ts) : null;
              const stale = lastTs !== null && fetchedAt - lastTs.getTime() > STALE_MS;
              return (
                <tr key={item.tag_id} className={cn("border-t border-border-soft", ui.row)}>
                  <td className="max-w-0 truncate px-3 py-1.5 font-medium text-text">
                    {item.label}
                    {(bounds.min !== null || bounds.max !== null) && (
                      <span className="ml-1 text-[10px] font-normal text-text-light">
                        {bounds.min !== null ? bounds.min.toLocaleString("id") : "−∞"}
                        {"–"}
                        {bounds.max !== null ? bounds.max.toLocaleString("id") : "∞"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-text">
                    {item.last === null ? "—" : item.last.toLocaleString("id")}
                    {unit && item.last !== null && (
                      <span className="ml-0.5 text-[10px] font-normal text-text-light">
                        {unit}
                      </span>
                    )}
                    {stale && (
                      <span className="ml-1 text-[9.5px] font-normal text-amber">usang</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", ui.text)}>
                      <Icon className="size-3.5" />
                      {ui.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Center({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <Bell className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
