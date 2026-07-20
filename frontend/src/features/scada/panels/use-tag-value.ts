"use client";

/** Shared data feed for single-tag components (gauge, level, LED): a 60 s
 *  summary snapshot (last/min/max 24 jam) overlaid with the store's realtime
 *  value whenever it's newer — the number ticks live between refetches. */

import { useCallback, useState } from "react";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "../store";
import type { SummaryItem, Tag } from "../types";
import { usePanelRefresh } from "./use-panel-refresh";

const STATS_WINDOW_MS = 86_400_000; // min/max footer selalu 24 jam terakhir
const STALE_MS = 3 * 60_000; // sampler cadence ×3 → data dianggap usang

export interface TagValueState {
  /** Newest known value (live overlay beats the summary snapshot). */
  value: number | null;
  /** ISO timestamp of `value`, null when there is no data yet. */
  valueTs: string | null;
  /** 24-jam summary row (min/max/avg footer), null until loaded/missing. */
  item: SummaryItem | null;
  loaded: boolean;
  error: boolean;
  stale: boolean;
  label: string;
  unit: string;
}

export function useTagValue(tagId: string | null, tags: Tag[]): TagValueState {
  const [item, setItem] = useState<SummaryItem | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!tagId) {
      setLoaded(true);
      return;
    }
    try {
      const end = new Date();
      const start = new Date(end.getTime() - STATS_WINDOW_MS);
      const res = await scadaApi.getSummary([tagId], start, end);
      setItem(res.items[0] ?? null);
      setFetchedAt(end.getTime());
      setLoaded(true);
      setError(false);
    } catch {
      setError(true);
    }
  }, [tagId]);

  usePanelRefresh(load);

  const live = useScadaStore((s) => (tagId ? s.liveValues[tagId] : undefined));

  const tag = tags.find((t) => t.id === tagId);
  const liveNewer =
    live &&
    (!item?.last_ts ||
      new Date(live.ts).getTime() > new Date(item.last_ts).getTime());
  const value = liveNewer ? live!.value : item?.last ?? null;
  const valueTs = liveNewer ? live!.ts : item?.last_ts ?? null;
  // fetchedAt refreshes every 60 s; a live value newer than it yields a
  // negative delta → never stale. (No Date.now() in render — purity rule.)
  const stale =
    valueTs !== null && fetchedAt - new Date(valueTs).getTime() > STALE_MS;

  return {
    value,
    valueTs,
    item,
    loaded,
    error,
    stale,
    label: item?.label || tag?.label || "Tag",
    unit: item?.unit || tag?.unit || "",
  };
}
