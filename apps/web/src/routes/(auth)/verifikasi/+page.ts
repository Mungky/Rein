import { redirect } from '@sveltejs/kit';
import { loadMe } from '$lib/session.svelte';

export async function load({ url }) {
  const me = await loadMe(true);
  if (!me) redirect(307, '/masuk');
  const manage = url.searchParams.get('manage') === '1';
  if (me.locked) redirect(307, '/kunci');
  if (me.verification.whatsapp && !manage) redirect(307, me.onboardingNext ?? '/');
  return { me, manage };
}
