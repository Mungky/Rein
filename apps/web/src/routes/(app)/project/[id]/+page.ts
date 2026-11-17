import { error } from '@sveltejs/kit';
import { api, ApiError } from '$lib/api';
import type { ProjectDetail, WoRow } from '$lib/types';

export async function load({ params, depends }) {
  depends('app:project');
  try {
    const [project, wl] = await Promise.all([
      api<ProjectDetail>(`/api/projects/${params.id}`),
      api<{
        workOrders: WoRow[];
        actor: { userId: string; canEditAny: boolean; canEditOwn: boolean };
      }>(`/api/projects/${params.id}/work-orders`),
    ]);
    return { project, workOrders: wl.workOrders, actor: wl.actor };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      error(404, 'Project tidak ditemukan atau Anda bukan anggota');
    }
    throw e;
  }
}
