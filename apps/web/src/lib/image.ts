/**
 * Kompresi gambar di klien (PRD §7): orientasi EXIF diterapkan lalu metadata terbuang saat
 * di-encode ulang; WebP (fallback JPEG). Bisa dipakai di Web Worker (OffscreenCanvas) atau main thread.
 */
export interface ImageOptions {
  /** Sisi terpanjang maksimum (foto: 1920, thumb: 320). */
  maxSide?: number;
  /** Potong persegi di tengah lalu skala ke ukuran ini (avatar/logo: 256). */
  square?: number;
  /** Potong di tengah dengan rasio dan ukuran keluaran tertentu (banner/logo project). */
  crop?: { width: number; height: number };
  /** Kualitas WebP 0–1 (PRD: 0,75). */
  quality?: number;
}

export interface ImageResult {
  blob: Blob;
  width: number;
  height: number;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function encode(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode gagal'))), type, quality),
  );
}

export async function processImage(file: Blob, opts: ImageOptions): Promise<ImageResult> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let sx = 0;
  let sy = 0;
  let sw = bmp.width;
  let sh = bmp.height;
  let w: number;
  let h: number;
  if (opts.crop) {
    const ratio = opts.crop.width / opts.crop.height;
    if (sw / sh > ratio) {
      const croppedWidth = sh * ratio;
      sx = (sw - croppedWidth) / 2;
      sw = croppedWidth;
    } else {
      const croppedHeight = sw / ratio;
      sy = (sh - croppedHeight) / 2;
      sh = croppedHeight;
    }
    w = opts.crop.width;
    h = opts.crop.height;
  } else if (opts.square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2;
    sy = (sh - s) / 2;
    sw = sh = s;
    w = h = Math.min(opts.square, s);
  } else {
    const scale = Math.min(1, (opts.maxSide ?? 1920) / Math.max(sw, sh));
    w = Math.max(1, Math.round(sw * scale));
    h = Math.max(1, Math.round(sh * scale));
  }
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas tidak didukung');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close();

  const q = opts.quality ?? 0.75;
  let blob = await encode(canvas, 'image/webp', q);
  if (blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', 0.78);
  return { blob, width: w, height: h };
}

/** Jalankan di Web Worker bila tersedia agar UI tetap responsif; selain itu di main thread. */
export function compressImage(file: Blob, opts: ImageOptions): Promise<ImageResult> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return processImage(file, opts);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: ImageResult; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? 'Kompresi gagal'));
    };
    worker.onerror = () => {
      worker.terminate();
      processImage(file, opts).then(resolve, reject);
    };
    worker.postMessage({ file, opts });
  });
}
