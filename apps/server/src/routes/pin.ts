/**
 * FR-004 PIN & fast login (PRD §5 "Kunci sesi" & "Device binding").
 *  POST /api/auth/pin/setup   — buat/ganti PIN perangkat ini (6 digit, dua kali input).
 *  POST /api/auth/pin/unlock  — buka sesi terkunci; 5× salah → PIN perangkat dinonaktifkan,
 *                               sesi dicabut, user wajib login password lalu membuat PIN baru.
 *  POST /api/auth/pin/lock    — kunci sesi (aplikasi dibuka ulang & sessionStorage kosong).
 * PIN terikat perangkat: hash argon2id per baris `devices`, dan cookie `rein_did` harus cocok
 * dengan perangkat sesi.
 */
import { pinSetupSchema, pinUnlockSchema } from '@rein/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { audit } from '../audit';
import { authOf, requireAuth, requireVerified } from '../auth/middleware';
import { hashSecret, verifySecret } from '../auth/password';
import {
  clearSessionCookie,
  DEVICE_COOKIE,
  lockSession,
  revokeSession,
  unlockSession,
} from '../auth/session';
import type { AppEnv, AuthContext } from '../context';
import { devices } from '../db/schema';
import { isSecureCookie } from '../env';
import { safeEqual } from '../lib/crypto';
import { HttpError, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';

export const PIN_MAX_FAILS = 5;

/** Perangkat sesi + cookie `rein_did` yang cocok, atau error. */
function boundDevice(c: Parameters<typeof getCookie>[0], a: AuthContext) {
  const cookie = getCookie(c, DEVICE_COOKIE) ?? '';
  if (!a.device || !safeEqual(cookie, a.device.deviceId)) {
    throw new HttpError(
      409,
      'DEVICE_REQUIRED',
      'PIN hanya bisa dipakai di perangkat terdaftar. Masuk ulang dengan "Ingat perangkat ini".',
    );
  }
  return a.device;
}

export const pinRoutes = new Hono<AppEnv>()
  .post('/setup', requireVerified, async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const device = boundDevice(c, a);
    const { pin } = await readJson(c, pinSetupSchema);
    await db
      .update(devices)
      .set({
        pinHash: await hashSecret(pin, env.AUTH_PEPPER),
        pinFailedCount: 0,
        pinDisabledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id));
    await audit(db, {
      actorId: a.user.id,
      action: device.hasPin ? 'auth.pin.changed' : 'auth.pin.created',
      entityType: 'device',
      entityId: device.id,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  .post('/lock', requireAuth, async (c) => {
    const a = authOf(c);
    if (!a.device?.hasPin) return c.json({ locked: false });
    await lockSession(c.var.deps.db, a.session.id);
    return c.json({ locked: true });
  })

  .post('/unlock', requireAuth, async (c) => {
    const a = authOf(c);
    const { db, env, limits } = c.var.deps;
    if (!a.locked) return c.json({ ok: true });
    const device = boundDevice(c, a);
    if (!limits.pinUnlock.take(a.session.id)) {
      throw new HttpError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi nanti.');
    }
    const { pin } = await readJson(c, pinUnlockSchema);
    const row = await db.query.devices.findFirst({ where: eq(devices.id, device.id) });

    if (
      row?.pinHash &&
      !row.pinDisabledAt &&
      (await verifySecret(row.pinHash, pin, env.AUTH_PEPPER))
    ) {
      await db
        .update(devices)
        .set({ pinFailedCount: 0, lastSeenAt: new Date() })
        .where(eq(devices.id, device.id));
      await unlockSession(db, a.session);
      await audit(db, {
        actorId: a.user.id,
        action: 'auth.pin.unlock',
        entityType: 'device',
        entityId: device.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return c.json({ ok: true });
    }

    const [updated] = await db
      .update(devices)
      .set({ pinFailedCount: sql`${devices.pinFailedCount} + 1` })
      .where(eq(devices.id, device.id))
      .returning({ fails: devices.pinFailedCount });
    const fails = updated?.fails ?? PIN_MAX_FAILS;
    if (fails >= PIN_MAX_FAILS) {
      // FR-004 AC4: nonaktifkan PIN perangkat ini dan paksa login password.
      await db
        .update(devices)
        .set({ pinDisabledAt: new Date(), pinHash: null, pinFailedCount: 0 })
        .where(eq(devices.id, device.id));
      await revokeSession(db, a.session.id);
      clearSessionCookie(c, isSecureCookie(env));
      await audit(db, {
        actorId: a.user.id,
        action: 'auth.pin.disabled',
        entityType: 'device',
        entityId: device.id,
        diff: { reason: 'too_many_failures' },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      throw new HttpError(
        401,
        'PIN_DISABLED',
        'PIN salah 5 kali. Masuk dengan password, lalu buat PIN baru.',
      );
    }
    const left = PIN_MAX_FAILS - fails;
    throw new HttpError(422, 'PIN_INVALID', `PIN salah. Sisa ${left} percobaan.`, {
      pin: 'PIN salah',
    });
  });
