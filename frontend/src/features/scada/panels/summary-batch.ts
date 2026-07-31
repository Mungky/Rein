/** Per-page request coalescer for /summary (W5).
 *
 *  Every gauge/level/LED panel independently fetched its own 24h min/max/avg
 *  (one HTTP request per panel, per 60s, per viewer). On a wall of N single-tag
 *  panels that's N requests each minute. Since usePanelRefresh fires them all in
 *  the same tick (mount + aligned 60s interval + tab-visible), we can gather the
 *  tag ids requested within a short window and issue ONE /summary carrying all
 *  of them, then hand each waiter back its own row.
 *
 *  Grouped by window length (ms) so a panel with a different span keeps its own
 *  batch; the shared end is taken once per flush. Backends further cache each
 *  tag's aggregation, so even un-coalesced stragglers are cheap. */

import { scadaApi } from "@/lib/api/scada";
import type { SummaryItem } from "../types";

// Coalesce calls arriving within this window into one request.
const BATCH_MS = 20;
// Must stay ≤ the backend's MAX_SUMMARY_TAGS (60); larger pages are chunked.
const MAX_TAGS_PER_REQUEST = 60;

interface Waiter {
  resolve: (item: SummaryItem | null) => void;
  reject: (err: unknown) => void;
}

interface Batch {
  tags: Map<string, Waiter[]>;
  timer: ReturnType<typeof setTimeout> | null;
}

// Keyed by window length in ms.
const batches = new Map<number, Batch>();

/** Request one tag's summary over the last `spanMs`, coalesced with any other
 *  calls for the same span in this tick. Resolves null if the tag has no row. */
export function getSummaryItem(
  tagId: string,
  spanMs: number
): Promise<SummaryItem | null> {
  return new Promise((resolve, reject) => {
    let batch = batches.get(spanMs);
    if (!batch) {
      batch = { tags: new Map(), timer: null };
      batches.set(spanMs, batch);
    }
    const waiters = batch.tags.get(tagId) ?? [];
    waiters.push({ resolve, reject });
    batch.tags.set(tagId, waiters);
    if (batch.timer === null) {
      batch.timer = setTimeout(() => flush(spanMs), BATCH_MS);
    }
  });
}

/** Same, for a whole set of tags at once (table/bar panels).
 *
 *  Order follows `tagIds`, and tags with no row are dropped. Going through the
 *  coalescer instead of calling /summary directly is the whole point: a wall
 *  holding a table panel, a bar panel and four gauges at the same range used to
 *  issue three requests per refresh — one for the table, one for the bar, one
 *  coalesced for the gauges — asking overlapping questions about the same
 *  sensors. Now the batch window catches all of them and one request answers
 *  the lot. */
export async function getSummaryItems(
  tagIds: string[],
  spanMs: number
): Promise<SummaryItem[]> {
  const items = await Promise.all(
    tagIds.map((id) => getSummaryItem(id, spanMs))
  );
  return items.filter((it): it is SummaryItem => it !== null);
}

function flush(spanMs: number): void {
  const batch = batches.get(spanMs);
  if (!batch) return;
  batches.delete(spanMs);

  const end = new Date();
  const start = new Date(end.getTime() - spanMs);
  const tagIds = [...batch.tags.keys()];

  for (let i = 0; i < tagIds.length; i += MAX_TAGS_PER_REQUEST) {
    const chunk = tagIds.slice(i, i + MAX_TAGS_PER_REQUEST);
    void dispatch(chunk, start, end, batch.tags);
  }
}

async function dispatch(
  tagIds: string[],
  start: Date,
  end: Date,
  waiters: Map<string, Waiter[]>
): Promise<void> {
  try {
    const res = await scadaApi.getSummary(tagIds, start, end);
    const byId = new Map(res.items.map((it) => [it.tag_id, it]));
    for (const id of tagIds) {
      const item = byId.get(id) ?? null;
      for (const w of waiters.get(id) ?? []) w.resolve(item);
    }
  } catch (err) {
    for (const id of tagIds) {
      for (const w of waiters.get(id) ?? []) w.reject(err);
    }
  }
}
