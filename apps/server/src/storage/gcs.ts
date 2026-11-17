import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Bucket } from '@google-cloud/storage';
import { contentDisposition, startOfDayWib, type StorageDriver } from './driver';

const DAY_MS = 86_400_000;

/**
 * Google Cloud Storage, bucket privat (PRD §7). Akses baca lewat V4 Signed URL yang
 * ditandatangani pada awal hari WIB dan berlaku 24 jam — URL identik sepanjang hari.
 */
export class GcsDriver implements StorageDriver {
  readonly name = 'gcs' as const;

  constructor(private readonly bucket: Bucket) {}

  async put(key: string, body: Readable, meta: { contentType: string }): Promise<void> {
    const file = this.bucket.file(key);
    await pipeline(
      body,
      file.createWriteStream({
        resumable: false,
        contentType: meta.contentType,
        metadata: { cacheControl: 'private, max-age=86400' },
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async signedReadUrl(
    key: string,
    opts: { fileName: string; contentType: string; inline: boolean; now?: Date },
  ): Promise<{ url: string; expiresAt: Date }> {
    const accessibleAt = startOfDayWib(opts.now ?? new Date());
    const expiresAt = new Date(accessibleAt.getTime() + DAY_MS);
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      accessibleAt,
      expires: expiresAt,
      responseType: opts.contentType,
      responseDisposition: contentDisposition(opts.fileName, opts.inline),
    });
    return { url, expiresAt };
  }

  async read(): Promise<Readable> {
    throw new Error('GcsDriver memakai Signed URL, bukan stream lewat server');
  }
}

export async function createGcsDriver(bucketName: string, keyFile?: string): Promise<GcsDriver> {
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage(keyFile ? { keyFilename: keyFile } : {});
  return new GcsDriver(storage.bucket(bucketName));
}
