import type { ImageResult } from './image';
import { uploadAttachment } from './upload';

/** Staging milik user; API project memeriksa izin sebelum memasangkan gambarnya. */
export async function uploadProjectImages(
  userId: string,
  logo: ImageResult | null,
  banner: ImageResult | null,
) {
  const ids: { logoAttachmentId?: string; bannerAttachmentId?: string } = {};
  for (const [kind, image] of [
    ['logo', logo],
    ['banner', banner],
  ] as const) {
    if (!image) continue;
    const ext = image.blob.type === 'image/jpeg' ? 'jpg' : 'webp';
    const result = await uploadAttachment({
      ownerType: 'user',
      ownerId: userId,
      category: 'photo',
      file: { blob: image.blob, name: `${kind}.${ext}` },
      width: image.width,
      height: image.height,
    });
    ids[kind === 'logo' ? 'logoAttachmentId' : 'bannerAttachmentId'] = result.id;
  }
  return ids;
}
