import {
  activateSchema,
  loginSchema,
  safeNextPath,
  tokenOnlySchema,
  verifyEmailCodeSchema,
} from '@rein/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireAuth } from '../auth/middleware';
import { burnVerifyTime, hashSecret, verifySecret } from '../auth/password';
import { passwordProblem } from '../auth/password-policy';
import {
  clearSessionCookie,
  createSession,
  deviceLabel,
  registerDevice,
  revokeAllSessions,
  revokeSession,
  setDeviceCookie,
  setSessionCookie,
} from '../auth/session';
import {
  consumeCode,
  findActivation,
  issueEmailVerification,
  primaryEmailContact,
  tokenInvalid,
  verifyEmailCode,
  verifyEmailToken,
} from '../auth/verification';
import type { AppEnv, AuthContext, Deps } from '../context';
import { userContacts, users } from '../db/schema';
import { googleLoginEnabled, isSecureCookie } from '../env';
import { HttpError, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';

const MINUTE = 60_000;
const ACCOUNT_FAIL_LIMIT = 10;
const ACCOUNT_WINDOW_MS = 15 * MINUTE;
const ACCOUNT_LOCK_MS = 15 * MINUTE;

const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Email/username atau password salah');

const loginBody = loginSchema.extend({ deviceId: z.uuid().optional() });

export function meResponse(a: AuthContext) {
  return {
    user: {
      id: a.user.id,
      username: a.user.username,
      fullName: a.user.fullName,
      roleName: a.user.roleName,
      avatarUrl: a.user.avatarAttachmentId ? `/files/${a.user.avatarAttachmentId}/original` : null,
      email: a.primaryEmail,
    },
    permissions: a.permissions,
    verification: { email: a.emailVerified },
  };
}

/** Cari user dari email (kontak utama/terverifikasi) atau username. */
async function findLoginUser(db: Deps['db'], identifier: string) {
  const id = identifier.trim();
  if (id.includes('@')) {
    const rows = await db
      .select({ user: users })
      .from(userContacts)
      .innerJoin(users, eq(users.id, userContacts.userId))
      .where(
        and(
          eq(userContacts.kind, 'email'),
          eq(userContacts.value, id.toLowerCase()),
          or(eq(userContacts.isPrimary, true), sql`${userContacts.verifiedAt} is not null`),
        ),
      )
      .limit(1);
    return rows[0]?.user ?? null;
  }
  return (await db.query.users.findFirst({ where: eq(users.username, id) })) ?? null;
}

export const authRoutes = new Hono<AppEnv>()
  /** Konfigurasi publik halaman login. */
  .get('/config', (c) => c.json({ googleEnabled: googleLoginEnabled(c.var.deps.env) }))

  /** FR-001: login email/username + password. */
  .post('/login', async (c) => {
    const { db, env, limits } = c.var.deps;
    const ip = c.var.ip;
    const ua = userAgent(c);

    const blockedMs = limits.loginIp.blockedFor(ip);
    if (blockedMs > 0) {
      throw new HttpError(
        429,
        'IP_BLOCKED',
        'Terlalu banyak percobaan masuk dari jaringan ini. Coba lagi dalam 15 menit.',
        undefined,
        { 'Retry-After': String(Math.ceil(blockedMs / 1000)) },
      );
    }

    const body = await readJson(c, loginBody);
    const user = await findLoginUser(db, body.identifier);
    const now = new Date();

    const fail = async (userId: string | null): Promise<never> => {
      limits.loginIp.record(ip);
      await audit(db, {
        actorId: userId,
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: userId,
        diff: { identifier: body.identifier.slice(0, 80) },
        ip,
        userAgent: ua,
      });
      throw invalidCredentials();
    };

    if (!user || user.status !== 'active' || !user.passwordHash) {
      await burnVerifyTime(env.AUTH_PEPPER);
      return fail(user?.id ?? null);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      limits.loginIp.record(ip);
      const secs = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new HttpError(
        429,
        'ACCOUNT_LOCKED',
        'Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.',
        undefined,
        { 'Retry-After': String(secs) },
      );
    }

    if (!(await verifySecret(user.passwordHash, body.password, env.AUTH_PEPPER))) {
      const inWindow =
        user.failedLoginWindowStart !== null &&
        now.getTime() - user.failedLoginWindowStart.getTime() < ACCOUNT_WINDOW_MS;
      const count = (inWindow ? user.failedLoginCount : 0) + 1;
      const lock = count >= ACCOUNT_FAIL_LIMIT;
      await db
        .update(users)
        .set({
          failedLoginCount: lock ? 0 : count,
          failedLoginWindowStart: lock ? null : inWindow ? user.failedLoginWindowStart : now,
          lockedUntil: lock ? new Date(now.getTime() + ACCOUNT_LOCK_MS) : null,
        })
        .where(eq(users.id, user.id));
      if (lock) {
        await audit(db, {
          actorId: user.id,
          action: 'auth.lockout',
          entityType: 'user',
          entityId: user.id,
          ip,
          userAgent: ua,
        });
      }
      return fail(user.id);
    }

    await db
      .update(users)
      .set({ failedLoginCount: 0, failedLoginWindowStart: null, lockedUntil: null })
      .where(eq(users.id, user.id));

    const secure = isSecureCookie(env);
    const deviceRowId = body.deviceId
      ? await registerDevice(db, user.id, body.deviceId, deviceLabel(ua), body.remember)
      : null;
    const { token } = await createSession(db, {
      userId: user.id,
      trusted: body.remember,
      deviceRowId,
      ip,
      userAgent: ua,
    });
    setSessionCookie(c, token, body.remember, secure);
    if (body.deviceId) setDeviceCookie(c, body.deviceId, secure);
    await audit(db, {
      actorId: user.id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      diff: { method: 'password', remember: body.remember },
      ip,
      userAgent: ua,
    });

    const contact = await primaryEmailContact(db, user.id);
    const verified = Boolean(contact?.verifiedAt);
    return c.json({ next: verified ? safeNextPath(body.next) : '/verifikasi' });
  })

  .post('/logout', async (c) => {
    const a = c.var.auth;
    const { db, env } = c.var.deps;
    if (a) {
      await revokeSession(db, a.session.id);
      await audit(db, {
        actorId: a.user.id,
        action: 'auth.logout',
        entityType: 'session',
        entityId: a.session.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    }
    clearSessionCookie(c, isSecureCookie(env));
    return c.json({ ok: true });
  })

  /** Keluar dari semua perangkat (PRD §5). */
  .post('/logout-all', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    await revokeAllSessions(db, a.user.id, { untrustDevices: true });
    await audit(db, {
      actorId: a.user.id,
      action: 'auth.logout_all',
      entityType: 'user',
      entityId: a.user.id,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    clearSessionCookie(c, isSecureCookie(env));
    return c.json({ ok: true });
  })

  .get('/me', requireAuth, (c) => c.json(meResponse(authOf(c))))

  /** FR-002: data undangan untuk halaman aktivasi (tautan bekas/kedaluwarsa → 410). */
  .post('/activation/inspect', async (c) => {
    const { db } = c.var.deps;
    const { token } = await readJson(c, tokenOnlySchema);
    const act = await findActivation(db, token);
    const user = await db.query.users.findFirst({ where: eq(users.id, act.userId) });
    if (!user || user.status !== 'invited') throw tokenInvalid();
    const contact = await primaryEmailContact(db, act.userId);
    return c.json({
      fullName: user.fullName,
      username: user.username,
      email: contact?.value ?? null,
    });
  })

  /** FR-002: set password → akun aktif → sesi baru → alur verifikasi email. */
  .post('/activation/complete', async (c) => {
    const { db, env, mail, limits } = c.var.deps;
    const body = await readJson(c, activateSchema);
    const act = await findActivation(db, body.token);
    const user = await db.query.users.findFirst({ where: eq(users.id, act.userId) });
    if (!user || user.status !== 'invited') throw tokenInvalid();
    const contact = await primaryEmailContact(db, user.id);
    const problem = passwordProblem(body.password, {
      username: user.username,
      email: contact?.value ?? null,
    });
    if (problem) throw new HttpError(422, 'VALIDATION', problem, { password: problem });

    const passwordHash = await hashSecret(body.password, env.AUTH_PEPPER);
    await db
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date(), status: 'active' })
      .where(eq(users.id, user.id));
    await consumeCode(db, act.codeId);

    const ip = c.var.ip;
    const ua = userAgent(c);
    const { token } = await createSession(db, {
      userId: user.id,
      trusted: false,
      ip,
      userAgent: ua,
    });
    setSessionCookie(c, token, false, isSecureCookie(env));
    await audit(db, {
      actorId: user.id,
      action: 'user.activated',
      entityType: 'user',
      entityId: user.id,
      ip,
      userAgent: ua,
    });

    let mailSent = false;
    if (contact && !contact.verifiedAt) {
      limits.emailSend.take(user.id);
      ({ sent: mailSent } = await issueEmailVerification(
        { db, env, mail },
        { userId: user.id, contactId: contact.id, email: contact.value, name: user.fullName },
      ));
    }
    return c.json({ next: contact?.verifiedAt ? '/' : '/verifikasi', mailSent });
  })

  /** Kirim ulang kode verifikasi email (5/jam per user). */
  .post('/verify-email/resend', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env, mail, limits } = c.var.deps;
    if (a.emailVerified) return c.json({ ok: true, alreadyVerified: true });
    if (!limits.emailSend.take(a.user.id)) {
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Batas kirim ulang tercapai (5 per jam). Coba lagi nanti.',
      );
    }
    const contact = await primaryEmailContact(db, a.user.id);
    if (!contact) {
      throw new HttpError(409, 'NO_EMAIL', 'Akun ini belum punya email. Hubungi Admin.');
    }
    const { sent } = await issueEmailVerification(
      { db, env, mail },
      { userId: a.user.id, contactId: contact.id, email: contact.value, name: a.user.fullName },
    );
    if (!sent) {
      throw new HttpError(502, 'MAIL_FAILED', 'Email gagal dikirim. Coba lagi sebentar lagi.');
    }
    return c.json({ ok: true });
  })

  .post('/verify-email/code', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const { code } = await readJson(c, verifyEmailCodeSchema);
    const { contactId } = await verifyEmailCode(db, env, a.user.id, code);
    await audit(db, {
      actorId: a.user.id,
      action: 'contact.verified',
      entityType: 'user_contact',
      entityId: contactId,
      diff: { kind: 'email', method: 'code' },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  /** Magic link — tidak butuh sesi (token adalah buktinya). */
  .post('/verify-email/token', async (c) => {
    const { db } = c.var.deps;
    const { token } = await readJson(c, tokenOnlySchema);
    const { userId, contactId } = await verifyEmailToken(db, token);
    await audit(db, {
      actorId: userId,
      action: 'contact.verified',
      entityType: 'user_contact',
      entityId: contactId,
      diff: { kind: 'email', method: 'link' },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true, signedIn: c.var.auth?.user.id === userId });
  });
