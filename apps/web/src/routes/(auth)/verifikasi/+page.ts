import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api';
import { loadMe } from '$lib/session.svelte';

export async function load() {
  const me = await loadMe(true);
  if (!me) redirect(307, '/masuk');
  if (me.verification.any) redirect(307, '/');
  const config = await api<{ mailEnabled: boolean }>('/api/auth/config').catch(() => ({
    mailEnabled: false,
  }));
  return { me, config };
}
