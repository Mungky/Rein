/// <reference lib="webworker" />
import { processImage, type ImageOptions } from './image';

self.onmessage = async (e: MessageEvent<{ file: Blob; opts: ImageOptions }>) => {
  try {
    const result = await processImage(e.data.file, e.data.opts);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
