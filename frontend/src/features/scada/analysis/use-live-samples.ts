"use client";

/** Supabase Realtime subscription for the Analisis workbench — the first
 *  Realtime consumer in the codebase.
 *
 *  Listens on public.scada_tag_latest (RLS-gated by scada:view; see migration
 *  b2c3d4e5f6g7): one row per tag, UPSERTed at ~1 s cadence by the MQTT
 *  bridge / historian live lane. INSERT covers a tag's first-ever value,
 *  UPDATE covers everything after — so live numbers tick every second while
 *  history rows (scada_samples) only land per each tag's storage interval.
 *
 *  This is a best-effort accelerator: if Realtime is unavailable (env not
 *  set, channel error), the workbench still works off the 60s summary
 *  polling — nothing depends on this hook succeeding. */

import { useEffect, useMemo, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "../store";

interface LatestRow {
  tag_id: string;
  ts: string;
  value: number;
}

const LATEST_CAP = 100; // GET /latest caps at 100 tags per request

export function useLiveSamples(enabled: boolean) {
  const setLiveValue = useScadaStore((s) => s.setLiveValue);
  const tags = useScadaStore((s) => s.tags);
  const tagIdsKey = useMemo(
    () => tags.map((t) => t.id).slice(0, LATEST_CAP).join(","),
    [tags]
  );

  // Watchdog: when Realtime is quiet (blocked websocket, RLS hiccup, broken
  // subscription — we've been burned before), fall back to polling /latest
  // every 5 s until events flow again. Live events reset the timer, so the
  // poll costs nothing while Realtime is healthy.
  const lastEventAt = useRef(0);
  useEffect(() => {
    if (!enabled || tagIdsKey === "") return;
    const t = setInterval(() => {
      if (Date.now() - lastEventAt.current < 10_000) return; // realtime sehat
      scadaApi
        .getLatest(tagIdsKey.split(","))
        .then((res) => {
          for (const item of res.items) {
            setLiveValue(item.tag_id, { value: item.value, ts: item.ts });
          }
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [enabled, tagIdsKey, setLiveValue]);

  // Seed: fetch the last-known value per tag once tags are loaded, so the UI
  // shows real numbers immediately — without this, a sensor that happens to
  // be quiet while the page is open would look empty even though its latest
  // value sits in scada_tag_latest.
  useEffect(() => {
    if (!enabled || tagIdsKey === "") return;
    let cancelled = false;
    scadaApi
      .getLatest(tagIdsKey.split(","))
      .then((res) => {
        if (cancelled) return;
        for (const item of res.items) {
          setLiveValue(item.tag_id, { value: item.value, ts: item.ts });
        }
      })
      .catch(() => undefined); // best-effort — Realtime/polling still run
    return () => {
      cancelled = true;
    };
  }, [enabled, tagIdsKey, setLiveValue]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const handle = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as unknown as LatestRow;
      if (row && typeof row.value === "number" && row.tag_id) {
        lastEventAt.current = Date.now(); // realtime alive → watchdog stands down
        setLiveValue(row.tag_id, { value: row.value, ts: row.ts });
      }
    };

    const channel = supabase
      .channel("scada-tag-latest")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scada_tag_latest" },
        handle
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "scada_tag_latest" },
        handle
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, setLiveValue]);
}
