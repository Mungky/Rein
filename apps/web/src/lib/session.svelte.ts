import type { PermissionKey, PermissionMap } from '@rein/shared';
import { api, ApiError } from './api';

export interface Me {
  user: {
    id: string;
    username: string;
    fullName: string;
    roleName: string;
    avatarUrl: string | null;
    email: string | null;
  };
  permissions: PermissionMap;
  verification: { email: boolean };
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

/** Hanya untuk menampilkan/menyembunyikan aksi — izin sebenarnya selalu dicek di server. */
export function hasGlobal(permission: PermissionKey): boolean {
  return session.me?.permissions[permission] === 'all';
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  session.me = null;
  session.loaded = true;
}
