import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context';
import { HttpError } from './lib/http';

/**
 * Header keamanan (PRD §5). CSP untuk halaman HTML dipasang oleh static.ts (butuh hash script
 * inline SvelteKit); respons lain (API/JSON) mendapat CSP paling ketat.
 */
export function securityHeaders(opts: { https: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'same-origin');
    h.set('X-Frame-Options', 'SAMEORIGIN');
    h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (opts.https) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!h.has('Content-Security-Policy')) {
      h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
  };
}

/** CSRF (PRD §5): SameSite=Lax + header `X-Requested-With: rein` wajib untuk mutasi API. */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    if (c.req.header('x-requested-with') !== 'rein') {
      throw new HttpError(403, 'CSRF', 'Permintaan ditolak (header keamanan tidak ada)');
    }
  }
  await next();
};
