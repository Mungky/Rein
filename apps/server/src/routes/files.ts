import { Readable } from 'node:stream';
import { ATTACHMENT_VARIANTS, type AttachmentVariant } from '@rein/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv } from '../context';
import { attachments, type Attachment } from '../db/schema';
import { forbidden, notFound } from '../lib/http';
import { userAgent } from '../lib/ip';
import { contentDisposition } from '../storage/driver';

function keyFor(a: Attachment, v: AttachmentVariant): string {
  if (v === 'thumb') return a.thumbKey ?? a.displayKey ?? a.storageKey;
  if (v === 'display') return a.displayKey ?? a.storageKey;
  return a.storageKey;
}

/** Varian display/thumb selalu WebP buatan klien; original memakai MIME asli. */
function mimeFor(a: Attachment, v: AttachmentVariant): string {
  if (v === 'thumb' && a.thumbKey) return 'image/webp';
  if (v === 'display' && a.displayKey) return 'image/webp';
  return a.mime;
}

const INLINE = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/**
 * GET /files/:id/:variant (PRD §7): cek izin di server → 302 ke Signed URL GCS (berlaku sampai
 * akhir hari WIB) atau stream lokal. File tidak pernah publik.
 */
export const fileRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .get('/:id/:variant', async (c) => {
    const a = authOf(c);
    const { db, storage } = c.var.deps;
    const variant = c.req.param('variant') as AttachmentVariant;
    if (!(ATTACHMENT_VARIANTS as readonly string[]).includes(variant)) throw notFound();
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();

    const att = await db.query.attachments.findFirst({
      where: and(eq(attachments.id, id), isNull(attachments.deletedAt)),
    });
    if (!att) throw notFound('Lampiran tidak ditemukan');

    // M0: foto profil boleh dilihat semua user aktif; jenis lain hanya pengunggah.
    // M1: lampiran project/WO/logbook dicek lewat can(user, 'project.view', project).
    if (att.ownerType !== 'user' && att.uploadedBy !== a.user.id) throw forbidden();

    if (att.category === 'bast' || att.category === 'contract') {
      await audit(db, {
        actorId: a.user.id,
        action: 'attachment.downloaded',
        entityType: 'attachment',
        entityId: att.id,
        diff: { category: att.category, variant },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    }

    const mime = mimeFor(att, variant);
    const inline = INLINE.test(mime);
    const signed = await storage.signedReadUrl(keyFor(att, variant), {
      fileName: att.fileName,
      contentType: mime,
      inline,
    });
    if (signed) {
      const maxAge = Math.max(0, Math.floor((signed.expiresAt.getTime() - Date.now()) / 1000) - 60);
      c.header('Cache-Control', `private, max-age=${maxAge}`);
      return c.redirect(signed.url, 302);
    }

    const etag = `"${att.sha256.slice(0, 32)}-${variant}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    const stream = await storage.read(keyFor(att, variant)).catch(() => null);
    if (!stream) throw notFound('Objek lampiran tidak ditemukan');
    return c.body(Readable.toWeb(stream) as unknown as ReadableStream, 200, {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=86400',
      ETag: etag,
      'Content-Disposition': contentDisposition(att.fileName, inline),
    });
  });
