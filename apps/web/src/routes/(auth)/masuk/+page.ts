import { redirect } from '@sveltejs/kit';
import { api, ApiError } from '$lib/api';
import { loadMe } from '$lib/session.svelte';

export async function load() {
  const me = await loadMe().catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 0) return null;
    throw err;
  });
  if (me) redirect(307, me.verification.any ? '/' : '/verifikasi');
  const config = await api<{ googleEnabled: boolean }>('/api/auth/config').catch(() => ({
    googleEnabled: false,
  }));
  return { googleEnabled: config.googleEnabled };
}
