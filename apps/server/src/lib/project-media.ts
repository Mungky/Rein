import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attachments, users } from '../db/schema';
import { HttpError } from './http';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Hanya gambar staging milik pengunggah; setelah dipasang, akses mengikuti project. */
export async function claimProjectImage(tx: Tx, userId: string, projectId: string, id: string) {
  const [att] = await tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, id),
        eq(attachments.ownerType, 'user'),
        eq(attachments.ownerId, userId),
        eq(attachments.uploadedBy, userId),
        isNull(attachments.deletedAt),
      ),
    )
    .for('update');
  const avatar = await tx.query.users.findFirst({ where: eq(users.avatarAttachmentId, id) });
  if (!att || avatar || !/^image\/(webp|jpeg|png)$/.test(att.mime)) {
    throw new HttpError(
      422,
      'VALIDATION',
      'Pilih gambar baru milik Anda (JPG, PNG, atau WebP). Foto profil tidak bisa dipakai langsung.',
    );
  }
  await tx
    .update(attachments)
    .set({ ownerType: 'project', ownerId: projectId, category: 'photo' })
    .where(eq(attachments.id, id));
}
