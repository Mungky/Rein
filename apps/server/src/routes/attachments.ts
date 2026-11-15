import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { ATTACHMENT_CATEGORIES, ATTACHMENT_OWNER_TYPES } from '@rein/shared';
import Busboy from 'busboy';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv, AuthContext, Deps } from '../context';
import { attachments } from '../db/schema';
import { forbidden, HttpError, validate } from '../lib/http';
import { isImageMime, sniffAllowed, SNIFF_BYTES } from '../storage/sniff';

const VARIANTS = ['file', 'display', 'thumb'] as const;
type Variant = (typeof VARIANTS)[number];

const fieldsSchema = z.object({
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: z.uuid(),
  category: z.enum(ATTACHMENT_CATEGORIES).default('general'),
  width: z.coerce.number().int().positive().max(20_000).optional(),
  height: z.coerce.number().int().positive().max(20_000).optional(),
});
type Fields = z.infer<typeof fieldsSchema>;

interface Stored {
  key: string;
  mime: string;
  size: number;
  sha256: string;
  fileName: string;
}

const tooLarge = (max: number) =>
  new HttpError(413, 'FILE_TOO_LARGE', `Ukuran file maksimal ${Math.round(max / 1024 / 1024)} MB`);
const badType = (name: string) =>
  new HttpError(415, 'FILE_TYPE', `Tipe file "${name}" tidak diizinkan atau isinya tidak cocok`);

/**
 * Izin unggah. M0 hanya mendukung lampiran milik user sendiri (foto profil).
 * Project/WO/logbook menyusul di M1 dengan cek `attachment.upload` per project.
 */
function assertCanUpload(a: AuthContext, f: Fields): void {
  if (f.ownerType === 'user') {
    if (f.ownerId !== a.user.id) throw forbidden('Hanya bisa mengunggah foto profil sendiri');
    return;
  }
  throw new HttpError(422, 'UNSUPPORTED_OWNER', 'Jenis pemilik lampiran ini belum didukung');
}

function storageKey(ownerType: string, id: string, variant: 'original' | 'display' | 'thumb') {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${ownerType}/${yyyy}/${mm}/${id}/${variant}`;
}

/** Stream file: cek magic bytes pada 4 KB pertama, hitung SHA-256 & ukuran, tulis ke storage. */
async function storeFile(
  deps: Deps,
  key: string,
  fileName: string,
  source: Readable & { truncated?: boolean },
): Promise<Stored> {
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let mime: string | null = null;
  const check = () => {
    const r = sniffAllowed(fileName, head);
    if (!r) throw badType(fileName);
    mime = r.mime;
  };
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        size += chunk.length;
        hash.update(chunk);
        if (!mime) {
          head = Buffer.concat([head, chunk]);
          if (head.length >= SNIFF_BYTES) check();
        }
        cb(null, chunk);
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      try {
        if (!mime) check();
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  source.on('limit', () => guard.destroy(tooLarge(deps.uploadMaxBytes)));
  source.on('error', (err) => guard.destroy(err));
  try {
    await deps.storage.put(key, source.pipe(guard), { contentType: 'application/octet-stream' });
  } catch (err) {
    await deps.storage.delete(key).catch(() => {});
    throw err;
  }
  return { key, mime: mime!, size, sha256: hash.digest('hex'), fileName };
}

export const attachmentRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  /**
   * Unggah multipart (PRD §7): field `ownerType`, `ownerId`, `category`, [`width`, `height`]
   * HARUS dikirim sebelum file. File: `file` (asli), opsional `display` & `thumb` (foto, dibuat klien).
   * Server stream langsung ke storage — tidak menyimpan di disk/memori penuh.
   */
  .post('/', async (c) => {
    const a = authOf(c);
    const deps = c.var.deps;
    const ct = c.req.header('content-type') ?? '';
    if (!ct.startsWith('multipart/form-data')) {
      throw new HttpError(415, 'MULTIPART_REQUIRED', 'Gunakan multipart/form-data');
    }
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > deps.uploadMaxBytes * 3 + 1024 * 1024) throw tooLarge(deps.uploadMaxBytes);
    const body = c.req.raw.body;
    if (!body) throw new HttpError(400, 'BAD_REQUEST', 'Body kosong');

    const id = uuidv7();
    const raw: Record<string, string> = {};
    let fields: Fields | null = null;
    const stored: Partial<Record<Variant, Stored>> = {};

    try {
      await new Promise<void>((resolve, reject) => {
        const bb = Busboy({
          headers: { 'content-type': ct },
          limits: { fileSize: deps.uploadMaxBytes, files: 3, fields: 10, fieldSize: 2048 },
        });
        const jobs: Array<Promise<void>> = [];
        let failed = false;
        const fail = (err: unknown) => {
          if (failed) return;
          failed = true;
          reject(err);
        };
        bb.on('field', (name, value) => {
          raw[name] = value;
        });
        bb.on('file', (name, stream, info) => {
          if (failed || !(VARIANTS as readonly string[]).includes(name)) {
            stream.resume();
            return;
          }
          try {
            fields ??= validate(fieldsSchema, raw);
            assertCanUpload(a, fields);
          } catch (err) {
            stream.resume();
            fail(err);
            return;
          }
          const variant = name as Variant;
          const key = storageKey(fields.ownerType, id, variant === 'file' ? 'original' : variant);
          jobs.push(
            storeFile(deps, key, info.filename || `${variant}.bin`, stream).then(
              (s) => {
                stored[variant] = s;
              },
              (err) => {
                stream.resume();
                fail(err);
              },
            ),
          );
        });
        bb.on('error', fail);
        bb.on('close', () => {
          void Promise.allSettled(jobs).then(() => {
            if (!failed) resolve();
          });
        });
        Readable.fromWeb(body as unknown as NodeWebReadableStream).pipe(bb);
      });

      const original = stored.file;
      if (!fields || !original) throw new HttpError(422, 'NO_FILE', 'File tidak ditemukan');
      const f: Fields = fields;
      for (const v of ['display', 'thumb'] as const) {
        if (stored[v] && (!isImageMime(original.mime) || !isImageMime(stored[v].mime))) {
          throw new HttpError(422, 'VARIANT', 'Varian display/thumb hanya untuk foto');
        }
      }

      // Deduplikasi: SHA-256 sama pada pemilik yang sama → pakai objek lama (PRD §7).
      const dup = await deps.db.query.attachments.findFirst({
        where: and(
          eq(attachments.ownerType, f.ownerType),
          eq(attachments.ownerId, f.ownerId),
          eq(attachments.sha256, original.sha256),
          isNull(attachments.deletedAt),
        ),
      });
      if (dup) {
        await Promise.all(Object.values(stored).map((s) => deps.storage.delete(s.key)));
        return c.json({ id: dup.id, duplicate: true, message: 'File yang sama sudah ada' }, 200);
      }

      const [row] = await deps.db
        .insert(attachments)
        .values({
          id,
          ownerType: f.ownerType,
          ownerId: f.ownerId,
          category: f.category,
          fileName: original.fileName.slice(0, 255),
          mime: original.mime,
          sizeBytes: original.size,
          sha256: original.sha256,
          storageKey: original.key,
          displayKey: stored.display?.key ?? null,
          thumbKey: stored.thumb?.key ?? null,
          width: f.width ?? null,
          height: f.height ?? null,
          uploadedBy: a.user.id,
        })
        .returning();
      return c.json(
        {
          id: row!.id,
          fileName: row!.fileName,
          mime: row!.mime,
          sizeBytes: row!.sizeBytes,
          url: `/files/${row!.id}/original`,
        },
        201,
      );
    } catch (err) {
      await Promise.all(
        Object.values(stored).map((s) => deps.storage.delete(s.key).catch(() => {})),
      );
      throw err;
    }
  });
