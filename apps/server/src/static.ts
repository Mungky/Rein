import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import type { AppEnv } from './context';

/** Hash SHA-256 setiap <script> inline di index.html (bootstrap SvelteKit) untuk CSP. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.push(
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
    );
  }
  return out;
}

export function htmlCsp(hashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    // Svelte transitions & atribut style memakai gaya inline.
    "style-src 'self' 'unsafe-inline'",
    // Lampiran dibuka lewat redirect ke Signed URL GCS (PRD §7).
    "img-src 'self' blob: data: https://storage.googleapis.com",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const API_PREFIXES = ['/api/', '/files/', '/auth/google/', '/healthz', '/readyz'];

/** Sajikan hasil build SPA (adapter-static) + fallback index.html untuk route klien. */
export function mountSpa(app: Hono<AppEnv>, distDir: string): void {
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`Build SPA tidak ditemukan: ${indexPath}`);
  const html = readFileSync(indexPath, 'utf8');
  const csp = htmlCsp(inlineScriptHashes(html));
  const root = path.relative(process.cwd(), distDir) || '.';

  app.use('/_app/immutable/*', async (c, next) => {
    await next();
    if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('/service-worker.js', async (c, next) => {
    await next();
    if (c.res.ok) {
      c.res.headers.set('Cache-Control', 'no-cache');
      c.res.headers.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; connect-src 'self' https://storage.googleapis.com",
      );
    }
  });
  app.use('*', async (c, next) => {
    await next();
    // onFound dipanggil sesudah Response dibuat; pasang header pada respons final, termasuk HTML terkompresi.
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) {
      c.res.headers.set('Cache-Control', 'no-cache');
      c.res.headers.set('Content-Security-Policy', csp);
    }
  });
  app.use('*', serveStatic({ root, precompressed: true }));
  app.get('*', (c) => {
    const p = c.req.path;
    if (API_PREFIXES.some((x) => p.startsWith(x))) return c.notFound();
    return c.html(html, 200, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp });
  });
}
