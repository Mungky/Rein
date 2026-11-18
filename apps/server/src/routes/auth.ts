import {
  activateSchema,
  loginSchema,
  passwordSchema,
  safeNextPath,
  tokenOnlySchema,
  verifyEmailCodeSchema,
  whatsappStartSchema,
  whatsappVerifySchema,
  nicknameSchema,
} from '@rein/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, isVerified, requireAuth, requireVerified } from '../auth/middleware';
import { issueWhatsAppVerification, verifyWhatsAppCode } from '../auth/wa-verification';
import { burnVerifyTime, hashSecret, verifySecret } from '../auth/password';
import { passwordProblem } from '../auth/password-policy';
import { issuePasswordReset, resetPassword } from '../auth/password-reset';
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
  issueActivation,
  issueEmailVerification,
  primaryEmailContact,
  verificationEmailContact,
  tokenInvalid,
  verifyEmailCode,
  verifyEmailToken,
} from '../auth/verification';
import type { AppEnv, AuthContext, Deps } from '../context';
import { sessions, userContacts, users, verificationCodes } from '../db/schema';
import { googleLoginEnabled, isSecureCookie } from '../env';
import { sha256Hex } from '../lib/crypto';
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
      nickname: a.user.nickname,
      roleName: a.user.roleName,
      avatarUrl: a.user.avatarAttachmentId ? `/files/${a.user.avatarAttachmentId}/original` : null,
      email: a.primaryEmail,
      whatsapp: a.whatsapp,
    },
    permissions: a.permissions,
    verification: { email: a.emailVerified, whatsapp: a.whatsappVerified, any: isVerified(a) },
    device: a.device ? { hasPin: a.device.hasPin, trusted: a.session.trusted } : null,
    onboardingNext: a.user.onboardingCompletedAt
      ? null
      : !a.whatsappVerified
        ? '/verifikasi'
        : !a.device?.hasPin && !a.user.pinSetupSkippedAt
          ? '/pin'
          : '/sambutan',
    locked: a.locked,
    /** Klien mengunci saat aplikasi dibuka ulang (sessionStorage kosong) — kecuali sesi baru. */
    sessionStartedAt: a.session.createdAt,
    sessionExpiresAt: a.session.expiresAt,
  };
}

/** Akun baru wajib WA; akun lama yang sudah selesai boleh memakai kontak terverifikasi. */
async function hasVerifiedContact(db: Deps['db'], userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const row = await db.query.userContacts.findFirst({
    where: and(
      eq(userContacts.userId, userId),
      sql`${userContacts.verifiedAt} is not null`,
      user?.onboardingCompletedAt ? undefined : eq(userContacts.kind, 'whatsapp'),
    ),
  });
  return Boolean(row);
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
  .get('/config', (c) =>
    c.json({
      googleEnabled: googleLoginEnabled(c.var.deps.env),
      // D1: email ditunda → halaman verifikasi menyembunyikan opsi kode email.
      mailEnabled: c.var.deps.mail.name !== 'null',
    }),
  )
  .post('/forgot-password', async (c) => {
    const { db, limits } = c.var.deps;
    const { identifier } = await readJson(c, loginSchema.pick({ identifier: true }));
    if (limits.emailSend.take(`reset:ip:${c.var.ip}`)) {
      const user = await findLoginUser(db, identifier);
      if (user?.status === 'active' && limits.emailSend.take(`reset:user:${user.id}`)) {
        await issuePasswordReset(c.var.deps, user.id, {
          actorId: null,
          ip: c.var.ip,
          userAgent: userAgent(c),
        });
      }
    }
    return c.json({ ok: true });
  })
  .post('/reset-password', async (c) => {
    const { token, password } = await readJson(
      c,
      tokenOnlySchema.extend({ password: passwordSchema }),
    );
    await resetPassword(c.var.deps, token, password, {
      actorId: null,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    clearSessionCookie(c, isSecureCookie(c.var.deps.env));
    return c.json({ ok: true });
  })

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

    const secure = isSecureCookie(env);
    const { token } = await db.transaction(async (tx) => {
      const [confirmed] = await tx
        .update(users)
        .set({ failedLoginCount: 0, failedLoginWindowStart: null, lockedUntil: null })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.status, 'active'),
            eq(users.passwordHash, user.passwordHash!),
          ),
        )
        .returning({ id: users.id });
      if (!confirmed) throw invalidCredentials();
      const deviceRowId = body.deviceId
        ? await registerDevice(tx, user.id, body.deviceId, deviceLabel(ua), body.remember)
        : null;
      return createSession(tx, {
        userId: user.id,
        trusted: body.remember,
        deviceRowId,
        ip,
        userAgent: ua,
      });
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

    const verified = await hasVerifiedContact(db, user.id);
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

  /**
   * FR-002 AC: "Minta tautan baru" dari tautan bekas/kedaluwarsa. Token lama (milik pemegang
   * email) mengidentifikasi user; respons selalu sama agar tidak membocorkan status akun.
   */
  .post('/activation/request', async (c) => {
    const { db, env, mail, limits } = c.var.deps;
    const { token } = await readJson(c, tokenOnlySchema);
    const old = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.tokenHash, sha256Hex(token)),
        eq(verificationCodes.purpose, 'activate'),
      ),
    });
    const user = old ? await db.query.users.findFirst({ where: eq(users.id, old.userId) }) : null;
    const contact = user ? await primaryEmailContact(db, user.id) : null;
    if (user && contact && user.status === 'invited' && limits.emailSend.take(`act:${user.id}`)) {
      await issueActivation(
        { db, env, mail },
        {
          userId: user.id,
          contactId: contact.id,
          email: contact.value,
          name: user.fullName,
          username: user.username,
          inviterName: 'Admin REIN',
        },
      );
      await audit(db, {
        actorId: user.id,
        action: 'user.invite_requested',
        entityType: 'user',
        entityId: user.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    }
    return c.json({ ok: true });
  })

  /** Aktivasi undangan → verifikasi WhatsApp; email dikonfigurasi setelah masuk. */
  .post('/activation/complete', async (c) => {
    const { db, env } = c.var.deps;
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

    const verified = await hasVerifiedContact(db, act.userId);
    return c.json({ next: verified ? '/' : '/verifikasi', mailSent: false });
  })

  /** Kirim ulang kode verifikasi email (5/jam per user). */
  .post('/verify-email/resend', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env, mail, limits } = c.var.deps;
    const contact = await verificationEmailContact(db, a.user.id);
    if (contact?.verifiedAt) return c.json({ ok: true, alreadyVerified: true });
    if (!limits.emailSend.take(a.user.id)) {
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Batas kirim ulang tercapai (5 per jam). Coba lagi nanti.',
      );
    }
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
  })

  /** Pulihkan tantangan OTP saat halaman dimuat ulang. */
  .get('/verify-whatsapp', requireAuth, async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const pending = await db.query.userContacts.findFirst({
      where: and(
        eq(userContacts.userId, a.user.id),
        eq(userContacts.kind, 'whatsapp'),
        sql`${userContacts.verifiedAt} is null`,
      ),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    const challenge = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.userId, a.user.id),
        eq(verificationCodes.purpose, 'verify_whatsapp'),
        sql`${verificationCodes.consumedAt} is null and ${verificationCodes.expiresAt} > now() and ${verificationCodes.attempts} < 5`,
      ),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    const challengeContact = challenge?.contactId
      ? await db.query.userContacts.findFirst({ where: eq(userContacts.id, challenge.contactId) })
      : null;
    return c.json({
      verified: a.whatsappVerified,
      phone: a.whatsapp,
      pendingPhone: pending?.value ?? null,
      challenge:
        challenge && challengeContact
          ? {
              challengeId: challenge.id,
              phone: challengeContact.value,
              expiresAt: challenge.expiresAt,
              resendAt: new Date(challenge.createdAt.getTime() + 60_000),
            }
          : null,
    });
  })

  /** Bot mengirim OTP ke nomor pengguna. */
  .post('/verify-whatsapp/start', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env, limits, wa } = c.var.deps;
    const { phone } = await readJson(c, whatsappStartSchema);
    const phoneKey = `phone:${phone}`;
    const userKey = `user:${a.user.id}`;
    if (!limits.waStart.take(userKey) || !limits.waStart.take(phoneKey)) {
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi.',
        undefined,
        {
          'Retry-After': String(
            Math.max(
              1,
              Math.ceil(
                Math.max(limits.waStart.blockedFor(userKey), limits.waStart.blockedFor(phoneKey)) /
                  1000,
              ),
            ),
          ),
        },
      );
    }
    const r = await issueWhatsAppVerification(db, env, wa, a.user.id, phone);
    await audit(db, {
      actorId: a.user.id,
      action: 'contact.whatsapp_code_issued',
      entityType: 'user_contact',
      entityId: r.contactId,
      diff: { phone: r.phone },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({
      phone: r.phone,
      challengeId: r.challengeId,
      expiresAt: r.expiresAt.toISOString(),
      resendAt: r.resendAt.toISOString(),
    });
  })
  .post('/verify-whatsapp/code', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const body = await readJson(c, whatsappVerifySchema);
    const result = await verifyWhatsAppCode(db, env, a.user.id, body.challengeId, body.code);
    if (!a.device && body.deviceId) {
      const deviceRowId = await registerDevice(
        db,
        a.user.id,
        body.deviceId,
        deviceLabel(userAgent(c)),
        a.session.trusted,
      );
      await db.update(sessions).set({ deviceId: deviceRowId }).where(eq(sessions.id, a.session.id));
      setDeviceCookie(c, body.deviceId, isSecureCookie(env));
    }
    await audit(db, {
      actorId: a.user.id,
      action: 'contact.whatsapp_verified',
      entityType: 'user_contact',
      entityId: result.contactId,
      diff: { method: 'otp' },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })
  .post('/onboarding/complete', requireVerified, async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { nickname } = await readJson(c, nicknameSchema);
    if (
      !a.user.onboardingCompletedAt &&
      (!a.whatsappVerified || (!a.device?.hasPin && !a.user.pinSetupSkippedAt))
    ) {
      throw new HttpError(
        409,
        'ONBOARDING_REQUIRED',
        'Selesaikan verifikasi WhatsApp dan pilihan PIN dahulu.',
      );
    }
    await db
      .update(users)
      .set({ nickname, onboardingCompletedAt: a.user.onboardingCompletedAt ?? new Date() })
      .where(eq(users.id, a.user.id));
    await audit(db, {
      actorId: a.user.id,
      action: 'user.onboarding_completed',
      entityType: 'user',
      entityId: a.user.id,
      diff: { nickname },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  });
