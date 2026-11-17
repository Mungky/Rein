import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageDriver } from './driver';

/** Penyimpanan di disk lokal untuk dev/test. File disajikan lewat server, bukan Signed URL. */
export class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Key storage tidak valid');
    return p;
  }

  async put(key: string, body: Readable, _meta?: { contentType: string }): Promise<void> {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await pipeline(body, createWriteStream(p));
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  async signedReadUrl(): Promise<null> {
    return null;
  }

  async read(key: string): Promise<Readable> {
    const p = this.file(key);
    await stat(p);
    return createReadStream(p);
  }
}
