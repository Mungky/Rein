import type { Readable } from 'node:stream';

/**
 * Abstraksi penyimpanan lampiran (PRD §7). Self-host memakai volume server lewat LocalDriver;
 * GcsDriver tetap tersedia untuk konfigurasi Google Cloud. Objek tidak pernah publik.
 */
export interface StorageDriver {
  readonly name: 'gcs' | 'local';
  /** Tulis stream ke key (menimpa jika ada). */
  put(key: string, body: Readable, meta: { contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * URL baca bertanda tangan (GCS) — null jika driver menyajikan file lewat server (`read`).
   * `expiresAt` dipakai untuk header Cache-Control redirect.
   */
  signedReadUrl(
    key: string,
    opts: { fileName: string; contentType: string; inline: boolean; now?: Date },
  ): Promise<{ url: string; expiresAt: Date } | null>;
  /** Stream isi objek (LocalDriver). */
  read(key: string): Promise<Readable>;
}

const WIB_OFFSET_MS = 7 * 3600_000;

/**
 * Awal hari kalender WIB (Asia/Jakarta, UTC+7, tanpa DST) untuk `now`.
 * Signed URL ditandatangani pada waktu ini sehingga URL sama sepanjang hari → cache browser bekerja.
 */
export function startOfDayWib(now: Date): Date {
  const local = now.getTime() + WIB_OFFSET_MS;
  const day = Math.floor(local / 86_400_000) * 86_400_000;
  return new Date(day - WIB_OFFSET_MS);
}

/** Nama file aman untuk header Content-Disposition (RFC 6266 / 5987). */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
