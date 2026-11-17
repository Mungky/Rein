import { error } from '@sveltejs/kit';
import { api, ApiError } from '$lib/api';
import type { LogEntry, WoDetail } from '$lib/types';

export async function load({ params, depends }) {
  depends('app:wo');
  try {
    const [wo, log] = await Promise.all([
      api<WoDetail>(`/api/work-orders/${params.id}`),
      api<{ entries: LogEntry[]; nextCursor: string | null }>(
        `/api/work-orders/${params.id}/logbook`,
      ),
    ]);
    return { wo, log };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      error(404, 'Work Order tidak ditemukan atau Anda tidak punya akses');
    }
    throw e;
  }
}
