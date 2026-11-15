import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/**
 * IP klien. Di belakang satu reverse proxy (Traefik/Coolify) pakai entri X-Forwarded-For
 * paling kanan — entri yang ditambahkan proxy tepercaya, bukan yang bisa dipalsukan klien.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const parts = xff
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return last;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function userAgent(c: Context): string | null {
  return c.req.header('user-agent')?.slice(0, 300) ?? null;
}
