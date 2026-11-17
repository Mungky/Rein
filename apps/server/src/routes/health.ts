import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';

/** Health check (PRD §11.2): /healthz = proses + DB ping, /readyz = siap menerima trafik. */
export const healthRoutes = new Hono<AppEnv>()
  .get('/healthz', async (c) => {
    try {
      await c.var.deps.db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, db: 'down' }, 503);
    }
  })
  .get('/readyz', (c) => c.json({ ok: true }));
