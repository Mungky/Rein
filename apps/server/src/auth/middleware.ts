import { can, type PermissionKey, type PolicyResource } from '@rein/shared';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, AuthContext } from '../context';
import { forbidden, HttpError, unauthorized } from '../lib/http';
import { permissionsForRole } from './permissions';
import { loadSession, SESSION_COOKIE, touchSession } from './session';

/** Muat sesi dari cookie (jika ada) ke `c.var.auth`. Tidak menolak request. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('auth', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const { db } = c.var.deps;
    const loaded = await loadSession(db, token);
    if (loaded) {
      await touchSession(db, loaded.session);
      c.set('auth', {
        user: loaded.user,
        session: loaded.session,
        permissions: await permissionsForRole(db, loaded.user.roleId),
        primaryEmail: loaded.primaryEmail,
        emailVerified: loaded.emailVerified,
      });
    }
  }
  await next();
};

export function authOf(c: { var: AppEnv['Variables'] }): AuthContext {
  const a = c.var.auth;
  if (!a) throw unauthorized();
  return a;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  authOf(c);
  await next();
};

/** FR-003 AC4: user yang belum memverifikasi email hanya boleh membuka alur verifikasi. */
export const requireVerified: MiddlewareHandler<AppEnv> = async (c, next) => {
  const a = authOf(c);
  if (!a.emailVerified) {
    throw new HttpError(403, 'VERIFICATION_REQUIRED', 'Verifikasi email Anda terlebih dahulu');
  }
  await next();
};

/** Cek izin di server lewat can() (PRD §2.2). Tanpa resource → hanya scope `all`. */
export function requirePermission(
  permission: PermissionKey,
  resource?: PolicyResource,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const a = authOf(c);
    const subject = { id: a.user.id, status: a.user.status, permissions: a.permissions };
    if (!can(subject, permission, resource)) throw forbidden();
    await next();
  };
}
