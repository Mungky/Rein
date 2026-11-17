import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Bucket } from '@google-cloud/storage';
import { afterAll, describe, expect, it } from 'vitest';
import { contentDisposition, startOfDayWib } from './driver';
import { GcsDriver } from './gcs';
import { LocalDriver } from './local';
import { sniffAllowed } from './sniff';

const bytes = (...parts: Array<string | number[]>) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );

const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR');
const WEBP = bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ');
const HEIC = bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]);
const PDF = bytes('%PDF-1.7\n');
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], 'rest');
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DWG = bytes('AC1032', [0, 0, 0]);
const STEP = bytes('ISO-10303-21;\nHEADER;');
const TEXT = bytes('no,nama\n1,Tangki\n');
const EXE = bytes('MZ', [0x90, 0, 3, 0, 0, 0]);

describe('sniffAllowed — magic bytes (PRD §7)', () => {
  it.each([
    ['foto.jpg', JPG, 'image/jpeg'],
    ['foto.JPEG', JPG, 'image/jpeg'],
    ['foto.png', PNG, 'image/png'],
    ['foto.webp', WEBP, 'image/webp'],
    ['foto.heic', HEIC, 'image/heic'],
    ['po.pdf', PDF, 'application/pdf'],
    ['rab.xlsx', ZIP, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['surat.docx', ZIP, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['arsip.zip', ZIP, 'application/zip'],
    ['lama.xls', OLE, 'application/vnd.ms-excel'],
    ['lama.doc', OLE, 'application/msword'],
    ['gambar.dwg', DWG, 'image/vnd.dwg'],
    ['part.step', STEP, 'model/step'],
    ['part.stp', STEP, 'model/step'],
    ['data.csv', TEXT, 'text/csv'],
    ['catatan.txt', TEXT, 'text/plain'],
  ])('%s diterima', (name, head, mime) => {
    expect(sniffAllowed(name, head)).toEqual({ mime });
  });

  it.each([
    ['virus.exe', EXE],
    ['virus.png', EXE],
    ['palsu.pdf', PNG],
    ['teks.png', TEXT],
    ['tanpa-ekstensi', PDF],
    ['skrip.svg', bytes('<svg onload="x">')],
    ['kosong.pdf', Buffer.alloc(0)],
  ])('%s ditolak', (name, head) => {
    expect(sniffAllowed(name, head)).toBeNull();
  });
});

describe('LocalDriver', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('put → read → delete; menolak path traversal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rein-local-'));
    dirs.push(root);
    const d = new LocalDriver(root);
    await d.put('user/2026/11/abc/original', Readable.from([Buffer.from('halo')]), {
      contentType: 'text/plain',
    });
    const chunks: Buffer[] = [];
    for await (const ch of await d.read('user/2026/11/abc/original')) chunks.push(ch as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('halo');
    await d.delete('user/2026/11/abc/original');
    await expect(d.read('user/2026/11/abc/original')).rejects.toThrow();
    await expect(d.put('../luar', Readable.from(['x']), { contentType: 'x' })).rejects.toThrow();
  });
});

describe('Signed URL dibulatkan per hari (PRD §7)', () => {
  it('startOfDayWib: 00:00 WIB = 17:00 UTC hari sebelumnya', () => {
    expect(startOfDayWib(new Date('2026-11-15T16:59:59Z')).toISOString()).toBe(
      '2026-11-14T17:00:00.000Z',
    );
    expect(startOfDayWib(new Date('2026-11-15T17:00:00Z')).toISOString()).toBe(
      '2026-11-15T17:00:00.000Z',
    );
  });

  it('GcsDriver menandatangani di awal hari WIB, berlaku 24 jam → URL sama sepanjang hari', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeBucket = {
      file: (key: string) => ({
        getSignedUrl: async (cfg: Record<string, unknown>) => {
          calls.push(cfg);
          const at = (cfg.accessibleAt as Date).toISOString();
          return [`https://storage.googleapis.com/b/${key}?X-Goog-Date=${at}`];
        },
      }),
    } as unknown as Bucket;
    const d = new GcsDriver(fakeBucket);
    const opts = { fileName: 'foto.webp', contentType: 'image/webp', inline: true };
    const morning = await d.signedReadUrl('k', { ...opts, now: new Date('2026-11-15T01:00:00Z') });
    const evening = await d.signedReadUrl('k', { ...opts, now: new Date('2026-11-15T15:30:00Z') });
    expect(morning.url).toBe(evening.url);
    expect(calls[0]).toMatchObject({ version: 'v4', action: 'read' });
    const span = (calls[0]!.expires as Date).getTime() - (calls[0]!.accessibleAt as Date).getTime();
    expect(span).toBe(86_400_000);
    expect(morning.expiresAt.toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });

  it('Content-Disposition aman untuk tanda kutip & non-ASCII', () => {
    expect(contentDisposition('BAST "final".pdf', false)).toBe(
      `attachment; filename="BAST _final_.pdf"; filename*=UTF-8''BAST%20%22final%22.pdf`,
    );
  });
});
