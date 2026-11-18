/**
 * Lampiran form (Buat WO, logbook, Butuh bantuan): file diunggah dulu sebagai milik user
 * (staging) lalu `attachmentIds` dipindah server saat entri dibuat (FR-030 AC0).
 * Foto dikompres di klien (PRD §7): display ≤ 1920 px WebP q0,75 + thumb 320 px.
 */
import { compressImage, processImage } from './image';
import { uploadAttachment, type UploadInput } from './upload';
import { MAX_ATTACHMENT_BYTES } from '@rein/shared';
import { ApiError } from './api';

export interface Staged {
  key: string;
  name: string;
  size: number;
  /** Object URL pratinjau (foto saja). */
  preview: string | null;
  progress: number;
  id: string | null;
  error: string | null;
  offlineFile?: File;
}

const PHOTO = /^image\/(jpeg|png|webp|heic|heif)$/i;
const SKIP_BYTES = 300 * 1024;

export async function prepareAttachment(
  file: File,
  owner: { ownerType: 'project' | 'user'; ownerId: string },
  compress = processImage,
): Promise<UploadInput> {
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Ukuran file maksimal 50 MiB');
  if (!PHOTO.test(file.type)) {
    return {
      ...owner,
      file: { blob: file, name: file.name },
    };
  }
  const base = file.name.replace(/\.[^.]+$/, '');
  const display =
    file.size <= SKIP_BYTES && /^image\/(jpeg|webp)$/i.test(file.type)
      ? null
      : await compress(file, { maxSide: 1920, quality: 0.75 });
  const thumb = await compress(file, { maxSide: 320, quality: 0.7 });
  const original = display ?? { blob: file as Blob, width: thumb.width, height: thumb.height };
  const ext = original.blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  return {
    ...owner,
    // Foto yang sudah dikompres menjadi "file" utama — ukuran asli tidak disimpan (PRD §7).
    file: { blob: original.blob, name: display ? `${base}.${ext}` : file.name },
    thumb: { blob: thumb.blob, name: `${base}-thumb.webp` },
    width: original.width,
    height: original.height,
  };
}

export async function uploadPreparedFile(
  file: File,
  owner: { ownerType: 'project' | 'user'; ownerId: string },
  onProgress?: (f: number) => void,
): Promise<{ id: string; preview: string | null }> {
  const input = await prepareAttachment(file, owner, compressImage);
  const r = await uploadAttachment({ ...input, onProgress });
  return {
    id: r.id,
    preview:
      input.thumb && owner.ownerType === 'user' ? URL.createObjectURL(input.thumb.blob) : null,
  };
}

/** Thumbnail lampiran (varian thumb jika ada, selain itu null → ikon file). */
export const thumbUrl = (f: { id: string; hasThumb: boolean; mime: string }, account?: string) =>
  f.hasThumb
    ? `/files/${f.id}/thumb${account ? `?reinAccount=${encodeURIComponent(account)}` : ''}`
    : null;
export const fileUrl = (id: string) => `/files/${id}/original`;
export const isPreviewImage = (mime: string) => /^image\/(webp|jpeg|png)$/.test(mime);
export const displayUrl = (id: string) => `/files/${id}/display`;
