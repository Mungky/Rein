/**
 * Outbox notifikasi (PRD §6.2): baris `notifications` (in-app) dan `notification_deliveries`
 * dibuat DI TRANSAKSI YANG SAMA dengan perubahan data. Worker (deliver.ts) yang mengirim.
 * Kanal mengikuti preferensi per akun; worker melewati email bila layanan belum aktif.
 */
import type { Db } from '../db/client';
import {
  notificationDeliveries,
  notifications,
  userSettings,
  users as userTable,
  rolePermissions,
  userPermissions,
  projectMembers,
} from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { can } from '@rein/shared';

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

/** Event yang tersedia pada kanal email (PRD §6.1). */
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
  let users = [...new Set([...input.recipients].filter((u): u is string => Boolean(u)))].filter(
    (u) => u !== input.actorId,
  );
  if (!users.length) return [];
  if (input.projectId) {
    const recipients = await tx
      .select({
        id: userTable.id,
        status: userTable.status,
        base: rolePermissions.scope,
        override: userPermissions.scope,
      })
      .from(userTable)
      .leftJoin(
        rolePermissions,
        and(
          eq(rolePermissions.roleId, userTable.roleId),
          eq(rolePermissions.permissionKey, 'project.view'),
        ),
      )
      .leftJoin(
        userPermissions,
        and(
          eq(userPermissions.userId, userTable.id),
          eq(userPermissions.permissionKey, 'project.view'),
        ),
      )
      .where(inArray(userTable.id, users));
    const members = await tx
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, input.projectId), inArray(projectMembers.userId, users)),
      );
    users = recipients
      .filter((r) =>
        can(
          {
            id: r.id,
            status: r.status,
            permissions: { 'project.view': r.override ?? r.base ?? 'none' },
          },
          'project.view',
          {
            project: {
              isMember: members.some((m) => m.userId === r.id),
              isManager: members.some((m) => m.userId === r.id && m.isProjectManager),
            },
          },
        ),
      )
      .map((r) => r.id);
    if (!users.length) return [];
  }
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
    .returning({ id: notifications.id, userId: notifications.userId });
  const settings = await tx.select().from(userSettings).where(inArray(userSettings.userId, users));

  const deliveries: Array<typeof notificationDeliveries.$inferInsert> = [];
  for (const r of rows) {
    const preference = settings.find((s) => s.userId === r.userId);
    if (WA_EVENTS.has(input.event) && input.waText) {
      deliveries.push({
        notificationId: r.id,
        channel: 'whatsapp',
        status: preference?.notifyWhatsapp === false ? 'skipped' : 'queued',
        lastError: preference?.notifyWhatsapp === false ? 'preference_disabled' : null,
        payload: { text: input.waText.slice(0, 1024) },
      });
    }
    if (EMAIL_EVENTS.has(input.event)) {
      deliveries.push({
        notificationId: r.id,
        channel: 'email',
        status: preference?.notifyEmail === false ? 'skipped' : 'queued',
        lastError: preference?.notifyEmail === false ? 'preference_disabled' : null,
      });
    }
  }
  if (deliveries.length) {
    await tx.insert(notificationDeliveries).values(deliveries).onConflictDoNothing();
  }
  return users;
}
