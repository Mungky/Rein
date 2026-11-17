import { afterEach, describe, expect, it, vi } from 'vitest';
import { processImage } from './image';

afterEach(() => vi.unstubAllGlobals());

function bitmap(width: number, height: number) {
  const drawImage = vi.fn();
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage, imageSmoothingQuality: '' };
      }
      async convertToBlob() {
        return new Blob(['image'], { type: 'image/webp' });
      }
    },
  );
  return { drawImage, close };
}

describe('crop gambar project di klien', () => {
  it.each([
    { width: 2000, height: 1000, crop: { width: 1600, height: 400 }, source: [0, 250, 2000, 500] },
    { width: 1000, height: 2000, crop: { width: 1600, height: 400 }, source: [0, 875, 1000, 250] },
    { width: 2400, height: 400, crop: { width: 1600, height: 400 }, source: [400, 0, 1600, 400] },
    { width: 64, height: 128, crop: { width: 256, height: 256 }, source: [0, 32, 64, 64] },
  ])(
    'crop $width × $height ke $crop.width × $crop.height tanpa distorsi',
    async ({ width, height, crop, source }) => {
      const { drawImage, close } = bitmap(width, height);
      const result = await processImage(new Blob(), { crop });
      expect(result.width).toBe(crop.width);
      expect(result.height).toBe(crop.height);
      expect(drawImage.mock.calls[0]?.slice(1)).toEqual([...source, 0, 0, crop.width, crop.height]);
      expect(close).toHaveBeenCalledOnce();
      expect(result.blob.type).toBe('image/webp');
    },
  );

  it('opsi square untuk foto profil tetap tidak memperbesar gambar kecil', async () => {
    bitmap(64, 128);
    const result = await processImage(new Blob(), { square: 256 });
    expect([result.width, result.height]).toEqual([64, 64]);
  });
});
