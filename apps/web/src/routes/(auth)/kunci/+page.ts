import { redirect } from '@sveltejs/kit';
import { loadMe } from '$lib/session.svelte';

export async function load({ url }) {
  const me = await loadMe(true);
  if (!me) redirect(307, `/masuk?next=${encodeURIComponent(url.searchParams.get('next') ?? '/')}`);
  if (!me.locked) redirect(307, url.searchParams.get('next') ?? '/');
  return { me };
}
