import { normalizedWeights, type WoProgressInput } from './progress';
import type { WoStatus } from './enums';

export interface CurveWorkOrder extends WoProgressInput {
  plannedStart: string;
  deadline: string;
}
export interface CurveEvent {
  woId: string;
  progress: number;
  status: WoStatus;
  recordedAt: string;
}
const DAY = 86_400_000;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** PRD §8.4: bobot saat ini, histori aktual per akhir hari WIB, tanpa mengarang aktual mendatang. */
export function buildSCurve(
  items: readonly CurveWorkOrder[],
  events: readonly CurveEvent[],
  today: string,
) {
  const counted = items.filter((w) => w.status !== 'canceled');
  const weights = normalizedWeights(counted);
  const current = day(today);
  const start = Math.min(current, ...counted.map((w) => day(w.plannedStart)));
  const end = Math.max(current, ...counted.map((w) => day(w.deadline)));
  const planAt = (t: number) =>
    counted.reduce(
      (sum, w) =>
        sum +
        (weights.get(w.id) ?? 0) *
          clamp((t - day(w.plannedStart)) / Math.max(1, day(w.deadline) - day(w.plannedStart))) *
          100,
      0,
    );
  const history = events
    .filter((e) => weights.has(e.woId))
    .map((e) => ({ ...e, time: Date.parse(e.recordedAt) }))
    .sort((a, b) => a.time - b.time);
  let cursor = 0;
  const progress = new Map<string, number>();
  const actualAt = (t: number) => {
    const cutoff = (t + 1) * DAY - 7 * 3600_000 - 1;
    while (cursor < history.length && history[cursor]!.time <= cutoff) {
      const event = history[cursor++]!;
      progress.set(
        event.woId,
        event.status === 'done' ? 100 : Math.max(0, Math.min(100, event.progress)),
      );
    }
    return counted.reduce(
      (sum, w) => sum + (weights.get(w.id) ?? 0) * (progress.get(w.id) ?? 0),
      0,
    );
  };
  const step = Math.max(1, Math.ceil((end - start) / 116));
  const dates = new Set<number>([start, end, current]);
  for (let t = start; t <= end; t += step) dates.add(t);
  const forecastDates = Array.from({ length: 14 }, (_, i) => current - 13 + i);
  const values = new Map<number, number>();
  const required = [...new Set([...dates, ...forecastDates])]
    .filter((t) => t <= current)
    .sort((a, b) => a - b);
  for (const t of required) values.set(t, actualAt(t));
  const points = [...dates]
    .sort((a, b) => a - b)
    .map((t) => ({ date: iso(t), plan: planAt(t), actual: t <= current ? values.get(t)! : null }));
  const actual = values.get(current) ?? 0;
  const plan = planAt(current);
  const average = forecastDates.reduce((sum, t) => sum + (values.get(t) ?? 0), 0) / 14;
  const slope =
    forecastDates.reduce((sum, t, i) => sum + (i - 6.5) * ((values.get(t) ?? 0) - average), 0) /
    227.5;
  const forecastDays = slope > 0 ? Math.ceil((100 - actual) / slope) : Infinity;
  const predictedFinish =
    actual >= 100
      ? today
      : Number.isFinite(forecastDays) && forecastDays < 365_000
        ? iso(current + forecastDays)
        : null;
  return {
    points,
    today,
    plan,
    actual,
    deviation: actual - plan,
    spi: plan > 0 ? actual / plan : null,
    predictedFinish,
    weights: counted.map((w) => ({
      id: w.id,
      weight: (weights.get(w.id) ?? 0) * 100,
      progress: w.status === 'done' ? 100 : w.progress,
      contribution: (weights.get(w.id) ?? 0) * (w.status === 'done' ? 100 : w.progress),
    })),
  };
}
export type SCurveData = ReturnType<typeof buildSCurve>;
