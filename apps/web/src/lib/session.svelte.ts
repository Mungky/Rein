import type { PermissionKey, PermissionMap } from '@rein/shared';
import { api, ApiError } from './api';

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
}

export const session = $state<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

/** Muat user saat ini (cache sampai `invalidateMe`). null = belum login. */
export async function loadMe(force = false): Promise<Me | null> {
  if (session.loaded && !force) return session.me;
  try {
    session.me = await api<Me>('/api/auth/me');
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    session.me = null;
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
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  session.me = null;
  session.loaded = true;
}
