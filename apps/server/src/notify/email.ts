import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { safeNextPath } from '@rein/shared';
import type { Deps } from '../context';
import {
  notificationDeliveries,
  notifications,
  userContacts,
  userSettings,
  users,
} from '../db/schema';
import { quietUntil } from '../lib/format';
import { notificationMail } from '../mail/templates';
import { claimDeliveries, RETRY_MINUTES, type DeliverResult } from './deliver';
import { BYPASS_QUIET, type EventKey } from './outbox';
import { canReceiveProjectNotification } from './access';

export async function deliverEmail(
  deps: Pick<Deps, 'db' | 'mail' | 'env' | 'logger'>,
  now = new Date(),
): Promise<DeliverResult> {
  const { db, mail, env } = deps;
  const out: DeliverResult = { sent: 0, skipped: 0, failed: 0, retry: 0, deferred: 0 };
  for (const delivery of await claimDeliveries(db, now, 'email')) {
    const n = await db.query.notifications.findFirst({
      where: eq(notifications.id, delivery.notification_id),
    });
    const user = n ? await db.query.users.findFirst({ where: eq(users.id, n.userId) }) : null;
    const settings = user
      ? await db.query.userSettings.findFirst({ where: eq(userSettings.userId, user.id) })
      : null;
    const contact = user
      ? await db.query.userContacts.findFirst({
          where: and(
            eq(userContacts.userId, user.id),
            eq(userContacts.kind, 'email'),
            isNotNull(userContacts.verifiedAt),
          ),
          orderBy: desc(userContacts.isPrimary),
        })
      : null;
    const update = (patch: Partial<typeof notificationDeliveries.$inferInsert>) =>
      db
        .update(notificationDeliveries)
        .set(patch)
        .where(eq(notificationDeliveries.id, delivery.id));
    const skip =
      !user || user.status !== 'active'
        ? 'user_inactive'
        : settings?.notifyEmail === false
          ? 'preference_disabled'
          : !contact
            ? 'no_email'
            : mail.name === 'null'
              ? 'email_disabled'
              : null;
    if (skip || !n || !contact) {
      await update({ status: 'skipped', lastError: skip ?? 'no_email' });
      out.skipped++;
      continue;
    }
    if (!(await canReceiveProjectNotification(db, n.userId, n.projectId))) {
      await update({ status: 'skipped', lastError: 'access_revoked' });
      out.skipped++;
      continue;
    }
    if (!BYPASS_QUIET.has(n.eventKey as EventKey) && (settings?.quietEnabled ?? true)) {
      const until = quietUntil(now, settings?.quietStart ?? '21:00', settings?.quietEnd ?? '07:00');
      if (until) {
        await update({ scheduledFor: until });
        out.deferred++;
        continue;
      }
    }
    const attempts = delivery.attempts + 1;
    try {
      const link = new URL(safeNextPath(n.url), env.APP_URL).href;
      const sent = await mail.send({
        to: contact.value,
        ...notificationMail(n.title, n.body, link),
      });
      await update({
        status: 'sent',
        attempts,
        sentAt: now,
        providerMessageId: sent.id,
        lastError: null,
      });
      out.sent++;
    } catch (err) {
      const delay = RETRY_MINUTES[attempts - 1];
      await update({
        status: delay === undefined ? 'failed' : 'queued',
        attempts,
        lastError: String(err).slice(0, 500),
        ...(delay !== undefined ? { scheduledFor: new Date(now.getTime() + delay * 60_000) } : {}),
      });
      if (delay === undefined) out.failed++;
      else out.retry++;
    }
  }
  return out;
}
