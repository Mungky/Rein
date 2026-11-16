/**
 * Alat bantu dev/test (pelajaran REIN v1: `/dev/*` hanya di build dev). Dipasang di app.ts
 * HANYA bila NODE_ENV bukan `production`.
 *  POST /api/dev/deliver     — jalankan satu putaran kirim WA sekarang
 */
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { deliverWhatsApp } from '../notify/deliver';

export const devRoutes = new Hono<AppEnv>().post('/deliver', async (c) =>
  c.json(await deliverWhatsApp(c.var.deps)),
);
