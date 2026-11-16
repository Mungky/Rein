import { EventEmitter } from 'node:events';

/**
 * Bus in-process untuk dorongan real-time (SSE, FR-080). Cukup karena REIN berjalan satu
 * proses (PRD §10.2). Dipanggil SETELAH transaksi commit agar klien tidak membaca data lama.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export type BusEvent =
  | { type: 'notification' }
  | { type: 'wo'; woId: string; projectId: string }
  | { type: 'project'; projectId: string };

export function publishToUsers(userIds: Iterable<string>, event: BusEvent): void {
  const ids = new Set(userIds);
  for (const id of ids) emitter.emit(`user:${id}`, event);
  // Notifikasi baru mungkin membawa delivery WA `queued` → bangunkan worker tanpa menunggu cron.
  if (event.type === 'notification' && ids.size) emitter.emit('deliver');
}

/** Dipakai worker kirim (jobs.ts) untuk mengirim segera setelah transaksi commit. */
export function onDeliveryKick(fn: () => void): () => void {
  emitter.on('deliver', fn);
  return () => emitter.off('deliver', fn);
}

export function subscribeUser(userId: string, fn: (e: BusEvent) => void): () => void {
  const key = `user:${userId}`;
  emitter.on(key, fn);
  return () => emitter.off(key, fn);
}
