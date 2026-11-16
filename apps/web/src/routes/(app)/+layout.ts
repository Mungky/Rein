import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api';
import { loadMe } from '$lib/session.svelte';

const FRESH_MS = 2 * 60_000;

function tabUnlocked(): boolean {
  try {
    return sessionStorage.getItem('rein:unlocked') === '1';
  } catch {
    return true;
  }
}

/**
 * Guard (app):
 *  - belum login → /masuk;
 *  - belum ada kontak terverifikasi → /verifikasi (FR-003 AC4, keputusan D2);
 *  - sesi terkunci, atau aplikasi dibuka ulang di perangkat ber-PIN → /kunci (FR-004 AC3);
 *  - perangkat trusted tanpa PIN → /pin (FR-004 AC1).
 */
export async function load({ url }) {
  const next = encodeURIComponent(url.pathname + url.search);
  let me = await loadMe();
  if (!me) redirect(307, `/masuk?next=${next}`);
  if (!me.verification.any) redirect(307, '/verifikasi');
  if (!me.locked && me.device?.hasPin && !tabUnlocked()) {
    const fresh = Date.now() - new Date(me.sessionStartedAt).getTime() < FRESH_MS;
    if (fresh) sessionStorage.setItem('rein:unlocked', '1');
    else {
      await api('/api/auth/pin/lock', { body: {} }).catch(() => {});
      me = await loadMe(true);
    }
  }
  if (me?.locked) redirect(307, `/kunci?next=${next}`);
  if (me?.pinRequired) redirect(307, `/pin?next=${next}`);
  return { me: me! };
}
