import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv } from '../context';
import { clearSessionCookie } from '../auth/session';
import { attachments, devices, sessions, users } from '../db/schema';
import { isSecureCookie } from '../env';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { nicknameSchema } from '@rein/shared';

/** FR-005: profil & keamanan — foto profil, daftar perangkat, cabut perangkat. */
export const meRoutes = new Hono<AppEnv>()
  .use(requireVerified)
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
      .where(and(eq(devices.userId, a.user.id), isNull(devices.revokedAt)))
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
    const [d] = await db
      .update(devices)
      .set({ revokedAt: now, trustedUntil: now, pinHash: null, updatedAt: now })
      .where(and(eq(devices.id, id), eq(devices.userId, a.user.id), isNull(devices.revokedAt)))
      .returning({ id: devices.id, label: devices.label });
    if (!d) throw notFound('Perangkat tidak ditemukan');
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.deviceId, id), isNull(sessions.revokedAt)));
    await audit(db, {
      actorId: a.user.id,
      action: 'device.revoked',
      entityType: 'device',
      entityId: id,
      diff: { label: d.label },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    if (id === a.device?.id) clearSessionCookie(c, isSecureCookie(env));
    return c.json({ ok: true, signedOut: id === a.device?.id });
  });
