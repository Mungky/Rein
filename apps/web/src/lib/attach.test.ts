import { expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@rein/shared';
import { uploadPreparedFile } from './attach';

it('menolak file di atas 50 MB sebelum kompresi foto atau upload', async () => {
  const progress = vi.fn();
  const file = { name: 'besar.jpg', type: 'image/jpeg', size: MAX_ATTACHMENT_BYTES + 1 } as File;
  await expect(
    uploadPreparedFile(file, { ownerType: 'user', ownerId: 'unused' }, progress),
  ).rejects.toMatchObject({
    code: 'FILE_TOO_LARGE',
    status: 413,
  });
  expect(progress).not.toHaveBeenCalled();
});
