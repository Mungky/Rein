import { redirect } from '@sveltejs/kit';
import { loadMe } from '$lib/session.svelte';

/** Guard: belum login → /masuk; email belum terverifikasi → /verifikasi (FR-003 AC4). */
export async function load({ url }) {
  const me = await loadMe();
  if (!me) redirect(307, `/masuk?next=${encodeURIComponent(url.pathname + url.search)}`);
  if (!me.verification.email) redirect(307, '/verifikasi');
  return { me };
}
