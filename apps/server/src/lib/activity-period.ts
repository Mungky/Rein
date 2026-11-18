import { z } from 'zod';
import { todayWib } from '@rein/shared';

export const activityPeriodQuery = z.object({
  period: z.enum(['day', 'week', 'all']).default('week'),
  date: z.iso.date().optional(),
});

export function activityPeriod({ period, date }: z.infer<typeof activityPeriodQuery>) {
  if (period === 'all') return null;
  const day = date ?? todayWib();
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const dayMs = 86_400_000;
  const start =
    Date.parse(`${day}T00:00:00+07:00`) - (period === 'week' ? daysSinceMonday * dayMs : 0);
  return { from: new Date(start), to: new Date(start + (period === 'week' ? 7 : 1) * dayMs) };
}
