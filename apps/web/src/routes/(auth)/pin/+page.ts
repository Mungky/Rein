import { redirect } from '@sveltejs/kit';
import { loadMe } from '$lib/session.svelte';

export async function load() {
  const me = await loadMe(true);
  if (!me) redirect(307, '/masuk');
  if (!me.verification.any) redirect(307, '/verifikasi');
  if (me.locked) redirect(307, '/kunci');
  if (me.onboardingNext && me.onboardingNext !== '/pin') redirect(307, me.onboardingNext);
  return { me };
}
