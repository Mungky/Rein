"use client";

/** Toolbar alarm bell — the always-visible in-app notification surface.
 *  Shows the count of open alarms (red when any is unacknowledged), beeps via
 *  WebAudio when a NEW unacked alarm appears (no audio asset needed), and
 *  opens a dropdown listing active alarms with quick Ack + Riwayat access.
 *
 *  Sound respects two switches: the shared `sound_enabled` from alarm
 *  settings (scada:manage) and a personal mute persisted in localStorage. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, History, Loader2, UserCheck, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useScadaStore } from "./store";
import type { AlarmEvent } from "./types";
import { AlarmHistoryDialog } from "./panels/alarm-history-dialog";

const MUTE_KEY = "scada:alarm-muted";

const KIND_LABELS: Record<string, string> = {
  high: "di atas batas",
  low: "di bawah batas",
  silent: "sensor bisu",
  expiring: "akan diarsip & direset",
};

function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    // Two short pips — urgent but not obnoxious.
    for (const [start, freq] of [
      [0, 880],
      [0.25, 1175],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.18);
    }
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* audio blocked (no user gesture yet) — badge still shows */
  }
}

export function AlarmBell() {
  const { role } = useAuthDisplay();
  const canAck = useCan(role as AppRole, "scada:ack");
  const activeAlarms = useScadaStore((s) => s.activeAlarms);
  const tags = useScadaStore((s) => s.tags);
  const refreshActiveAlarms = useScadaStore((s) => s.refreshActiveAlarms);

  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [muted, setMuted] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(MUTE_KEY) === "1"
  );
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    scadaApi
      .getAlarmSettings()
      .then((s) => setSoundEnabled(s.sound_enabled))
      .catch(() => undefined);
  }, []);

  const unacked = useMemo(
    () => activeAlarms.filter((e) => !e.ack_at),
    [activeAlarms]
  );

  // Beep when the set of unacked alarms GROWS (new alarm, not on ack/clear).
  const prevIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(unacked.map((e) => e.id));
    const prev = prevIds.current;
    prevIds.current = ids;
    if (prev === null) return; // first load — don't beep for old alarms
    const hasNew = [...ids].some((id) => !prev.has(id));
    if (hasNew && soundEnabled && !muted) beep();
  }, [unacked, soundEnabled, muted]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  }

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

  const count = activeAlarms.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "btn btn-icon btn-sm relative",
          unacked.length > 0 ? "btn-secondary text-red" : "btn-ghost"
        )}
        title={count > 0 ? `${count} alarm aktif` : "Tidak ada alarm aktif"}
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-bold text-white",
              unacked.length > 0 ? "bg-red" : "bg-amber"
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-80 rounded-[var(--r-lg)] border border-border bg-bg p-1 shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 text-[12px] font-bold text-text">
                {count > 0 ? `${count} alarm aktif` : "Tidak ada alarm aktif"}
              </span>
              <button
                type="button"
                onClick={toggleMute}
                className="btn btn-ghost btn-icon btn-sm"
                title={muted ? "Bunyikan alarm di perangkat ini" : "Bisukan di perangkat ini"}
              >
                {muted ? (
                  <VolumeX className="size-3.5 text-text-light" />
                ) : (
                  <Volume2 className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowHistory(true);
                  setOpen(false);
                }}
                className="btn btn-ghost btn-icon btn-sm"
                title="Riwayat alarm"
              >
                <History className="size-3.5" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {activeAlarms.length === 0 ? (
                <p className="flex items-center gap-2 px-3 py-3 text-[12px] text-text-muted">
                  <BellOff className="size-3.5" /> Semua sensor dalam batas aman.
                </p>
              ) : (
                activeAlarms.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 rounded-[var(--r)] px-3 py-2 hover:bg-bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-text">
                        {e.tag_label}
                        {e.trigger_value !== null && (
                          <span className="ml-1 font-normal tabular-nums text-red">
                            {e.trigger_value.toLocaleString("id")}
                            {e.tag_unit ? ` ${e.tag_unit}` : ""}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[10.5px] text-text-light">
                        {KIND_LABELS[e.kind] ?? e.kind}
                        {e.threshold !== null &&
                          ` (batas ${e.threshold.toLocaleString("id")})`}
                        {e.ack_name
                          ? ` · diakui ${e.ack_name}`
                          : ""}
                      </p>
                    </div>
                    {!e.ack_at && canAck && (
                      <button
                        type="button"
                        onClick={() => void ack(e)}
                        disabled={ackingId === e.id}
                        className="btn btn-secondary btn-sm h-6 shrink-0 gap-1 px-2 text-[10.5px]"
                      >
                        {ackingId === e.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <UserCheck className="size-3" />
                        )}
                        Ack
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {showHistory && (
        <AlarmHistoryDialog tags={tags} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
