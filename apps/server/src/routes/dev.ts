/**
 * Alat bantu dev/test (pelajaran REIN v1: `/dev/*` hanya di build dev). Dipasang di app.ts
 * HANYA bila NODE_ENV bukan `production`.
 *  POST /api/dev/wa-inbound  {phone, text} — simulasikan pesan WA masuk (verifikasi dibalik)
 *  GET  /api/dev/wa-outbox   — pesan yang "dikirim" NullWhatsApp
 *  POST /api/dev/deliver     — jalankan satu putaran kirim WA sekarang
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { verifyWhatsAppFromMessage } from '../auth/wa-verification';
import type { AppEnv } from '../context';
import { readJson } from '../lib/http';
import { publishToUsers } from '../notify/bus';
import { deliverWhatsApp } from '../notify/deliver';
import { NullWhatsApp } from '../wa/provider';

export const devRoutes = new Hono<AppEnv>()
  .post('/wa-inbound', async (c) => {
    const { db, env } = c.var.deps;
    const body = await readJson(
      c,
      z.object({ phone: z.string().max(32), text: z.string().max(500) }),
    );
    const r = await verifyWhatsAppFromMessage(db, env, body.phone, body.text);
    if (r.ok) publishToUsers([r.userId], { type: 'verification' });
    return c.json(r);
  })
  .get('/wa-outbox', (c) => {
    const { wa } = c.var.deps;
    return c.json({ messages: wa instanceof NullWhatsApp ? wa.outbox : [] });
  })
  .post('/deliver', async (c) => c.json(await deliverWhatsApp(c.var.deps)));
