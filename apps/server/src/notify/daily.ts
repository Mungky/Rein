/**
 * Job harian 07:00 WIB (PRD §6.1, keputusan D7):
 *  - `wo.deadline_h1`: WO yang deadline-nya besok → PIC (in-app + WA).
 *  - `wo.overdue`: WO lewat deadline 1–3 hari (sekali per hari, maks 3 hari) → PIC + pengelola
 *    project in-app; WA hanya ke PIC.
 * Hanya WO aktif (bukan Selesai/Batal) pada project berstatus Berjalan.
 * Idempoten per tanggal WIB lewat `system_state['daily_reminders']` di transaksi yang sama.
 */
import { WO_STATUS_LABEL, woNumberLabel, type WoStatus } from '@rein/shared';
import { and, between, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projectMembers, projects, workOrders } from '../db/schema';
import { longDate, wibDate } from '../lib/format';
import { publishToUsers } from './bus';
import { enqueueNotifications } from './outbox';

export const OVERDUE_MAX_DAYS = 3;

export interface DailyResult {
  ran: boolean;
  date: string;
  deadlineTomorrow: number;
  overdue: number;
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export async function runDailyReminders(
  deps: { db: Db; appUrl: string },
  now = new Date(),
): Promise<DailyResult> {
  const { db, appUrl } = deps;
  const today = wibDate(now);
  const tomorrow = wibDate(now, 1);
  const oldest = wibDate(now, -OVERDUE_MAX_DAYS);
  const notified = new Set<string>();

  const result = await db.transaction(async (tx) => {
    const guard = await tx.execute(sql`
      insert into system_state (key, value) values ('daily_reminders', ${JSON.stringify({ date: today })}::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
        where system_state.value->>'date' is distinct from ${today}
      returning key`);
    if (!guard.rows.length) return { ran: false, date: today, deadlineTomorrow: 0, overdue: 0 };

    const rows = await tx
      .select({
        id: workOrders.id,
        seq: workOrders.seq,
        title: workOrders.title,
        status: workOrders.status,
        progress: workOrders.progress,
        deadline: workOrders.deadline,
        assigneeId: workOrders.assigneeId,
        projectId: workOrders.projectId,
        projectName: projects.name,
      })
      .from(workOrders)
      .innerJoin(projects, eq(projects.id, workOrders.projectId))
      .where(
        and(
          isNull(workOrders.deletedAt),
          isNull(projects.deletedAt),
          eq(projects.status, 'active'),
          notInArray(workOrders.status, ['done', 'canceled']),
          between(workOrders.deadline, oldest, tomorrow),
        ),
      );

    const overdueRows = rows.filter((w) => w.deadline < today);
    const projectIds = [...new Set(overdueRows.map((w) => w.projectId))];
    const managers = new Map<string, string[]>();
    if (projectIds.length) {
      const ms = await tx
        .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            inArray(projectMembers.projectId, projectIds),
            eq(projectMembers.isProjectManager, true),
          ),
        );
      for (const m of ms)
        managers.set(m.projectId, [...(managers.get(m.projectId) ?? []), m.userId]);
    }

    let deadlineTomorrow = 0;
    let overdue = 0;
    for (const w of rows) {
      const label = woNumberLabel(w.seq);
      const status = WO_STATUS_LABEL[w.status as WoStatus];
      const link = `${appUrl}/w/${w.id}`;
      const base = {
        projectId: w.projectId,
        entityType: 'wo' as const,
        entityId: w.id,
        title: `${label} — ${w.title}`,
        url: `/w/${w.id}`,
      };
      if (w.deadline === tomorrow) {
        deadlineTomorrow++;
        const ids = await enqueueNotifications(tx, {
          ...base,
          event: 'wo.deadline_h1',
          recipients: [w.assigneeId],
          body: `Deadline besok · progres ${w.progress}% · ${status}`,
          waText: [
            'Pengingat deadline besok',
            `*${label} — ${w.title}*`,
            `Project: ${w.projectName}`,
            `Progres terakhir: ${w.progress}% · ${status}`,
            `Deadline: ${longDate(w.deadline)}`,
            `Isi logbook: ${link}`,
          ].join('\n'),
        });
        ids.forEach((u) => notified.add(u));
      } else if (w.deadline < today) {
        overdue++;
        const late = dayDiff(today, w.deadline);
        const body = `Lewat deadline ${late} hari · progres ${w.progress}% · ${status}`;
        const pic = await enqueueNotifications(tx, {
          ...base,
          event: 'wo.overdue',
          recipients: [w.assigneeId],
          body,
          waText: [
            `WO lewat deadline (${late} hari)`,
            `*${label} — ${w.title}*`,
            `Project: ${w.projectName}`,
            `Progres: ${w.progress}% · ${status}`,
            `Deadline: ${longDate(w.deadline)}`,
            `Buka WO: ${link}`,
          ].join('\n'),
        });
        // Pengelola: in-app saja (PRD §6.1 — WA untuk PIC saja).
        const mgr = await enqueueNotifications(tx, {
          ...base,
          event: 'wo.overdue',
          recipients: (managers.get(w.projectId) ?? []).filter((u) => u !== w.assigneeId),
          body,
        });
        [...pic, ...mgr].forEach((u) => notified.add(u));
      }
    }
    return { ran: true, date: today, deadlineTomorrow, overdue };
  });

  if (notified.size) publishToUsers(notified, { type: 'notification' });
  return result;
}
