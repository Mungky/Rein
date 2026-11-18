import type { WoStatus } from '@rein/shared';
import { api, ApiError } from './api';
import { readBinding, saveQueued, type QueuedMutation } from './offline-store';
import { OUTBOX_EVENT } from './offline-sync';

export async function enqueueOffline(item: QueuedMutation) {
  if ((await readBinding())?.account !== item.account) {
    throw new ApiError(
      0,
      'OFFLINE_UNAVAILABLE',
      'Masuk kembali di perangkat tepercaya untuk memakai antrean offline.',
    );
  }
  try {
    await saveQueued(item);
  } catch {
    throw new ApiError(
      0,
      'OFFLINE_STORAGE',
      'Antrean gagal disimpan. Periksa ruang penyimpanan perangkat.',
    );
  }
  window.dispatchEvent(new Event(OUTBOX_EVENT));
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.ready
      .then((registration) => {
        const sync = (
          registration as ServiceWorkerRegistration & {
            sync?: { register: (tag: string) => Promise<void> };
          }
        ).sync;
        return sync?.register(OUTBOX_EVENT);
      })
      .catch(() => {});
  }
}

export async function submitWoStatus(
  wo: { id: string; title: string; updatedAt: string },
  account: string,
  status: WoStatus,
  reason?: string,
) {
  const id = crypto.randomUUID();
  const body = { clientId: id, status, reason, expectedUpdatedAt: wo.updatedAt };
  if (navigator.onLine) {
    try {
      await api(`/api/work-orders/${wo.id}/status`, { account, body });
      return false;
    } catch (err) {
      if (navigator.onLine || !(err instanceof ApiError) || err.status !== 0) throw err;
    }
  }
  await enqueueOffline({
    account,
    id,
    woId: wo.id,
    title: wo.title,
    state: 'pending',
    kind: 'status',
    createdAt: new Date().toISOString(),
    body,
  });
  return true;
}
