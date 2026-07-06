"use client";

/** Supabase Realtime subscription for the Analisis workbench — the first
 *  Realtime consumer in the codebase.
 *
 *  Listens for INSERTs on public.scada_samples (RLS-gated by scada:view; see
 *  migration q1r2s3t4u5v6) and feeds the store's liveValues map. Volume is
 *  tiny (1 insert/minute/tag), so no server-side filter — rows for unknown
 *  tags are simply ignored by consumers.
 *
 *  This is a best-effort accelerator: if Realtime is unavailable (env not
 *  set, channel error), the workbench still works off the 60s summary
 *  polling — nothing depends on this hook succeeding. */

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useScadaStore } from "../store";

interface SampleRow {
  tag_id: string;
  ts: string;
  value: number;
}

export function useLiveSamples(enabled: boolean) {
  const setLiveValue = useScadaStore((s) => s.setLiveValue);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel("scada-samples")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scada_samples" },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as unknown as SampleRow;
          if (row && typeof row.value === "number" && row.tag_id) {
            setLiveValue(row.tag_id, { value: row.value, ts: row.ts });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, setLiveValue]);
}
