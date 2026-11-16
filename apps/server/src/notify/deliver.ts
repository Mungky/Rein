/**
 * Worker kirim WhatsApp (PRD §6.2, keputusan D4/D7 di docs/M1-RENCANA.md).
 *
 * Mengambil `notification_deliveries` kanal `whatsapp` berstatus `queued` yang sudah jatuh tempo,
 * lalu untuk tiap baris:
 *  - user nonaktif / tanpa nomor WA terverifikasi → `skipped` (`user_inactive` / `no_whatsapp`);
 *  - di dalam jam tenang (default 21:00–07:00 WIB) → ditunda ke akhir jam tenang, kecuali
 *    `help.requested` (PRD §6.4);
 *  - sudah 20 WA terkirim hari ini → `skipped` (`rate_cap`, PRD §6.4);
 *  - gagal sementara → dicoba lagi 1, 5, 30 menit; setelah itu `failed`. Error 4xx permanen
 *    langsung `failed` tanpa retry.
 * Baris diklaim dengan `FOR UPDATE SKIP LOCKED` + sewa 2 menit agar tidak terkirim dua kali.
 */
import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client';
import {
  notificationDeliveries,
  notifications,
  userContacts,
  userSettings,
  users,
} from '../db/schema';
import { quietUntil, wibDayStart } from '../lib/format';
import { WA_READY, WaPermanentError, type WhatsAppProvider } from '../wa/provider';
import { BYPASS_QUIET, type EventKey } from './outbox';
import { canReceiveProjectNotification } from './access';

export const WA_DAILY_CAP = 20;
/** PRD §6.2 butir 5: jeda sebelum percobaan ke-2, ke-3, ke-4. */
export const RETRY_MINUTES = [1, 5, 30] as const;
/** Delivery yang tertahan lebih lama dari ini (mis. sesi WA putus seharian) tidak dikirim lagi. */
const EXPIRE_HOURS = 24;
const BATCH = 25;

export interface DeliverDeps {
  db: Db;
  wa: WhatsAppProvider;
  logger: Logger;
}

export interface DeliverResult {
  sent: number;
  deferred: number;
  skipped: number;
  retry: number;
  failed: number;
  /** true bila sesi OpenWA belum `ready` — antrean dibiarkan. */
  notReady?: boolean;
}

interface Claimed extends Record<string, unknown> {
  id: string;
  notification_id: string;
  payload: { text?: string } | null;
  attempts: number;
}

const iso = (d: Date) => d.toISOString();

export async function claimDeliveries(
  db: Db,
  now: Date,
  channel: 'whatsapp' | 'email' = 'whatsapp',
  limit = 50,
): Promise<Claimed[]> {
  const res = await db.execute<Claimed>(sql`
    update notification_deliveries
       set scheduled_for = ${iso(now)}::timestamptz + interval '2 minutes', updated_at = now()
     where id in (
       select id from notification_deliveries
        where channel = ${channel} and status = 'queued'
          and scheduled_for <= ${iso(now)}::timestamptz
        order by scheduled_for
        limit ${limit}
        for update skip locked)
    returning id, notification_id, payload, attempts`);
  return res.rows;
}

async function expireStale(db: Db, now: Date): Promise<number> {
  const res = await db.execute(sql`
    update notification_deliveries
       set status = 'skipped', last_error = 'expired', updated_at = now()
     where channel = 'whatsapp' and status = 'queued'
       and created_at < ${iso(now)}::timestamptz - make_interval(hours => ${EXPIRE_HOURS})`);
  return res.rowCount ?? 0;
}

async function recipientOf(db: Db, notificationId: string) {
  const [row] = await db
    .select({
      userId: notifications.userId,
      projectId: notifications.projectId,
      event: notifications.eventKey,
      userStatus: users.status,
      phone: userContacts.value,
      enabled: userSettings.notifyWhatsapp,
      quietEnabled: userSettings.quietEnabled,
      quietStart: userSettings.quietStart,
      quietEnd: userSettings.quietEnd,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .leftJoin(
      userContacts,
      and(
        eq(userContacts.userId, users.id),
        eq(userContacts.kind, 'whatsapp'),
        isNotNull(userContacts.verifiedAt),
      ),
    )
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(notifications.id, notificationId))
    .orderBy(desc(userContacts.isPrimary))
    .limit(1);
  return row ?? null;
}

async function sentToday(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notificationDeliveries.channel, 'whatsapp'),
        eq(notificationDeliveries.status, 'sent'),
        gte(notificationDeliveries.sentAt, wibDayStart(now)),
      ),
    );
  return row?.n ?? 0;
}

type Patch = Partial<typeof notificationDeliveries.$inferInsert>;
const update = (db: Db, id: string, patch: Patch) =>
  db
    .update(notificationDeliveries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(notificationDeliveries.id, id));

/** Satu putaran kirim. Aman dipanggil berulang (cron per menit + dorongan setelah commit). */
export async function deliverWhatsApp(deps: DeliverDeps, now = new Date()): Promise<DeliverResult> {
  const { db, wa, logger } = deps;
  const out: DeliverResult = { sent: 0, deferred: 0, skipped: 0, retry: 0, failed: 0 };
  out.skipped += await expireStale(db, now);

  if (wa.name !== 'null') {
    const s = await wa.session().catch(() => null);
    if (s?.status !== WA_READY) return { ...out, notReady: true };
  }

  for (const d of await claimDeliveries(db, now, 'whatsapp', BATCH)) {
    const r = await recipientOf(db, d.notification_id);
    const text = d.payload?.text;
    if (!r || !text) {
      await update(db, d.id, { status: 'skipped', lastError: 'no_text' });
      out.skipped++;
      continue;
    }
    if (r.userStatus !== 'active') {
      await update(db, d.id, { status: 'skipped', lastError: 'user_inactive' });
      out.skipped++;
      continue;
    }
    if (r.enabled === false) {
      await update(db, d.id, { status: 'skipped', lastError: 'preference_disabled' });
      out.skipped++;
      continue;
    }
    if (!(await canReceiveProjectNotification(db, r.userId, r.projectId))) {
      await update(db, d.id, { status: 'skipped', lastError: 'access_revoked' });
      out.skipped++;
      continue;
    }
    if (!r.phone) {
      await update(db, d.id, { status: 'skipped', lastError: 'no_whatsapp' });
      out.skipped++;
      continue;
    }
    if (!BYPASS_QUIET.has(r.event as EventKey) && (r.quietEnabled ?? true)) {
      const until = quietUntil(now, r.quietStart ?? '21:00', r.quietEnd ?? '07:00');
      if (until) {
        await update(db, d.id, { scheduledFor: until });
        out.deferred++;
        continue;
      }
    }
    if ((await sentToday(db, r.userId, now)) >= WA_DAILY_CAP) {
      await update(db, d.id, { status: 'skipped', lastError: 'rate_cap' });
      out.skipped++;
      continue;
    }

    const attempts = d.attempts + 1;
    try {
      const res = await wa.sendText(r.phone, text, d.id);
      await update(db, d.id, {
        status: 'sent',
        sentAt: now,
        attempts,
        providerMessageId: res.id,
        lastError: null,
      });
      out.sent++;
    } catch (err) {
      const message = String((err as Error).message ?? err).slice(0, 500);
      const delay = RETRY_MINUTES[attempts - 1];
      if (err instanceof WaPermanentError || delay === undefined) {
        await update(db, d.id, { status: 'failed', attempts, lastError: message });
        out.failed++;
        logger.warn({ delivery: d.id, err: message }, 'WhatsApp gagal dikirim');
      } else {
        await update(db, d.id, {
          attempts,
          lastError: message,
          scheduledFor: new Date(now.getTime() + delay * 60_000),
        });
        out.retry++;
      }
    }
  }
  return out;
}
