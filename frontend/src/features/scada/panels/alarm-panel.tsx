"use client";

/** Alarm panel — displays the SERVER-side alarm state (scada_alarm_events,
 *  evaluated 24/7 by the backend engine) for a set of tags. The browser no
 *  longer computes alarm status itself: open events arrive via the store
 *  (`activeAlarms`, fed by Realtime + polling), live values via `liveValues`
 *  (scada_tag_latest) with a getLatest fetch as fallback.
 *
 *  Each open event can be acknowledged ("Ack" — saya sudah tahu) by holders
 *  of scada:ack; who acked and when is stored forever. "Riwayat" opens the
 *  permanent alarm log. Status always ships icon + text, never color alone. */

import { useCallback, useMemo, useState } from "react";
import {
  AlertOctagon,
  Bell,
  BellOff,
  CheckCircle2,
  History,
  Loader2,
  MinusCircle,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useScadaStore } from "../store";
import type { AlarmEvent, AlarmPanelConfig, Tag } from "../types";
import { usePanelRefresh } from "./use-panel-refresh";
import { AlarmHistoryDialog } from "./alarm-history-dialog";

type Status = "kritis" | "bisu" | "diakui" | "normal" | "nodata" | "notset";

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

const STATUS_UI: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; text: string; row: string }
> = {
  kritis: { label: "Alarm", icon: AlertOctagon, text: "text-red", row: "bg-red/5" },
  bisu: { label: "Bisu", icon: BellOff, text: "text-amber", row: "bg-amber/5" },
  diakui: { label: "Diakui", icon: UserCheck, text: "text-amber", row: "bg-amber/5" },
  normal: { label: "Normal", icon: CheckCircle2, text: "text-green", row: "" },
  nodata: { label: "Tanpa data", icon: MinusCircle, text: "text-text-light", row: "" },
  notset: { label: "Tanpa ambang", icon: MinusCircle, text: "text-text-light", row: "" },
};

const ORDER: Record<Status, number> = {
  kritis: 0,
  bisu: 1,
  diakui: 2,
  nodata: 3,
  normal: 4,
  notset: 5,
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlarmPanel({ config, tags }: { config: AlarmPanelConfig; tags: Tag[] }) {
  const { role } = useAuthDisplay();
  const canAck = useCan(role as AppRole, "scada:ack");
  const activeAlarms = useScadaStore((s) => s.activeAlarms);
  const liveValues = useScadaStore((s) => s.liveValues);
  const setLiveValue = useScadaStore((s) => s.setLiveValue);
  const refreshActiveAlarms = useScadaStore((s) => s.refreshActiveAlarms);
  const [showHistory, setShowHistory] = useState(false);
  const [ackingId, setAckingId] = useState<string | null>(null);

  // Fallback for live values when Realtime is unavailable: fetch the latest
  // lane on the shared panel cadence.
  const load = useCallback(async () => {
    if (config.tag_ids.length === 0) return;
    try {
      const res = await scadaApi.getLatest(config.tag_ids);
      for (const item of res.items) {
        setLiveValue(item.tag_id, { value: item.value, ts: item.ts });
      }
    } catch {
      /* best-effort — Realtime/polling elsewhere keeps things moving */
    }
  }, [config.tag_ids, setLiveValue]);

  usePanelRefresh(load);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const eventsByTag = useMemo(() => {
    const map = new Map<string, AlarmEvent[]>();
    for (const e of activeAlarms) {
      const list = map.get(e.tag_id);
      if (list) list.push(e);
      else map.set(e.tag_id, [e]);
    }
    return map;
  }, [activeAlarms]);

  const rows = useMemo(() => {
    return config.tag_ids
      .map((tagId) => {
        const tag = tagById.get(tagId);
        const bounds = boundsOf(tag);
        const live = liveValues[tagId];
        const events = eventsByTag.get(tagId) ?? [];
        const valueEvent = events.find((e) => e.kind !== "silent") ?? null;
        const silentEvent = events.find((e) => e.kind === "silent") ?? null;
        const primary = valueEvent ?? silentEvent;

        let status: Status;
        if (primary) {
          status = primary.ack_at
            ? "diakui"
            : primary.kind === "silent"
              ? "bisu"
              : "kritis";
        } else if (bounds.min === null && bounds.max === null) {
          status = "notset";
        } else if (!live) {
          status = "nodata";
        } else {
          status = "normal";
        }
        return { tagId, tag, bounds, live, event: primary, status };
      })
      .filter((r) => r.tag !== undefined || r.event !== null)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  }, [config.tag_ids, tagById, liveValues, eventsByTag]);

  const alarmCount = rows.filter(
    (r) => r.status === "kritis" || r.status === "bisu"
  ).length;

  async function ack(event: AlarmEvent) {
    setAckingId(event.id);
    try {
      await scadaApi.ackAlarm(event.id);
      await refreshActiveAlarms();
      toast.success("Alarm diakui — tercatat atas nama Anda");
    } catch {
      toast.error("Gagal meng-ack alarm");
    } finally {
      setAckingId(null);
    }
  }

  if (config.tag_ids.length === 0) {
    return <Center icon>Belum ada tag dipilih untuk alarm ini.</Center>;
  }
  if (rows.length === 0) {
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
        <span className="flex-1">
          {alarmCount > 0 ? `${alarmCount} alarm aktif` : "Semua normal"}
        </span>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--r-sm)] px-1.5 py-0.5 text-[10.5px] font-semibold text-text-muted hover:bg-bg-hover hover:text-text"
          title="Riwayat alarm"
        >
          <History className="size-3" /> Riwayat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {rows.map(({ tagId, tag, bounds, live, event, status }) => {
              const ui = STATUS_UI[status];
              const Icon = ui.icon;
              const unit = tag?.unit ?? event?.tag_unit ?? "";
              return (
                <tr key={tagId} className={cn("border-t border-border-soft", ui.row)}>
                  <td className="max-w-0 truncate px-3 py-1.5 font-medium text-text">
                    {tag?.label ?? event?.tag_label ?? "?"}
                    {(bounds.min !== null || bounds.max !== null) && (
                      <span className="ml-1 text-[10px] font-normal text-text-light">
                        {bounds.min !== null ? bounds.min.toLocaleString("id") : "−∞"}
                        {"–"}
                        {bounds.max !== null ? bounds.max.toLocaleString("id") : "∞"}
                      </span>
                    )}
                    {status === "diakui" && event?.ack_name && (
                      <span className="ml-1 block truncate text-[10px] font-normal text-text-light">
                        oleh {event.ack_name}
                        {event.ack_at ? ` · ${fmtTime(event.ack_at)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-text">
                    {!live ? "—" : live.value.toLocaleString("id")}
                    {unit && live && (
                      <span className="ml-0.5 text-[10px] font-normal text-text-light">
                        {unit}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-semibold",
                        ui.text
                      )}
                    >
                      <Icon className="size-3.5" />
                      {ui.label}
                    </span>
                  </td>
                  <td className="w-0 px-2 py-1.5 text-right">
                    {event && !event.ack_at && canAck && (
                      <button
                        type="button"
                        onClick={() => void ack(event)}
                        disabled={ackingId === event.id}
                        className="btn btn-secondary btn-sm h-6 gap-1 px-2 text-[10.5px]"
                        title="Tandai sudah diketahui (acknowledge)"
                      >
                        {ackingId === event.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <UserCheck className="size-3" />
                        )}
                        Ack
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showHistory && (
        <AlarmHistoryDialog tags={tags} onClose={() => setShowHistory(false)} />
      )}
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
