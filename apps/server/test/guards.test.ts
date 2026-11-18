/**
 * Penjaga dari pelajaran REIN v1 (docs/M1-RENCANA.md D6), tanpa database:
 *  - "izin hantu": setiap permission di matriks harus benar-benar dicek di server, dan setiap
 *    permission yang dicek harus ada di matriks;
 *  - redaksi secret di audit log.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_KEYS } from '@rein/shared';
import { describe, expect, it } from 'vitest';
import { redact } from '../src/audit';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/**
 * Permission yang SENGAJA belum dicek karena fiturnya belum ada di milestone ini.
 * Setiap entri wajib punya alasan; hapus dari daftar begitu endpoint-nya dibuat.
 */
const PENDING: Record<string, string> = {
  'logbook.delete.any': 'hapus entri logbook orang lain menyusul (endpoint belum ada)',
  'attachment.delete.any': 'hapus lampiran menyusul (endpoint belum ada)',
  'admin.audit': 'audit log viewer = FR-094 (P1, M3)',
};

describe('izin hantu', () => {
  const code = sources(SRC)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const checked = new Set(
    [
      ...code.matchAll(/(?:requirePermission|assertCan|canDo|can)\([^)]*?'([a-z_]+\.[a-z_.]+)'/g),
    ].map((m) => m[1]!),
  );

  it('setiap permission yang dicek server ada di matriks', () => {
    const unknown = [...checked].filter((k) => !(PERMISSION_KEYS as string[]).includes(k));
    expect(unknown).toEqual([]);
  });

  it('setiap permission di matriks dicek server (atau tercatat PENDING beserta alasannya)', () => {
    const ghosts = PERMISSION_KEYS.filter((k) => !checked.has(k) && !(k in PENDING));
    expect(ghosts).toEqual([]);
  });

  it('daftar PENDING tidak basi', () => {
    const stale = Object.keys(PENDING).filter((k) => checked.has(k));
    expect(stale).toEqual([]);
  });
});

describe('redaksi audit', () => {
  it('mengganti nilai rahasia secara rekursif, data lain tetap', () => {
    expect(
      redact({
        username: 'rina',
        password: 'Rahasia-123',
        nested: { pinHash: 'x', token: 'y', items: [{ secret: 's', ok: 1 }] },
        code: 'KR',
      }),
    ).toEqual({
      username: 'rina',
      password: '[redacted]',
      nested: {
        pinHash: '[redacted]',
        token: '[redacted]',
        items: [{ secret: '[redacted]', ok: 1 }],
      },
      code: 'KR',
    });
  });
});
