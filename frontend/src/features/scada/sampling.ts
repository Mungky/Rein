/** Client-side sampling-level → seconds resolver.
 *
 *  The authoritative durations live in scada_settings (admin-tunable) and drive
 *  the real backend logic (bridge/alarm/archiver). These defaults are only for
 *  visual heuristics on the page (offline timing, live-throttle) where an exact
 *  match to a retuned duration doesn't matter. */

import type { SamplingLevel } from "./types";

export const DEFAULT_LEVEL_SECONDS: Record<SamplingLevel, number> = {
  fastest: 2,
  fast: 5,
  slow: 30,
  slowest: 60,
};

export function levelSeconds(level: SamplingLevel | undefined): number {
  return DEFAULT_LEVEL_SECONDS[level ?? "fast"] ?? 5;
}

/** A tag's sampling interval in ms from its config.sampling_level (default). */
export function samplingIntervalMs(config: Record<string, unknown>): number {
  return levelSeconds(config.sampling_level as SamplingLevel | undefined) * 1000;
}
