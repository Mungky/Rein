import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api';
import { loadMe } from '$lib/session.svelte';

export async function load() {
  const me = await loadMe();
  if (me) redirect(307, me.verification.email ? '/' : '/verifikasi');
  const config = await api<{ googleEnabled: boolean }>('/api/auth/config').catch(() => ({
    googleEnabled: false,
  }));
  return { googleEnabled: config.googleEnabled };
}
