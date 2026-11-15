import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Db } from '../db/client';
import { devices, roles, sessions, userContacts, users, type Session } from '../db/schema';
import { randomToken, sha256Hex } from '../lib/crypto';

export const SESSION_COOKIE = 'rein_sid';
export const DEVICE_COOKIE = 'rein_did';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** PRD §5: 30 hari sliding di perangkat trusted, 12 jam di perangkat non-trusted. */
export const TRUSTED_TTL_MS = 30 * DAY;
export const UNTRUSTED_TTL_MS = 12 * HOUR;

export interface NewSession {
  userId: string;
  trusted: boolean;
  deviceRowId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function createSession(db: Db, p: NewSession): Promise<{ token: string; id: string }> {
  const token = randomToken(32);
  const now = Date.now();
  const [row] = await db
    .insert(sessions)
    .values({
      userId: p.userId,
      deviceId: p.deviceRowId ?? null,
      tokenHash: sha256Hex(token),
      trusted: p.trusted,
      expiresAt: new Date(now + (p.trusted ? TRUSTED_TTL_MS : UNTRUSTED_TTL_MS)),
      ip: p.ip ?? null,
      userAgent: p.userAgent ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('Gagal membuat sesi');
  await db
    .update(users)
    .set({ lastActiveAt: new Date(now) })
    .where(eq(users.id, p.userId));
  return { token, id: row.id };
}

export interface LoadedSession {
  session: Session;
  user: {
    id: string;
    username: string;
    fullName: string;
    status: 'invited' | 'active' | 'disabled';
    roleId: string;
    roleName: string;
    avatarAttachmentId: string | null;
  };
  primaryEmail: string | null;
  emailVerified: boolean;
}

/** Sesi sah: belum dicabut, belum kedaluwarsa, dan user masih aktif. */
export async function loadSession(db: Db, token: string): Promise<LoadedSession | null> {
  const rows = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        avatarAttachmentId: users.avatarAttachmentId,
      },
      email: userContacts.value,
      emailVerifiedAt: userContacts.verifiedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(
      userContacts,
      and(
        eq(userContacts.userId, users.id),
        eq(userContacts.kind, 'email'),
        eq(userContacts.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(sessions.tokenHash, sha256Hex(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    session: r.session,
    user: r.user,
    primaryEmail: r.email ?? null,
    emailVerified: r.emailVerifiedAt != null,
  };
}

/** Perbarui last_seen (maks. 1×/menit) dan geser masa berlaku sesi trusted. */
export async function touchSession(db: Db, s: Session): Promise<void> {
  const now = Date.now();
  if (now - s.lastSeenAt.getTime() < MINUTE) return;
  await db
    .update(sessions)
    .set({
      lastSeenAt: new Date(now),
      ...(s.trusted ? { expiresAt: new Date(now + TRUSTED_TTL_MS) } : {}),
    })
    .where(eq(sessions.id, s.id));
  await db
    .update(users)
    .set({ lastActiveAt: new Date(now) })
    .where(eq(users.id, s.userId));
}

export async function revokeSession(db: Db, id: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
}

/** Logout semua: cabut semua sesi dan akhiri status trusted semua perangkat (PRD §5). */
export async function revokeAllSessions(
  db: Db,
  userId: string,
  opts: { untrustDevices?: boolean } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  if (opts.untrustDevices) {
    await db.update(devices).set({ trustedUntil: now }).where(eq(devices.userId, userId));
  }
}

/** Daftarkan/perbarui perangkat. `trusted` → perangkat dipercaya 30 hari (FR-001 AC4). */
export async function registerDevice(
  db: Db,
  userId: string,
  deviceId: string,
  label: string,
  trusted: boolean,
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(devices)
    .values({
      userId,
      deviceId,
      label,
      lastSeenAt: now,
      trustedUntil: trusted ? new Date(now.getTime() + TRUSTED_TTL_MS) : null,
    })
    .onConflictDoUpdate({
      target: [devices.userId, devices.deviceId],
      set: {
        label,
        lastSeenAt: now,
        revokedAt: null,
        ...(trusted ? { trustedUntil: new Date(now.getTime() + TRUSTED_TTL_MS) } : {}),
      },
    })
    .returning({ id: devices.id });
  if (!row) throw new Error('Gagal mendaftarkan perangkat');
  return row.id;
}

/** Label perangkat ringkas dari User-Agent, mis. "Chrome · Android". */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Perangkat tidak dikenal';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'OS lain';
  return `${browser} · ${os}`;
}

export function setSessionCookie(c: Context, token: string, trusted: boolean, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    ...(trusted ? { maxAge: TRUSTED_TTL_MS / 1000 } : {}),
  });
}

export function setDeviceCookie(c: Context, deviceId: string, secure: boolean) {
  setCookie(c, DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 400 * 24 * 3600,
  });
}

export function clearSessionCookie(c: Context, secure: boolean) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
}
