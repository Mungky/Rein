import { error } from '@sveltejs/kit';
import { todayWib } from '@rein/shared';
import { api, ApiError } from '$lib/api';
import type { LogEntry, WoDetail } from '$lib/types';

export async function load({ params, depends, parent, url }) {
  depends('app:wo');
  try {
    const { me } = await parent();
    const account = me.user.id;
    const period: 'day' | 'week' = url.searchParams.get('period') === 'day' ? 'day' : 'week';
    const date = url.searchParams.get('date');
    const entry = url.searchParams.get('catatan');
    const tab = url.searchParams.get('tab') === 'activity' ? 'activity' : 'logbook';
    const logQuery = new URLSearchParams({ view: 'notes' });
    if (period !== 'week') logQuery.set('period', period);
    if (date) logQuery.set('date', date);
    if (entry) logQuery.set('entry', entry);
    const [wo, log] = await Promise.all([
      api<WoDetail>(`/api/work-orders/${params.id}`, { account }),
      api<{ entries: LogEntry[]; nextCursor: string | null }>(
        `/api/work-orders/${params.id}/logbook?${logQuery}`,
        { account },
      ),
    ]);
    return { wo, log, tab, period, date: date ?? todayWib(), entry, logQuery: logQuery.toString() };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      error(404, 'Work Order tidak ditemukan atau Anda tidak punya akses');
    }
    throw e;
  }
}
