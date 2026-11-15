import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv } from '../context';
import { attachments, users } from '../db/schema';
import { HttpError, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';

/** FR-005 (sebagian, M0): ganti foto profil. Foto dipotong & dikompres 256×256 WebP di klien. */
export const meRoutes = new Hono<AppEnv>().use(requireVerified).post('/avatar', async (c) => {
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
});
