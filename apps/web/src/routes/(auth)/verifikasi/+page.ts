import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api';
import { loadMe } from '$lib/session.svelte';

export async function load({ url }) {
  const me = await loadMe(true);
  if (!me) redirect(307, '/masuk');
  const manage = url.searchParams.get('manage') === '1';
  if (me.verification.any && !manage) redirect(307, '/');
  const config = await api<{ mailEnabled: boolean }>('/api/auth/config').catch(() => ({
    mailEnabled: false,
  }));
  return { me, config, manage };
}
