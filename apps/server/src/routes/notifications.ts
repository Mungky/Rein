/**
 * Inbox in-app (FR-080) + aliran real-time SSE.
 *  GET  /api/notifications?tab=all|unread|help|mention&before=<id>&limit=30
 *  GET  /api/notifications/unread-count
 *  POST /api/notifications/:id/read
 *  POST /api/notifications/read-all
 *  GET  /api/stream  — SSE: `hello`, `notification`, `wo`, `project`, `ping`.
 * Hanya notifikasi milik user sendiri; tidak ada izin lain yang dibutuhkan.
 */
import { and, count, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { authOf, requireVerified } from '../auth/middleware';
import type { AppEnv, Deps } from '../context';
import { notifications, projects } from '../db/schema';
import { notFound, validate } from '../lib/http';
import { publishToUsers, subscribeUser, type BusEvent } from '../notify/bus';

const listQuery = z.object({
  tab: z.enum(['all', 'unread', 'help', 'mention']).default('all'),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

const HELP_EVENTS = ['help.requested', 'help.resolved'];
/** Event "Disebut" (mention) baru ada bersama rich text mention; tab disiapkan dari sekarang. */
const MENTION_EVENTS = ['mention'];
/** SSE ditutup berkala agar sesi yang dicabut tidak terus menerima data; EventSource menyambung ulang. */
const STREAM_MAX_MS = 15 * 60_000;
const PING_MS = 25_000;

async function unreadCount(db: Deps['db'], userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export const notificationRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  .get('/', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const q = validate(listQuery, c.req.query());
    const where: SQL[] = [eq(notifications.userId, a.user.id)];
    if (q.tab === 'unread') where.push(isNull(notifications.readAt));
    if (q.tab === 'help') where.push(inArray(notifications.eventKey, HELP_EVENTS));
    if (q.tab === 'mention') where.push(inArray(notifications.eventKey, MENTION_EVENTS));
    // id = UUIDv7 (urut waktu) → kursor cukup id terakhir.
    if (q.before) where.push(lt(notifications.id, q.before));

    const rows = await db
      .select({
        id: notifications.id,
        event: notifications.eventKey,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        projectId: notifications.projectId,
        projectName: projects.name,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .leftJoin(projects, eq(projects.id, notifications.projectId))
      .where(and(...where))
      .orderBy(desc(notifications.id))
      .limit(q.limit + 1);

    const more = rows.length > q.limit;
    const items = more ? rows.slice(0, q.limit) : rows;
    return c.json({
      items,
      nextCursor: more ? items.at(-1)!.id : null,
      unread: await unreadCount(db, a.user.id),
    });
  })

  .get('/unread-count', async (c) => {
    const a = authOf(c);
    return c.json({ unread: await unreadCount(c.var.deps.db, a.user.id) });
  })

  .post('/read-all', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const res = await db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.userId, a.user.id), isNull(notifications.readAt)));
    publishToUsers([a.user.id], { type: 'notification' });
    return c.json({ updated: res.rowCount ?? 0, unread: 0 });
  })

  .post('/:id/read', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) throw notFound('Notifikasi tidak ditemukan');
    const [row] = await db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, a.user.id)))
      .returning({ id: notifications.id });
    if (!row) throw notFound('Notifikasi tidak ditemukan');
    publishToUsers([a.user.id], { type: 'notification' });
    return c.json({ ok: true, unread: await unreadCount(db, a.user.id) });
  });

export const streamRoutes = new Hono<AppEnv>().use(requireVerified).get('/', (c) => {
  const a = authOf(c);
  const { db } = c.var.deps;
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const queue: BusEvent[] = [];
    let wake: (() => void) | null = null;
    const off = subscribeUser(a.user.id, (e) => {
      queue.push(e);
      wake?.();
    });
    let closed = false;
    stream.onAbort(() => {
      closed = true;
      wake?.();
    });
    const until = Date.now() + STREAM_MAX_MS;
    try {
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ unread: await unreadCount(db, a.user.id) }),
        retry: 3000,
      });
      while (!closed && Date.now() < until) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, PING_MS);
            wake = () => {
              clearTimeout(t);
              resolve();
            };
          });
          wake = null;
        }
        if (closed) break;
        if (!queue.length) {
          await stream.writeSSE({ event: 'ping', data: '{}' });
          continue;
        }
        // Gabungkan banyak notifikasi beruntun menjadi satu dorongan + jumlah terbaru.
        const batch = queue.splice(0);
        if (batch.some((e) => e.type === 'notification')) {
          await stream.writeSSE({
            event: 'notification',
            data: JSON.stringify({ unread: await unreadCount(db, a.user.id) }),
          });
        }
        const sent = new Set<string>();
        for (const e of batch) {
          if (e.type === 'notification') continue;
          const data = JSON.stringify(e);
          if (sent.has(data)) continue;
          sent.add(data);
          await stream.writeSSE({ event: e.type, data });
        }
      }
    } finally {
      off();
    }
  });
});
