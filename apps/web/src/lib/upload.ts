import {
  MAX_ATTACHMENT_BYTES,
  type AttachmentCategory,
  type AttachmentOwnerType,
} from '@rein/shared';
import { ApiError } from './api';

export interface UploadInput {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  category?: AttachmentCategory;
  file: { blob: Blob; name: string };
  display?: { blob: Blob; name: string };
  thumb?: { blob: Blob; name: string };
  width?: number;
  height?: number;
  onProgress?: (fraction: number) => void;
}

export interface UploadResult {
  id: string;
  duplicate?: boolean;
}

export function attachmentForm(input: UploadInput): FormData {
  const fd = new FormData();
  fd.append('ownerType', input.ownerType);
  fd.append('ownerId', input.ownerId);
  fd.append('category', input.category ?? 'general');
  if (input.width) fd.append('width', String(input.width));
  if (input.height) fd.append('height', String(input.height));
  fd.append('file', input.file.blob, input.file.name);
  if (input.display) fd.append('display', input.display.blob, input.display.name);
  if (input.thumb) fd.append('thumb', input.thumb.blob, input.thumb.name);
  return fd;
}

/**
 * Unggah lampiran (multipart) dengan progres. Ukuran dicek di klien sebelum upload
 * (PRD §7, 50 MB) dan dicek ulang di server.
 */
export function uploadAttachment(input: UploadInput): Promise<UploadResult> {
  for (const f of [input.file, input.display, input.thumb]) {
    if (f && f.blob.size > MAX_ATTACHMENT_BYTES) {
      return Promise.reject(new ApiError(413, 'FILE_TOO_LARGE', `${f.name} melebihi 50 MB`));
    }
  }
  const fd = attachmentForm(input);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');
    xhr.setRequestHeader('x-requested-with', 'rein');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as
        (UploadResult & { error?: { code: string; message: string } }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else {
        reject(
          new ApiError(
            xhr.status,
            body?.error?.code ?? 'UPLOAD_FAILED',
            body?.error?.message ?? 'Unggah gagal',
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'NETWORK', 'Koneksi terputus saat mengunggah. Coba lagi.'));
    xhr.send(fd);
  });
}
