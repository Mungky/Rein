import { redirect } from '@sveltejs/kit';
import { loadMe } from '$lib/session.svelte';

export async function load() {
  const me = await loadMe(true);
  if (!me) redirect(307, '/masuk');
  if (me.verification.email) redirect(307, '/');
  return { me };
}
