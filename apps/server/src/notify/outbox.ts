/**
 * Outbox notifikasi (PRD §6.2): baris `notifications` (in-app) dan `notification_deliveries`
 * dibuat DI TRANSAKSI YANG SAMA dengan perubahan data. Worker (deliver.ts) yang mengirim.
 * Keputusan D1/D4 (docs/M1-RENCANA.md): email ditunda → delivery email dicatat `skipped`.
 */
import type { Db } from '../db/client';
import { notificationDeliveries, notifications } from '../db/schema';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const EVENT_KEYS = [
  'wo.assigned',
  'wo.unassigned',
  'help.requested',
  'help.resolved',
  'wo.deadline_h1',
  'wo.overdue',
  'wo.updated',
  'wo.status_changed',
  'logbook.created',
  'project.member_added',
  'project.status_changed',
] as const;
export type EventKey = (typeof EVENT_KEYS)[number];

/** Event yang dikirim lewat WhatsApp di M1 (keputusan D4). */
export const WA_EVENTS: ReadonlySet<EventKey> = new Set([
  'wo.assigned',
  'help.requested',
  'help.resolved',
  'wo.deadline_h1',
  'wo.overdue',
  'project.member_added',
]);

/** Event yang default-nya punya kanal email (PRD §6.1) — dicatat `skipped` selama email ditunda. */
export const EMAIL_EVENTS: ReadonlySet<EventKey> = new Set([
  'wo.assigned',
  'wo.unassigned',
  'help.requested',
  'help.resolved',
  'wo.deadline_h1',
  'wo.overdue',
  'wo.updated',
  'wo.status_changed',
  'project.member_added',
  'project.status_changed',
]);

/** Event yang menembus jam tenang (PRD §6.4). */
export const BYPASS_QUIET: ReadonlySet<EventKey> = new Set(['help.requested']);

export interface NotifyInput {
  event: EventKey;
  recipients: Iterable<string | null | undefined>;
  /** Aktor tidak menerima notifikasi atas tindakannya sendiri. */
  actorId?: string | null;
  projectId?: string | null;
  entityType: 'wo' | 'project' | 'help_request';
  entityId: string;
  title: string;
  body: string;
  /** Path internal, mis. `/w/<id>` — tautan absolut dibuat worker dari APP_URL. */
  url: string;
  /** Teks WhatsApp (PRD §6.3); wajib untuk event WA. */
  waText?: string;
}

/** Simpan notifikasi + delivery; kembalikan user yang menerima (untuk dorongan SSE setelah commit). */
export async function enqueueNotifications(tx: Tx | Db, input: NotifyInput): Promise<string[]> {
  const users = [...new Set([...input.recipients].filter((u): u is string => Boolean(u)))].filter(
    (u) => u !== input.actorId,
  );
  if (!users.length) return [];
  const rows = await tx
    .insert(notifications)
    .values(
      users.map((userId) => ({
        userId,
        eventKey: input.event,
        projectId: input.projectId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 500),
        url: input.url,
      })),
    )
    .returning({ id: notifications.id });

  const deliveries: Array<typeof notificationDeliveries.$inferInsert> = [];
  for (const r of rows) {
    if (WA_EVENTS.has(input.event) && input.waText) {
      deliveries.push({
        notificationId: r.id,
        channel: 'whatsapp',
        status: 'queued',
        payload: { text: input.waText.slice(0, 1024) },
      });
    }
    if (EMAIL_EVENTS.has(input.event)) {
      deliveries.push({
        notificationId: r.id,
        channel: 'email',
        status: 'skipped',
        lastError: 'email_disabled',
      });
    }
  }
  if (deliveries.length) {
    await tx.insert(notificationDeliveries).values(deliveries).onConflictDoNothing();
  }
  return users;
}
