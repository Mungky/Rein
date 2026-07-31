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
  AlertTriangle,
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
import { useScadaStore, useTagLiveValues } from "../store";
import {
  WARN_ALARM_KINDS,
  type AlarmColumn,
  type AlarmEvent,
  type AlarmPanelConfig,
  type Tag,
} from "../types";
import {
  PanelPlaceholder,
  formatValue,
  resolveDecimals,
} from "./elements";
import { usePanelRefresh } from "./use-panel-refresh";
import { AlarmHistoryDialog } from "./alarm-history-dialog";

/** Kolom yang tersedia + label headernya (urutan di sini = urutan bawaan
 *  saat user menambahkan kolom lewat editor kolom di inspector). */
export const ALARM_COLUMNS: { key: AlarmColumn; label: string }[] = [
  { key: "tag", label: "Tag" },
  { key: "bounds", label: "Ambang" },
  { key: "device", label: "Perangkat" },
  { key: "value", label: "Terkini" },
  { key: "status", label: "Status" },
  { key: "time", label: "Sejak" },
  { key: "ack", label: "" },
];

export const ALARM_COLUMNS_DEFAULT: AlarmColumn[] = [
  "tag",
  "bounds",
  "value",
  "status",
  "ack",
];

const TEXT_COLUMNS = new Set<AlarmColumn>(["tag", "device"]);

type Status =
  | "kritis"
  | "waspada"
  | "bisu"
  | "diakui"
  | "normal"
  | "nodata"
  | "notset";

interface Bounds {
  min: number | null;
  max: number | null;
  warnMin: number | null;
  warnMax: number | null;
}

function boundsOf(tag: Tag | undefined): Bounds {
  const cfg = (tag?.config ?? {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    v === undefined || v === null || v === "" || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  return {
    min: num(cfg.alarm_min),
    max: num(cfg.alarm_max),
    warnMin: num(cfg.warn_min),
    warnMax: num(cfg.warn_max),
  };
}

const STATUS_UI: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; text: string; row: string }
> = {
  kritis: { label: "Alarm", icon: AlertOctagon, text: "text-red", row: "bg-red/5" },
  waspada: { label: "Waspada", icon: AlertTriangle, text: "text-amber", row: "bg-amber/5" },
  bisu: { label: "Bisu", icon: BellOff, text: "text-amber", row: "bg-amber/5" },
  diakui: { label: "Diakui", icon: UserCheck, text: "text-amber", row: "bg-amber/5" },
  normal: { label: "Normal", icon: CheckCircle2, text: "text-green", row: "" },
  nodata: { label: "Tanpa data", icon: MinusCircle, text: "text-text-light", row: "" },
  notset: { label: "Tanpa ambang", icon: MinusCircle, text: "text-text-light", row: "" },
};

const ORDER: Record<Status, number> = {
  kritis: 0,
  waspada: 1,
  bisu: 2,
  diakui: 3,
  nodata: 4,
  normal: 5,
  notset: 6,
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
  const setLiveValue = useScadaStore((s) => s.setLiveValue);
  const refreshActiveAlarms = useScadaStore((s) => s.refreshActiveAlarms);
  const [showHistory, setShowHistory] = useState(false);
  const [ackingId, setAckingId] = useState<string | null>(null);

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

  /** Daftar centang KOSONG = tampilkan semua alarm yang sedang aktif.
   *
   *  Ini pembetulan perilaku, bukan sekadar setelan baru. Panel ini dulu selalu
   *  memetakan config.tag_ids, jadi alarm pada sensor yang tidak ada di daftar
   *  itu DIBUANG — padahal barisnya sudah ada di activeAlarms. Gejalanya persis
   *  seperti yang dilaporkan: lonceng di pojok menyalakan 3 alarm sementara
   *  panel Alarm di dinding yang sama berkata "Semua normal". Dan karena panel
   *  baru lahir dengan tag_ids kosong (component-palette), pemiliknya harus
   *  mencentang manual — maksimal 8 — lalu mengingat untuk mencentang lagi
   *  setiap kali ada sensor baru. Tidak ada orang yang ingat.
   *
   *  Jadi kosong sekarang berarti "semua", dan mencentang berarti "hanya ini". */
  const showAll = config.tag_ids.length === 0;

  const tagIds = useMemo(() => {
    if (!showAll) return config.tag_ids;
    // Panel alarm itu daftar alarm, bukan daftar sensor: dalam mode semua, yang
    // ditampilkan hanya sensor yang PUNYA kejadian terbuka. Menampilkan 300
    // baris "Normal" akan mengubur satu baris merah yang jadi alasan panel ini
    // dipasang.
    return [...new Set(activeAlarms.map((e) => e.tag_id))];
  }, [showAll, config.tag_ids, activeAlarms]);

  // Hanya nilai untuk tag panel ini — bukan seluruh peta live. Dengan peta
  // penuh, panel alarm 4 sensor digambar ulang tiap kali sensor mana pun dari
  // 300 berdetak.
  const liveValues = useTagLiveValues(tagIds);

  // Fallback for live values when Realtime is unavailable: fetch the latest
  // lane on the shared panel cadence.
  const load = useCallback(async () => {
    if (tagIds.length === 0) return;
    try {
      const res = await scadaApi.getLatest(tagIds);
      for (const item of res.items) {
        setLiveValue(item.tag_id, { value: item.value, ts: item.ts });
      }
    } catch {
      /* best-effort — Realtime/polling elsewhere keeps things moving */
    }
  }, [tagIds, setLiveValue]);

  usePanelRefresh(load);

  const rows = useMemo(() => {
    return tagIds
      .map((tagId) => {
        const tag = tagById.get(tagId);
        const bounds = boundsOf(tag);
        const live = liveValues[tagId];
        const events = eventsByTag.get(tagId) ?? [];
        // "expiring" is a reset reminder, not a value breach — never turn the
        // tile red for it (it surfaces via the bell + history instead).
        const valueEvent =
          events.find((e) => e.kind === "high" || e.kind === "low") ?? null;
        const warnEvent = events.find((e) => WARN_ALARM_KINDS.has(e.kind)) ?? null;
        const silentEvent = events.find((e) => e.kind === "silent") ?? null;
        // Urutan keparahan: kritis menang atas waspada, waspada atas bisu.
        const primary = valueEvent ?? warnEvent ?? silentEvent;

        let status: Status;
        if (primary) {
          status = primary.ack_at
            ? "diakui"
            : primary.kind === "silent"
              ? "bisu"
              : WARN_ALARM_KINDS.has(primary.kind)
                ? "waspada"
                : "kritis";
        } else if (
          bounds.min === null &&
          bounds.max === null &&
          bounds.warnMin === null &&
          bounds.warnMax === null
        ) {
          status = "notset";
        } else if (!live) {
          status = "nodata";
        } else {
          status = "normal";
        }
        return {
          tagId,
          tag,
          bounds,
          live,
          event: primary,
          status,
          decimals: resolveDecimals(config.decimals, tag?.config),
        };
      })
      .filter((r) => r.tag !== undefined || r.event !== null)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  }, [tagIds, tagById, liveValues, eventsByTag, config.decimals]);

  const alarmCount = rows.filter(
    (r) => r.status === "kritis" || r.status === "bisu"
  ).length;
  const warnCount = rows.filter((r) => r.status === "waspada").length;

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

  const columns = (config.columns ?? ALARM_COLUMNS_DEFAULT).filter((c) =>
    ALARM_COLUMNS.some((a) => a.key === c)
  );
  if (columns.length === 0) {
    return <PanelPlaceholder icon={Bell}>Semua kolom disembunyikan — pilih minimal satu.</PanelPlaceholder>;
  }

  type RowData = (typeof rows)[number];

  const cell = (col: AlarmColumn, r: RowData) => {
    const unit = r.tag?.unit ?? r.event?.tag_unit ?? "";
    switch (col) {
      case "tag":
        return (
          <>
            {r.tag?.label ?? r.event?.tag_label ?? "?"}
            {r.status === "diakui" && r.event?.ack_name && (
              <span className="ml-1 block truncate text-[10px] font-normal text-text-light">
                oleh {r.event.ack_name}
                {r.event.ack_at ? ` · ${fmtTime(r.event.ack_at)}` : ""}
              </span>
            )}
          </>
        );
      case "bounds": {
        // Tunjukkan ambang yang MENJELASKAN baris ini. Baris waspada yang
        // dilabeli pita alarm hanya membuat pembacanya bingung: angkanya tidak
        // cocok dengan nilai yang bikin barisnya kuning.
        const warnBand = r.status === "waspada";
        const min = warnBand ? r.bounds.warnMin : r.bounds.min;
        const max = warnBand ? r.bounds.warnMax : r.bounds.max;
        return min === null && max === null ? (
          <span className="text-text-light">—</span>
        ) : (
          <span className="text-[10.5px] text-text-light">
            {min !== null ? formatValue(min, r.decimals) : "−∞"}
            {"–"}
            {max !== null ? formatValue(max, r.decimals) : "∞"}
            {warnBand && <span className="ml-1 opacity-70">wsp</span>}
          </span>
        );
      }
      case "device":
        return (
          <span className="font-mono text-[11px] text-text-muted">
            {r.tag?.device_key ?? "—"}
          </span>
        );
      case "value":
        return (
          <>
            {!r.live ? "—" : formatValue(r.live.value, r.decimals)}
            {unit && r.live && (
              <span className="ml-0.5 text-[10px] font-normal text-text-light">
                {unit}
              </span>
            )}
          </>
        );
      case "status": {
        const ui = STATUS_UI[r.status];
        const Icon = ui.icon;
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-semibold",
              ui.text
            )}
          >
            <Icon className="size-3.5" />
            {ui.label}
          </span>
        );
      }
      case "time":
        return (
          <span className="text-[10.5px] text-text-light">
            {r.event ? fmtTime(r.event.triggered_at) : "—"}
          </span>
        );
      case "ack":
        return r.event && !r.event.ack_at && canAck ? (
          <button
            type="button"
            onClick={() => void ack(r.event!)}
            disabled={ackingId === r.event.id}
            className="btn btn-secondary btn-sm h-6 gap-1 px-2 text-[10.5px]"
            title="Tandai sudah diketahui (acknowledge)"
          >
            {ackingId === r.event.id ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <UserCheck className="size-3" />
            )}
            Ack
          </button>
        ) : null;
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Header strip: green when all clear, red when any tag is in alarm */}
      {config.show_header !== false && (
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold",
            alarmCount > 0
              ? "bg-red/10 text-red"
              : warnCount > 0
                ? "bg-amber/10 text-amber"
                : "bg-green/10 text-green"
          )}
        >
          {alarmCount > 0 ? (
            <Bell className="size-3.5" />
          ) : warnCount > 0 ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          <span className="flex-1">
            {alarmCount > 0
              ? `${alarmCount} alarm aktif${warnCount > 0 ? ` · ${warnCount} waspada` : ""}`
              : warnCount > 0
                ? `${warnCount} waspada`
                : "Semua normal"}
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
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <PanelPlaceholder>
            {showAll
              ? "Belum ada alarm aktif. Panel ini menampilkan semua sensor yang beralarm — centang sensor tertentu di pengaturan bila ingin dibatasi."
              : "Sensor yang dicentang tidak ditemukan (mungkin dinonaktifkan)."}
          </PanelPlaceholder>
        ) : (
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {rows.map((r) => {
              const ui = STATUS_UI[r.status];
              return (
                <tr
                  key={r.tagId}
                  className={cn("border-t border-border-soft", ui.row)}
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className={cn(
                        "px-2 py-1.5",
                        col === "tag" && "max-w-0 truncate font-medium text-text",
                        col === "value" && "font-semibold tabular-nums text-text",
                        col === "ack" && "w-0",
                        TEXT_COLUMNS.has(col) ? "text-left" : "text-right"
                      )}
                    >
                      {cell(col, r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {showHistory && (
        <AlarmHistoryDialog tags={tags} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

