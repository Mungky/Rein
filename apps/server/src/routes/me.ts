import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv } from '../context';
import { clearSessionCookie, revokeAllSessions } from '../auth/session';
import { hashSecret, verifySecret } from '../auth/password';
import { passwordProblem } from '../auth/password-policy';
import { expireOutstanding } from '../auth/verification';
import { attachments, devices, sessions, users } from '../db/schema';
import { isSecureCookie } from '../env';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { nicknameSchema, passwordSchema } from '@rein/shared';

/** FR-005: profil & keamanan — foto profil, daftar perangkat, cabut perangkat. */
export const meRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .post('/password', async (c) => {
    const a = authOf(c);
    const { db, env, limits } = c.var.deps;
    const { currentPassword, password } = await readJson(
      c,
      z.object({
        currentPassword: z.string().min(1, 'Password lama wajib diisi').max(200),
        password: passwordSchema,
      }),
    );
    if (limits.loginIp.blockedFor(`password:${a.user.id}`))
      throw new HttpError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi nanti.');
    const user = await db.query.users.findFirst({ where: eq(users.id, a.user.id) });
    if (
      !user?.passwordHash ||
      !(await verifySecret(user.passwordHash, currentPassword, env.AUTH_PEPPER))
    ) {
      limits.loginIp.record(`password:${a.user.id}`);
      throw new HttpError(422, 'VALIDATION', 'Password lama salah', {
        currentPassword: 'Password lama salah',
      });
    }
    const problem = passwordProblem(password, { username: user.username, email: a.primaryEmail });
    if (problem) throw new HttpError(422, 'VALIDATION', problem, { password: problem });
    const passwordHash = await hashSecret(password, env.AUTH_PEPPER);
    await db.transaction(async (tx) => {
      const [changed] = await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.status, 'active'),
            eq(users.passwordHash, user.passwordHash!),
          ),
        )
        .returning({ id: users.id });
      if (!changed) throw new HttpError(409, 'STALE', 'Password sudah berubah. Masuk ulang.');
      await expireOutstanding(tx, user.id, 'reset_password');
      await revokeAllSessions(tx, user.id);
      await audit(tx, {
        actorId: user.id,
        action: 'auth.password.changed',
        entityType: 'user',
        entityId: user.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    limits.loginIp.reset(`password:${a.user.id}`);
    clearSessionCookie(c, isSecureCookie(env));
    return c.json({ ok: true });
  })
  .post('/nickname', async (c) => {
    const a = authOf(c);
    const { nickname } = await readJson(c, nicknameSchema);
    await c.var.deps.db.update(users).set({ nickname }).where(eq(users.id, a.user.id));
    await audit(c.var.deps.db, {
      actorId: a.user.id,
      action: 'user.nickname_changed',
      entityType: 'user',
      entityId: a.user.id,
      diff: { nickname },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })
  /** Foto dipotong & dikompres 256×256 WebP di klien. */
  .post('/avatar', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { attachmentId } = await readJson(c, z.object({ attachmentId: z.uuid() }));
    const att = await db.query.attachments.findFirst({
      where: and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)),
    });
    if (!att || att.ownerType !== 'user' || att.ownerId !== a.user.id) {
      throw new HttpError(422, 'VALIDATION', 'Foto tidak valid', {
        attachmentId: 'Foto tidak valid',
      });
    }
    if (!/^image\/(webp|jpeg|png)$/.test(att.mime)) {
      throw new HttpError(422, 'VALIDATION', 'Foto profil harus berupa gambar');
    }
    const previous = a.user.avatarAttachmentId;
    await db.transaction(async (tx) => {
      await tx.update(users).set({ avatarAttachmentId: att.id }).where(eq(users.id, a.user.id));
      // Foto lama dihapus saat diganti (soft delete; objek dibersihkan job harian setelah 30 hari).
      if (previous && previous !== att.id) {
        await tx
          .update(attachments)
          .set({ deletedAt: new Date() })
          .where(eq(attachments.id, previous));
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'user.avatar_changed',
        entityType: 'user',
        entityId: a.user.id,
        diff: { from: previous, to: att.id },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ avatarUrl: `/files/${att.id}/original` });
  })

  .get('/devices', async (c) => {
    const a = authOf(c);
    const rows = await c.var.deps.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, a.user.id),
          isNull(devices.revokedAt),
          gt(devices.trustedUntil, sql`now()`),
        ),
      )
      .orderBy(desc(devices.lastSeenAt));
    const now = Date.now();
    return c.json({
      devices: rows.map((d) => ({
        id: d.id,
        label: d.label,
        lastSeenAt: d.lastSeenAt,
        trusted: Boolean(d.trustedUntil && d.trustedUntil.getTime() > now),
        hasPin: Boolean(d.pinHash) && !d.pinDisabledAt,
        current: d.id === a.device?.id,
      })),
    });
  })

  /** Cabut satu perangkat: akhiri trusted, hapus PIN, cabut semua sesinya. */
  .delete('/devices/:id', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const id = c.req.param('id');
    const now = new Date();
    if (!z.uuid().safeParse(id).success) throw notFound('Perangkat tidak ditemukan');
    await db.transaction(async (tx) => {
      const [d] = await tx
        .update(devices)
        .set({ revokedAt: now, trustedUntil: now, pinHash: null, updatedAt: now })
        .where(and(eq(devices.id, id), eq(devices.userId, a.user.id), isNull(devices.revokedAt)))
        .returning({ label: devices.label });
      if (!d) throw notFound('Perangkat tidak ditemukan');
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.deviceId, id), isNull(sessions.revokedAt)));
      await audit(tx, {
        actorId: a.user.id,
        action: 'device.revoked',
        entityType: 'device',
        entityId: id,
        diff: { label: d.label },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    if (id === a.device?.id) clearSessionCookie(c, isSecureCookie(env));
    return c.json({ ok: true, signedOut: id === a.device?.id });
  });
