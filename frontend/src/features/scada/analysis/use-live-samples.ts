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

/** Seed/refresh last-known values for ANY number of tags.
 *
 *  /latest caps at 100 ids per request, and this used to be handled by
 *  `.slice(0, LATEST_CAP)` — which is not a cap, it is silently dropping
 *  sensors 101 and up. On a 300-sensor plant two thirds of the table showed
 *  "—" until a Realtime event happened to arrive, and the watchdog that exists
 *  precisely for when Realtime is NOT arriving never covered them at all.
 *  Chunking asks the same question in several breaths instead of forgetting
 *  most of it. */
async function seedLatest(
  ids: string[],
  apply: (tagId: string, v: { value: number; ts: string }) => void
): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LATEST_CAP) {
    chunks.push(ids.slice(i, i + LATEST_CAP));
  }
  const results = await Promise.all(
    chunks.map((c) => scadaApi.getLatest(c).catch(() => null))
  );
  for (const res of results) {
    for (const item of res?.items ?? []) {
      apply(item.tag_id, { value: item.value, ts: item.ts });
    }
  }
}

export function useLiveSamples(enabled: boolean) {
  const setLiveValue = useScadaStore((s) => s.setLiveValue);
  const tags = useScadaStore((s) => s.tags);
  const activeSheetId = useScadaStore((s) => s.activeSheetId);
  const perspectives = useScadaStore((s) => s.perspectives);
  const activePerspectiveId = useScadaStore((s) => s.activePerspectiveId);

  /** Tags actually ON SCREEN right now (audit D-6): the rows of the open
   *  Analisis sheet, plus every tag referenced by a panel of the open
   *  perspective. Deliberately NOT `store.tags` — the store holds every tag the
   *  user may see, which at 50 plants is the whole 1 000 and would filter
   *  nothing. Panel configs name their tags as either `tag_id` or `tag_ids`
   *  depending on panel kind, so both shapes are collected. */
  const shownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tags) if (t.sheet_id === activeSheetId) ids.add(t.id);
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    for (const panel of active?.layout?.panels ?? []) {
      const cfg = (panel.config ?? {}) as {
        tag_id?: string | null;
        tag_ids?: string[];
      };
      if (cfg.tag_id) ids.add(cfg.tag_id);
      for (const id of cfg.tag_ids ?? []) if (id) ids.add(id);
    }
    return ids;
  }, [tags, activeSheetId, perspectives, activePerspectiveId]);
  // Mirrored into a ref so changing sheet/perspective does NOT tear down and
  // rebuild the Realtime channel — resubscribing drops events during the
  // handshake. Written in an effect, never during render.
  const shownRef = useRef<Set<string>>(shownIds);
  useEffect(() => {
    shownRef.current = shownIds;
  }, [shownIds]);

  // Yang di-seed/di-poll = tag yang SEDANG DITAMPILKAN (baris tabel aktif +
  // tag yang dirujuk panel), bukan seluruh isi store. Diurutkan supaya kunci
  // ini stabil dan efek di bawah tidak terpicu ulang hanya karena urutan
  // berubah.
  const tagIdsKey = useMemo(() => [...shownIds].sort().join(","), [shownIds]);

  // Watchdog: when Realtime is quiet (blocked websocket, RLS hiccup, broken
  // subscription — we've been burned before), fall back to polling /latest
  // every 5 s until events flow again. Live events reset the timer, so the
  // poll costs nothing while Realtime is healthy.
  const lastEventAt = useRef(0);
  useEffect(() => {
    if (!enabled || tagIdsKey === "") return;
    const t = setInterval(() => {
      if (Date.now() - lastEventAt.current < 10_000) return; // realtime sehat
      void seedLatest(tagIdsKey.split(","), setLiveValue);
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
    // best-effort — Realtime/polling still run kalau ini gagal
    void seedLatest(tagIdsKey.split(","), (id, v) => {
      if (!cancelled) setLiveValue(id, v);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, tagIdsKey, setLiveValue]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Audit D-6: the subscription used to be table-wide, so every browser
    // received an event for EVERY sensor in the fleet — with 50 plants that is
    // ~1 000 messages/second per open tab, of which a screen showing 8 gauges
    // uses under 1%. The rest is pure battery and bandwidth.
    //
    // Supabase Realtime filters server-side, but only with a single-column
    // operator — there is no "IN (...)". `tag_id=in.(a,b,c)` is not supported,
    // so off-screen tags are dropped here, BEFORE they reach the store. That
    // removes the expensive part (a React state update per event, ~1 000 times
    // a second at 50 plants); trimming the wire traffic itself needs a
    // per-plant channel and is left for the phase-5 work.
    const handle = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as unknown as LatestRow;
      if (!row || typeof row.value !== "number" || !row.tag_id) return;
      // Realtime is alive even when the row is for a sensor we don't show —
      // the watchdog must stand down either way, or it would poll forever.
      lastEventAt.current = Date.now();
      // Empty set = nothing resolved yet (first paint, perspective still
      // loading). Pass everything through rather than blanking the screen.
      const shown = shownRef.current;
      if (shown.size > 0 && !shown.has(row.tag_id)) return;
      setLiveValue(row.tag_id, { value: row.value, ts: row.ts });
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
