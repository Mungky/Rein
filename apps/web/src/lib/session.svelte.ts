import type { PermissionKey, PermissionMap } from '@rein/shared';
import { api, ApiError } from './api';
import { privateCache, saveBinding } from './offline-store';

export const ACTIVE_ACCOUNT_KEY = 'rein:active-account';
const OFFLINE_SESSION = 'rein:offline-session';
const PENDING_LOGOUT = 'rein:pending-logout';

export interface Me {
  user: {
    id: string;
    username: string;
    fullName: string;
    nickname: string | null;
    roleName: string;
    avatarUrl: string | null;
    email: string | null;
    whatsapp: string | null;
  };
  permissions: PermissionMap;
  /** Keputusan server: akun baru wajib WA; kontak terverifikasi akun lama tetap berlaku. */
  verification: { email: boolean; whatsapp: boolean; any: boolean };
  device: { hasPin: boolean; trusted: boolean } | null;
  onboardingNext: '/verifikasi' | '/pin' | '/sambutan' | null;
  /** FR-004 AC3: sesi terkunci → layar PIN. */
  locked: boolean;
  sessionStartedAt: string;
  sessionExpiresAt: string;
}

export const session = $state<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

async function rememberOfflineSession(me: Me) {
  try {
    const previous = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, me.user.id);
    const until = Math.min(
      Date.parse(me.sessionExpiresAt),
      Date.now() + (me.device?.hasPin ? 15 * 60_000 : 12 * 3_600_000),
    );
    const eligible = me.device?.trusted && !me.locked && !me.onboardingNext && me.verification.any;
    if (eligible) sessionStorage.setItem(OFFLINE_SESSION, JSON.stringify({ until, me }));
    else sessionStorage.removeItem(OFFLINE_SESSION);
    await saveBinding(eligible ? { account: me.user.id, until } : null);
    if (previous && (previous !== me.user.id || !eligible))
      await caches.delete(privateCache(previous));
  } catch {
    // Mode privat bisa menolak IndexedDB atau penyimpanan sesi.
  }
}

function offlineSession(): Me | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(OFFLINE_SESSION) ?? 'null') as {
      until: number;
      me: Me;
    } | null;
    if (
      stored &&
      stored.until > Date.now() &&
      stored.me.user.id === localStorage.getItem(ACTIVE_ACCOUNT_KEY) &&
      (!stored.me.device?.hasPin || sessionStorage.getItem('rein:unlocked') === '1')
    )
      return stored.me;
  } catch {
    // Sesi offline hanya tersedia di penyimpanan browser yang aktif.
  }
  return null;
}

export async function forgetOfflineSession() {
  try {
    const previous = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    sessionStorage.removeItem(OFFLINE_SESSION);
    sessionStorage.removeItem('rein:unlocked');
    await saveBinding(null);
    if (previous) await caches.delete(privateCache(previous));
  } catch {
    // Logout tetap berlaku bila penyimpanan browser tidak tersedia.
  }
}

export async function flushPendingLogout() {
  let pending: string | null;
  try {
    pending = localStorage.getItem(PENDING_LOGOUT);
  } catch {
    return;
  }
  if (!pending) return;
  if (!navigator.onLine) throw new ApiError(0, 'NETWORK', 'Perangkat sedang offline.');
  try {
    await api('/api/auth/logout', { body: {}, account: pending });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
  }
  if (localStorage.getItem(PENDING_LOGOUT) === pending) localStorage.removeItem(PENDING_LOGOUT);
}

/** Muat user saat ini (cache sampai `invalidateMe`). null = belum login. */
export async function loadMe(force = false): Promise<Me | null> {
  if (session.loaded && !force) return session.me;
  try {
    await flushPendingLogout();
    const me = await api<Me>('/api/auth/me');
    await rememberOfflineSession(me);
    session.me = me;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 0) {
      session.me = offlineSession();
      if (!session.me) throw e;
    } else if (e.status === 401) {
      await forgetOfflineSession();
      session.me = null;
    } else throw e;
  }
  session.loaded = true;
  return session.me;
}

export function invalidateMe(): void {
  session.loaded = false;
}

/** Izin berlaku (scope apa pun) — untuk menampilkan aksi; server tetap memutuskan. */
export function hasAny(permission: PermissionKey): boolean {
  const s = session.me?.permissions[permission];
  return Boolean(s && s !== 'none');
}

/** Hanya untuk menampilkan/menyembunyikan aksi — izin sebenarnya selalu dicek di server. */
export function hasGlobal(permission: PermissionKey): boolean {
  return session.me?.permissions[permission] === 'all';
}

export async function logout(): Promise<void> {
  const account = session.me?.user.id;
  try {
    if (account) localStorage.setItem(PENDING_LOGOUT, account);
  } catch {
    /* Penyimpanan mungkin diblokir. */
  }
  await forgetOfflineSession();
  if (account) await flushPendingLogout().catch(() => {});
  else if (navigator.onLine) await api('/api/auth/logout', { body: {} }).catch(() => {});
  session.me = null;
  session.loaded = true;
}
