import { can, type PermissionKey, type PolicyResource } from '@rein/shared';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, AuthContext } from '../context';
import { forbidden, HttpError, unauthorized } from '../lib/http';
import { permissionsForUser } from './permissions';
import { IDLE_LOCK_MS, loadSession, lockSession, SESSION_COOKIE, touchSession } from './session';

/** Rute yang tetap bisa dipakai saat sesi terkunci PIN. */
const LOCK_ALLOWED = new Set([
  '/api/auth/me',
  '/api/auth/config',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/pin/unlock',
]);

/** Muat sesi dari cookie (jika ada) ke `c.var.auth`. Tidak menolak request. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('auth', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const { db } = c.var.deps;
    const loaded = await loadSession(db, token);
    if (loaded) {
      const idle = Date.now() - loaded.session.lastSeenAt.getTime() > IDLE_LOCK_MS;
      // Hanya perangkat ber-PIN yang bisa dikunci; PIN dinonaktifkan → kunci lama tidak berlaku.
      const locked = Boolean(loaded.device?.hasPin) && (loaded.session.locked || idle);
      if (locked && !loaded.session.locked) await lockSession(db, loaded.session.id);
      if (!locked) await touchSession(db, loaded.session);
      c.set('auth', {
        user: loaded.user,
        session: loaded.session,
        permissions: await permissionsForUser(db, loaded.user.id, loaded.user.roleId),
        primaryEmail: loaded.primaryEmail,
        emailVerified: loaded.emailVerified,
        whatsapp: loaded.whatsapp,
        whatsappVerified: Boolean(loaded.whatsapp),
        device: loaded.device,
        locked,
      });
      if (locked && !LOCK_ALLOWED.has(c.req.path)) {
        throw new HttpError(423, 'LOCKED', 'Sesi terkunci. Masukkan PIN untuk melanjutkan.');
      }
    }
  }
  const account =
    c.req.header('x-rein-account') ??
    (c.req.path.startsWith('/files/') ? c.req.query('reinAccount') : undefined);
  if (account && c.var.auth?.user.id !== account) throw unauthorized();
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

/**
 * Akun baru wajib memverifikasi WA. Akun lama yang sudah dipakai tetap menerima email
 * terverifikasi agar Admin tidak terkunci sebelum bot disiapkan.
 */
export const isVerified = (a: AuthContext): boolean =>
  a.whatsappVerified || (Boolean(a.user.onboardingCompletedAt) && a.emailVerified);

export const requireVerified: MiddlewareHandler<AppEnv> = async (c, next) => {
  const a = authOf(c);
  if (!isVerified(a)) {
    throw new HttpError(
      403,
      'VERIFICATION_REQUIRED',
      'Verifikasi nomor WhatsApp Anda terlebih dahulu',
    );
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
