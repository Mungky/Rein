/**
 * Antrean job pg-boss (PRD §10.2, keputusan D7): tanpa Redis, semua di Postgres.
 *  - `wa-deliver`: cron tiap menit (retry 1/5/30 menit, akhir jam tenang) + dorongan langsung
 *    setelah transaksi yang membuat notifikasi (notify/bus.ts → onDeliveryKick).
 *  - `daily-reminders`: 07:00 Asia/Jakarta (wo.deadline_h1, wo.overdue).
 * REIN berjalan satu proses, jadi putaran kirim cukup diserialkan di memori.
 */
import { PgBoss } from 'pg-boss';
import type { Deps } from './context';
import { onDeliveryKick } from './notify/bus';
import { runDailyReminders } from './notify/daily';
import { deliverWhatsApp } from './notify/deliver';

const Q_DELIVER = 'wa-deliver';
const Q_DAILY = 'daily-reminders';

export interface Jobs {
  stop(): Promise<void>;
}

export async function startJobs(deps: Deps): Promise<Jobs> {
  const { logger } = deps;
  const boss = new PgBoss({ connectionString: deps.env.DATABASE_URL, max: 2 });
  boss.on('error', (err: unknown) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await boss.createQueue(Q_DELIVER);
  await boss.createQueue(Q_DAILY);
  await boss.schedule(Q_DELIVER, '* * * * *');
  await boss.schedule(Q_DAILY, '0 7 * * *', null, { tz: 'Asia/Jakarta' });

  let running: Promise<void> | null = null;
  let again = false;
  const deliver = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        const r = await deliverWhatsApp(deps);
        if (r.sent || r.failed || r.retry) logger.info(r, 'putaran kirim WhatsApp');
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  await boss.work(Q_DELIVER, async () => {
    await deliver();
  });
  await boss.work(Q_DAILY, async () => {
    const r = await runDailyReminders({ db: deps.db, appUrl: deps.env.APP_URL });
    logger.info(r, 'job pengingat harian');
    await deliver();
  });

  let timer: NodeJS.Timeout | null = null;
  const off = onDeliveryKick(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      deliver().catch((err: unknown) => logger.error({ err }, 'kirim WhatsApp gagal'));
    }, 250);
  });

  return {
    async stop() {
      off();
      if (timer) clearTimeout(timer);
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
