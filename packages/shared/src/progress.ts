/**
 * Progres project & per kategori (PRD §8.4 butir 1, 2, 4, 7 dan "Progres per kategori").
 * Rumus Plan(t)/S-Curve lengkap menyusul di M2; M1 memakai Actual(today).
 */
import type { WoCategory, WoStatus } from './enums';
import { WO_CATEGORIES } from './enums';

export interface WoProgressInput {
  id: string;
  category: WoCategory;
  status: WoStatus;
  /** 0–100, null = tanpa bobot eksplisit */
  weight: number | null;
  /** 0–100 */
  progress: number;
}

/**
 * Bobot ternormalisasi (Σ = 1) untuk WO yang dihitung (tidak dihapus & tidak dibatalkan).
 *  - Ada bobot eksplisit dan Σ ≤ 100: sisa (100 − Σ) dibagi rata ke WO tanpa bobot.
 *  - Σ eksplisit > 100, atau tidak ada WO tanpa bobot: w_i = bobot_i / Σ bobot.
 *  - Semua kosong: 1/N.
 */
export function normalizedWeights(items: readonly WoProgressInput[]): Map<string, number> {
  const counted = items.filter((w) => w.status !== 'canceled');
  const out = new Map<string, number>();
  if (!counted.length) return out;
  const explicit = counted.filter((w) => w.weight != null && w.weight > 0);
  const empty = counted.filter((w) => w.weight == null || w.weight <= 0);
  const sumExplicit = explicit.reduce((s, w) => s + (w.weight ?? 0), 0);

  let raw: Array<[string, number]>;
  if (!explicit.length) {
    raw = counted.map((w) => [w.id, 1]);
  } else if (sumExplicit <= 100 && empty.length) {
    const share = (100 - sumExplicit) / empty.length;
    raw = [
      ...explicit.map((w): [string, number] => [w.id, w.weight ?? 0]),
      ...empty.map((w): [string, number] => [w.id, share]),
    ];
  } else {
    raw = counted.map((w) => [w.id, w.weight != null && w.weight > 0 ? w.weight : 0]);
  }
  const total = raw.reduce((s, [, v]) => s + v, 0);
  for (const [id, v] of raw) out.set(id, total > 0 ? v / total : 1 / raw.length);
  return out;
}

const effective = (w: WoProgressInput) =>
  w.status === 'done' ? 100 : Math.max(0, Math.min(100, w.progress));

/** Actual(today) dalam persen (0–100, desimal). */
export function actualProgress(items: readonly WoProgressInput[]): number {
  const weights = normalizedWeights(items);
  let sum = 0;
  for (const w of items) sum += (weights.get(w.id) ?? 0) * effective(w);
  return sum;
}

/** Progres project yang ditampilkan di semua daftar: dibulatkan ke integer (§8.4 butir 7). */
export function projectProgress(items: readonly WoProgressInput[]): number {
  return Math.round(actualProgress(items));
}

export interface CategorySummary {
  category: WoCategory;
  total: number;
  done: number;
  /** progres kategori 0–100 (bobot dinormalisasi di dalam kategori) */
  progress: number;
  /** porsi bobot kategori terhadap project (0–1) — lebar segmen bar */
  share: number;
}

/** Ringkasan per kategori; kategori tanpa WO tidak ikut (FR-022 AC). */
export function categorySummaries(items: readonly WoProgressInput[]): CategorySummary[] {
  const projectWeights = normalizedWeights(items);
  const out: CategorySummary[] = [];
  for (const category of WO_CATEGORIES) {
    const inCat = items.filter((w) => w.category === category);
    if (!inCat.length) continue;
    const counted = inCat.filter((w) => w.status !== 'canceled');
    out.push({
      category,
      total: counted.length,
      done: counted.filter((w) => w.status === 'done').length,
      progress: Math.round(actualProgress(inCat)),
      share: counted.reduce((s, w) => s + (projectWeights.get(w.id) ?? 0), 0),
    });
  }
  return out;
}
