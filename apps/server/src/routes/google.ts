import { safeNextPath } from '@rein/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { audit } from '../audit';
import { generateCodeVerifier, generateState } from '../auth/google';
import {
  createSession,
  deviceLabel,
  registerDevice,
  setDeviceCookie,
  setSessionCookie,
} from '../auth/session';
import type { AppEnv } from '../context';
import { userContacts, users, verificationCodes } from '../db/schema';
import { isSecureCookie } from '../env';
import { safeEqual } from '../lib/crypto';
import { userAgent } from '../lib/ip';

const FLOW_COOKIE = 'rein_g';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Flow {
  state: string;
  verifier: string;
  next: string;
  remember: boolean;
  /** device_id klien (FR-006 AC3: aturan perangkat & PIN sama dengan login password). */
  deviceId?: string;
}

function parseFlow(raw: string | undefined): Flow | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString()) as Flow;
  } catch {
    return null;
  }
}

/**
 * FR-006 — Masuk dengan Google (OIDC Authorization Code + PKCE).
 * Hanya akun yang sudah terdaftar; tidak ada pendaftaran mandiri.
 */
export const googleRoutes = new Hono<AppEnv>()
  .get('/start', (c) => {
    const { google, env } = c.var.deps;
    if (!google) return c.redirect(`${env.APP_URL}/masuk?error=google_disabled`);
    const state = generateState();
    const verifier = generateCodeVerifier();
    const flow: Flow = {
      state,
      verifier,
      next: safeNextPath(c.req.query('next')),
      remember: c.req.query('remember') === '1',
      ...(UUID.test(c.req.query('device') ?? '') ? { deviceId: c.req.query('device')! } : {}),
    };
    setCookie(c, FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), {
      httpOnly: true,
      secure: isSecureCookie(env),
      sameSite: 'Lax',
      path: '/auth/google',
      maxAge: 600,
    });
    return c.redirect(google.authorizationUrl(state, verifier).toString());
  })

  .get('/callback', async (c) => {
    const { google, env, db, logger } = c.var.deps;
    const back = (error: string) => c.redirect(`${env.APP_URL}/masuk?error=${error}`);
    if (!google) return back('google_disabled');

    const raw = getCookie(c, FLOW_COOKIE);
    deleteCookie(c, FLOW_COOKIE, { path: '/auth/google' });
    const flow = parseFlow(raw);
    const state = c.req.query('state') ?? '';
    const code = c.req.query('code');
    if (!flow || !code || !safeEqual(flow.state, state)) return back('google_state');

    let claims;
    try {
      claims = await google.exchange(code, flow.verifier);
    } catch (err) {
      logger.warn({ err }, 'Google OIDC exchange gagal');
      return back('google_failed');
    }
    if (!claims.emailVerified) return back('google_unverified');

    // Cocokkan google_sub dulu, lalu email kontak yang aktif (utama atau terverifikasi).
    let user = await db.query.users.findFirst({ where: eq(users.googleSub, claims.sub) });
    let contactId: string | null = null;
    if (!user) {
      const rows = await db
        .select({ user: users, contactId: userContacts.id })
        .from(userContacts)
        .innerJoin(users, eq(users.id, userContacts.userId))
        .where(
          and(
            eq(userContacts.kind, 'email'),
            eq(userContacts.value, claims.email),
            or(eq(userContacts.isPrimary, true), sql`${userContacts.verifiedAt} is not null`),
          ),
        )
        .limit(1);
      user = rows[0]?.user;
      contactId = rows[0]?.contactId ?? null;
    } else {
      const contact = await db.query.userContacts.findFirst({
        where: and(
          eq(userContacts.userId, user.id),
          eq(userContacts.kind, 'email'),
          eq(userContacts.value, claims.email),
        ),
      });
      contactId = contact?.id ?? null;
    }

    const ip = c.var.ip;
    const ua = userAgent(c);
    if (!user) {
      await audit(db, {
        action: 'auth.google.unregistered',
        entityType: 'user',
        diff: { email: claims.email },
        ip,
        userAgent: ua,
      });
      return back('google_unregistered');
    }
    if (user.status === 'disabled') return back('google_disabled_account');
    if (user.googleSub && user.googleSub !== claims.sub) return back('google_mismatch');

    const now = new Date();
    await db.transaction(async (tx) => {
      // AC2: login Google pertama menautkan google_sub dan menandai email terverifikasi.
      await tx
        .update(users)
        .set({
          googleSub: claims.sub,
          ...(user.status === 'invited' ? { status: 'active' as const } : {}),
        })
        .where(eq(users.id, user.id));
      if (contactId) {
        await tx
          .update(userContacts)
          .set({ verifiedAt: now, pending: false })
          .where(and(eq(userContacts.id, contactId), sql`${userContacts.verifiedAt} is null`));
      }
      if (user.status === 'invited') {
        // Undangan yang belum dipakai tidak berlaku lagi setelah akun aktif lewat Google.
        await tx
          .update(verificationCodes)
          .set({ consumedAt: now })
          .where(
            and(
              eq(verificationCodes.userId, user.id),
              eq(verificationCodes.purpose, 'activate'),
              sql`${verificationCodes.consumedAt} is null`,
            ),
          );
      }
    });

    const deviceRowId = flow.deviceId
      ? await registerDevice(db, user.id, flow.deviceId, deviceLabel(ua), flow.remember)
      : null;
    const { token } = await createSession(db, {
      userId: user.id,
      trusted: flow.remember,
      deviceRowId,
      ip,
      userAgent: ua,
    });
    setSessionCookie(c, token, flow.remember, isSecureCookie(env));
    if (flow.deviceId) setDeviceCookie(c, flow.deviceId, isSecureCookie(env));
    await audit(db, {
      actorId: user.id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      diff: { method: 'google', linked: !user.googleSub },
      ip,
      userAgent: ua,
    });
    return c.redirect(`${env.APP_URL}${flow.next}`);
  });
