/** Client-side sampling-level → seconds resolver.
 *
 *  The authoritative durations live in scada_settings and are ADMIN-TUNABLE
 *  (Panel Administrasi → R-Net). They drive the real ingest cadence in
 *  deploy/data/bridge.py and the silence window in the backend alarm engine.
 *
 *  This module used to hardcode 2/5/30/60 and never ask the server, with a
 *  comment claiming an exact match "doesn't matter". It does: retuning
 *  level_slow_s from 30 to 300 left the page marking every slow sensor offline
 *  after 90 s while the bridge was quite correctly writing one row every five
 *  minutes. The page called healthy sensors dead.
 *
 *  So the durations are now passed in from the store (fetched once at
 *  bootstrap, see store.loadAll). DEFAULT_LEVEL_SECONDS survives only as the
 *  pre-load fallback for the first paint — and as the answer when the settings
 *  fetch fails, which is deliberately non-fatal since this is a visual
 *  heuristic and a wrong-but-plausible window beats a blank page. */

import type { RnetSettings, SamplingLevel } from "./types";

/** Matches the server_default of scada_settings (migration e5f6g7h8i9j0) and
 *  DEFAULT_LEVELS in deploy/data/bridge.py. Fallback only — never the truth. */
export const DEFAULT_LEVEL_SECONDS: Record<SamplingLevel, number> = {
  fastest: 2,
  fast: 5,
  slow: 30,
  slowest: 60,
};

/** Which settings column holds each level's duration. */
const LEVEL_FIELD: Record<SamplingLevel, keyof RnetSettings> = {
  fastest: "level_fastest_s",
  fast: "level_fast_s",
  slow: "level_slow_s",
  slowest: "level_slowest_s",
};

export function levelSeconds(
  level: SamplingLevel | undefined,
  settings?: RnetSettings | null
): number {
  const key = level ?? "fast";
  const fallback = DEFAULT_LEVEL_SECONDS[key] ?? DEFAULT_LEVEL_SECONDS.fast;
  if (!settings) return fallback;
  const raw = settings[LEVEL_FIELD[key]];
  // A retuned-to-garbage value must not produce NaN windows downstream.
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** A tag's sampling interval in ms from its config.sampling_level. */
export function samplingIntervalMs(
  config: Record<string, unknown>,
  settings?: RnetSettings | null
): number {
  return (
    levelSeconds(config.sampling_level as SamplingLevel | undefined, settings) * 1000
  );
}

/** "Fast — 5 detik". Used wherever the user picks a level, so the choice shows
 *  what it actually means instead of a word they have to go look up. */
export function levelLabel(
  level: SamplingLevel,
  settings?: RnetSettings | null
): string {
  const name = level.charAt(0).toUpperCase() + level.slice(1);
  const s = levelSeconds(level, settings);
  return `${name} — ${s < 60 ? `${s} detik` : `${s / 60} menit`}`;
}
