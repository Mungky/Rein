import type { LogbookCreateInput, WoStatus } from '@rein/shared';

export type OfflineBinding = { account: string; until: number };
export type QueuedMutation = {
  account: string;
  id: string;
  woId: string;
  title: string;
  createdAt: string;
  state: 'pending' | 'conflict' | 'failed';
  error?: string;
} & (
  | { kind: 'logbook'; body: LogbookCreateInput; files: File[] }
  | {
      kind: 'status';
      body: { clientId: string; status: WoStatus; expectedUpdatedAt: string; reason?: string };
    }
);

let connection: Promise<IDBDatabase> | undefined;

function open() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('rein-offline', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('scope');
      request.result.createObjectStore('outbox', { keyPath: ['account', 'id'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
  }));
}

async function access<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}

export async function readBinding(): Promise<OfflineBinding | null> {
  const binding = (await access('scope', 'readonly', (store) =>
    store.get('current'),
  )) as OfflineBinding | null;
  return binding && binding.until > Date.now() ? binding : null;
}

export function saveBinding(binding: OfflineBinding | null) {
  return access('scope', 'readwrite', (store) => store.put(binding, 'current'));
}

export function privateCache(account: string) {
  return `rein-private-${account}`;
}

export async function listQueue(account: string): Promise<QueuedMutation[]> {
  const keys = IDBKeyRange.bound([account, ''], [account, '\uffff']);
  const rows = (await access('outbox', 'readonly', (store) =>
    store.getAll(keys),
  )) as QueuedMutation[];
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveQueued(row: QueuedMutation) {
  return access('outbox', 'readwrite', (store) => store.put(row));
}

export function removeQueued(account: string, id: string) {
  return access('outbox', 'readwrite', (store) => store.delete([account, id]));
}
