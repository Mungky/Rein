"use client";

/** Keeps the store's `activeAlarms` in sync with the server-side alarm engine.
 *
 *  Primary signal: Supabase Realtime on public.scada_alarm_events (INSERT =
 *  alarm opened, UPDATE = acked/cleared) — on any event we RE-FETCH the active
 *  list from the API instead of reconstructing rows client-side, so the list
 *  is always the server's truth (labels joined, ordering, RLS).
 *
 *  Fallback: 30 s polling, same best-effort philosophy as use-live-samples —
 *  nothing depends on Realtime being available. */

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useScadaStore } from "./store";

const POLL_MS = 30_000;

export function useAlarmEvents(enabled: boolean) {
  const refreshActiveAlarms = useScadaStore((s) => s.refreshActiveAlarms);

  useEffect(() => {
    if (!enabled) return;

    void refreshActiveAlarms();
    const timer = setInterval(() => void refreshActiveAlarms(), POLL_MS);

    const supabase = getSupabaseClient();
    const channel = supabase
      ? supabase
          .channel("scada-alarm-events")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "scada_alarm_events" },
            () => void refreshActiveAlarms()
          )
          .subscribe()
      : null;

    return () => {
      clearInterval(timer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [enabled, refreshActiveAlarms]);
}
