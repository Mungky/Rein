/**
 * Lampiran form (Buat WO, logbook, Butuh bantuan): file diunggah dulu sebagai milik user
 * (staging) lalu `attachmentIds` dipindah server saat entri dibuat (FR-030 AC0).
 * Foto dikompres di klien (PRD §7): display ≤ 1920 px WebP q0,75 + thumb 320 px.
 */
import { compressImage } from './image';
import { uploadAttachment } from './upload';

export interface Staged {
  key: string;
  name: string;
  size: number;
  /** Object URL pratinjau (foto saja). */
  preview: string | null;
  progress: number;
  id: string | null;
  error: string | null;
}

const PHOTO = /^image\/(jpeg|png|webp|heic|heif)$/i;
const SKIP_BYTES = 300 * 1024;

export async function stageFile(
  file: File,
  userId: string,
  onProgress: (f: number) => void,
): Promise<{ id: string; preview: string | null }> {
  if (!PHOTO.test(file.type)) {
    const r = await uploadAttachment({
      ownerType: 'user',
      ownerId: userId,
      file: { blob: file, name: file.name },
      onProgress,
    });
    return { id: r.id, preview: null };
  }
  const base = file.name.replace(/\.[^.]+$/, '');
  const display =
    file.size <= SKIP_BYTES && /^image\/(jpeg|webp)$/i.test(file.type)
      ? null
      : await compressImage(file, { maxSide: 1920, quality: 0.75 });
  const thumb = await compressImage(file, { maxSide: 320, quality: 0.7 });
  const original = display ?? { blob: file as Blob, width: thumb.width, height: thumb.height };
  const ext = original.blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  const r = await uploadAttachment({
    ownerType: 'user',
    ownerId: userId,
    // Foto yang sudah dikompres menjadi "file" utama — ukuran asli tidak disimpan (PRD §7).
    file: { blob: original.blob, name: display ? `${base}.${ext}` : file.name },
    thumb: { blob: thumb.blob, name: `${base}-thumb.webp` },
    width: original.width,
    height: original.height,
    onProgress,
  });
  return { id: r.id, preview: URL.createObjectURL(thumb.blob) };
}

/** Thumbnail lampiran (varian thumb jika ada, selain itu null → ikon file). */
export const thumbUrl = (f: { id: string; hasThumb: boolean; mime: string }) =>
  f.hasThumb ? `/files/${f.id}/thumb` : null;
export const fileUrl = (id: string) => `/files/${id}/original`;
