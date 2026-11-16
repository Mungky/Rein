import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { expect, it } from 'vitest';
import type { AppEnv } from '../src/context';
import { securityHeaders } from '../src/security';
import { mountSpa } from '../src/static';

it.each(['br', 'gzip', 'identity'])(
  'Beranda langsung mempunyai CSP bootstrap pada encoding %s',
  async (encoding) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rein-static-'));
    const target = path.resolve(dir);
    if (
      path.dirname(target) !== path.resolve(tmpdir()) ||
      !path.basename(target).startsWith('rein-static-')
    ) {
      throw new Error('Unsafe test cleanup path');
    }
    const html =
      '<html><head><title>REIN</title></head><body><script>window.bootstrap=true</script></body></html>';
    try {
      await mkdir(path.join(dir, '_app'), { recursive: true });
      await writeFile(path.join(dir, 'index.html'), html);
      await writeFile(path.join(dir, 'index.html.br'), brotliCompressSync(html));
      await writeFile(path.join(dir, 'index.html.gz'), gzipSync(html));
      const app = new Hono<AppEnv>();
      app.use('*', securityHeaders({ https: false }));
      app.get('/api/test', (c) => c.json({ ok: true }));
      mountSpa(app, dir);
      for (const url of ['/', '/index.html', '/project']) {
        const res = await app.request(url, { headers: { 'accept-encoding': encoding } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'sha256-/);
        expect(res.headers.get('cache-control')).toBe('no-cache');
        await res.arrayBuffer();
      }
      const api = await app.request('/api/test');
      expect(api.headers.get('content-security-policy')).toContain("default-src 'none'");
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  },
);
