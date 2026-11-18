/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { privateCache, readBinding } from './lib/offline-store';
import { OUTBOX_EVENT, syncOutbox } from './lib/offline-sync';

const worker = self as unknown as ServiceWorkerGlobalScope;
const SHELL = `rein-shell-${version}`;
const assets = new Set([...build, ...files]);
const woRoute = /^\/api\/work-orders\/([0-9a-f-]{36})(?:\/logbook)?$/i;
const thumbRoute = /^\/files\/[0-9a-f-]{36}\/thumb$/i;

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(['/', ...assets]);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith('rein-shell-') && key !== SHELL)
          .map((key) => caches.delete(key)),
      );
      await worker.clients.claim();
    })(),
  );
});

async function inform(message: string, path?: string) {
  for (const client of await worker.clients.matchAll()) client.postMessage({ type: message, path });
}

async function trimPrivate(cache: Cache) {
  const keys = await cache.keys();
  const wo = new Map<string, Request[]>();
  const thumbs: Request[] = [];
  for (const key of keys) {
    const path = new URL(key.url).pathname;
    if (thumbRoute.test(path)) thumbs.push(key);
    const match = woRoute.exec(path);
    if (!match) continue;
    const id = match[1]!;
    const previous = wo.get(id) ?? [];
    wo.delete(id);
    wo.set(id, [...previous, key]);
  }
  const excess = [
    ...Array.from(wo.values())
      .slice(0, Math.max(0, wo.size - 50))
      .flat(),
    ...thumbs.slice(0, Math.max(0, thumbs.length - 250)),
  ];
  await Promise.all(excess.map((key) => cache.delete(key)));
}

async function privateResponse(event: FetchEvent, url: URL, thumb: boolean) {
  const { request } = event;
  const account = thumb
    ? url.searchParams.get('reinAccount')
    : request.headers.get('x-rein-account');
  if (!account || (await readBinding().catch(() => null))?.account !== account)
    return fetch(request);
  const cache = await caches.open(privateCache(account));
  const previous = await cache.match(request);
  if (thumb && previous) return previous;
  const previousForCompare = previous?.clone();
  const refresh = (async () => {
    const response = await fetch(request);
    if ((await readBinding())?.account !== account) return response;
    if (response.ok || (thumb && response.type === 'opaque')) {
      const changed =
        !thumb &&
        previousForCompare &&
        (await previousForCompare.text()) !== (await response.clone().text());
      try {
        await cache.delete(request);
        await cache.put(request, response.clone());
        await trimPrivate(cache);
      } catch {
        // Respons online tetap bisa dipakai ketika kuota cache perangkat habis.
      }
      if (changed) await inform('rein:cache-updated', url.pathname);
    } else if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 423
    ) {
      await cache.delete(request);
      if (previous) await inform('rein:cache-updated', url.pathname);
    }
    return response;
  })();
  if (previous) {
    event.waitUntil(refresh.catch(() => {}));
    return previous;
  }
  return refresh;
}

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== worker.location.origin) return;
  if (assets.has(url.pathname)) {
    event.respondWith(
      caches
        .open(SHELL)
        .then(async (cache) => (await cache.match(event.request)) ?? fetch(event.request)),
    );
  } else if (event.request.mode === 'navigate' && !/^\/(api|files|auth)\//.test(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await (await caches.open(SHELL)).match('/')) ?? Response.error(),
      ),
    );
  } else if (
    thumbRoute.test(url.pathname) ||
    (!url.search && (url.pathname === '/api/home' || woRoute.test(url.pathname)))
  ) {
    event.respondWith(privateResponse(event, url, thumbRoute.test(url.pathname)));
  }
});

type SyncEvent = ExtendableEvent & { tag: string };
worker.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag !== OUTBOX_EVENT) return;
  event.waitUntil(
    (async () => {
      const result = await syncOutbox(worker.location.origin);
      if (result.changed) await inform('rein:outbox-updated');
      if (result.retry) throw new Error('Sinkronisasi akan dicoba lagi');
    })(),
  );
}) as EventListener);
