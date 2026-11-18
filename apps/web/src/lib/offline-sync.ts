import { api, ApiError } from './api';
import { prepareAttachment } from './attach';
import { attachmentForm, type UploadResult } from './upload';
import { listQueue, readBinding, removeQueued, saveQueued } from './offline-store';

export const OUTBOX_EVENT = 'rein-outbox';

async function sync(origin: string, account: string) {
  const result = { changed: false, retry: false };
  const items = (await listQueue(account)).filter((row) => row.state === 'pending');
  if (!items.length) return result;
  const me = await api<{ user: { id: string }; locked: boolean; verification: { any: boolean } }>(
    origin + '/api/auth/me',
    { account },
  );
  if (me.user.id !== account || me.locked || !me.verification.any) return result;
  for (const item of items) {
    if ((await readBinding())?.account !== account) break;
    try {
      if (item.kind === 'logbook') {
        while (item.files.length) {
          const [file, ...remaining] = item.files;
          const input = await prepareAttachment(file!, { ownerType: 'user', ownerId: account });
          if ((await readBinding())?.account !== account) return result;
          const response = await fetch(origin + '/api/attachments', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'x-requested-with': 'rein', 'x-rein-account': account },
            body: attachmentForm(input),
            signal: AbortSignal.timeout(60_000),
          }).catch(() => {
            throw new ApiError(0, 'NETWORK', 'Sambungan terputus saat mengunggah.');
          });
          if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new ApiError(
              response.status,
              data?.error?.code ?? 'UPLOAD_FAILED',
              data?.error?.message ?? 'Lampiran gagal dikirim',
            );
          }
          const { id } = (await response.json()) as UploadResult;
          item.body.attachmentIds.push(id);
          item.files = remaining;
          await saveQueued(item);
        }
      }
      if ((await readBinding())?.account !== account) break;
      await api(origin + `/api/work-orders/${item.woId}/${item.kind}`, {
        account,
        body: item.body,
      });
      await removeQueued(account, item.id);
      result.changed = true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 423)) break;
      if (
        err instanceof ApiError &&
        (err.status === 0 || err.status === 429 || err.status >= 500)
      ) {
        result.retry = true;
        break;
      }
      item.state = err instanceof ApiError && err.code === 'STALE' ? 'conflict' : 'failed';
      item.error = err instanceof Error ? err.message : 'Sinkronisasi gagal.';
      await saveQueued(item);
      result.changed = true;
    }
  }
  return result;
}

export async function syncOutbox(origin: string) {
  const binding = await readBinding();
  const empty = { changed: false, retry: false };
  if (!binding) return empty;
  const run = () =>
    sync(origin, binding.account).catch((err: unknown) => ({
      changed: false,
      retry: !(err instanceof ApiError && (err.status === 401 || err.status === 423)),
    }));
  if (!navigator.locks) return run();
  return navigator.locks.request(OUTBOX_EVENT, { ifAvailable: true }, (lock) =>
    lock ? run() : empty,
  );
}
