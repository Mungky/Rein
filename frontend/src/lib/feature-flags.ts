/**
 * Feature locks — a single place to disable modules that are not in use yet.
 *
 * A locked feature shows a greyed, non-clickable nav item (like "Pengaturan")
 * and its route renders a "coming soon" screen instead of the real UI. Nothing
 * is deleted — flip the flag to `true` to bring the whole module back at once.
 */
export const FEATURES = {
  dashboard: false,
  workspace: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

/** True when the feature is turned off and should be shown as locked. */
export function isLocked(key: FeatureKey): boolean {
  return !FEATURES[key];
}
