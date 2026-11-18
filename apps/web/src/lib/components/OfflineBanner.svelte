<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { listQueue, removeQueued, saveQueued, type QueuedMutation } from '$lib/offline-store';
  import { OUTBOX_EVENT, syncOutbox } from '$lib/offline-sync';
  import { ACTIVE_ACCOUNT_KEY, loadMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import Button from './Button.svelte';

  let { account }: { account: string } = $props();
  let offline = $state(!navigator.onLine);
  let queued = $state<QueuedMutation[]>([]);
  let updating = false;

  async function refresh(sync = false) {
    offline = !navigator.onLine;
    if (sync && !offline && !updating) {
      updating = true;
      try {
        if ((await loadMe(true))?.user.id === account) {
          const result = await syncOutbox(location.origin);
          if (result.changed) reloadWork();
        } else location.reload();
      } catch {
        // Antrean tetap disimpan sampai autentikasi serta koneksi pulih.
      } finally {
        updating = false;
      }
    }
    queued = await listQueue(account).catch(() => []);
  }

  function reloadWork(path?: string) {
    if (!path || path.startsWith('/api/work-orders/')) {
      void invalidate('app:wo');
      void invalidate('app:project');
    }
    if (!path || path === '/api/home')
      window.dispatchEvent(new CustomEvent('rein:cache-updated', { detail: '/api/home' }));
  }

  onMount(() => {
    const up = () => void refresh(true);
    const down = () => void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') up();
    };
    const switched = (event: StorageEvent) => {
      if (event.key === ACTIVE_ACCOUNT_KEY && event.newValue !== account) location.reload();
    };
    const message = (event: MessageEvent) => {
      if (event.data?.type === 'rein:cache-updated') reloadWork(event.data.path);
      if (event.data?.type === 'rein:outbox-updated') {
        reloadWork();
        down();
      }
    };
    const connection = (
      navigator as Navigator & {
        connection?: EventTarget & { effectiveType?: string; rtt?: number };
      }
    ).connection;
    const slow = () => {
      if (
        connection &&
        (['slow-2g', '2g'].includes(connection.effectiveType ?? '') || (connection.rtt ?? 0) > 1500)
      )
        toast('Koneksi lambat. Ketuk thumbnail untuk membuka foto penuh.');
    };
    slow();
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener(OUTBOX_EVENT, up);
    window.addEventListener('storage', switched);
    document.addEventListener('visibilitychange', visible);
    navigator.serviceWorker?.addEventListener('message', message);
    connection?.addEventListener('change', slow);
    up();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener(OUTBOX_EVENT, up);
      window.removeEventListener('storage', switched);
      document.removeEventListener('visibilitychange', visible);
      navigator.serviceWorker?.removeEventListener('message', message);
      connection?.removeEventListener('change', slow);
    };
  });

  async function noteOnly(item: QueuedMutation) {
    if (item.kind !== 'logbook' || item.state !== 'conflict') return;
    const snapshot = $state.snapshot(item);
    const { progress: _progress, expectedUpdatedAt: _version, ...body } = snapshot.body;
    await saveQueued({ ...snapshot, body, state: 'pending', error: undefined });
    await refresh(true);
  }

  async function discard(item: QueuedMutation) {
    if (!window.confirm('Hapus perubahan ini dari antrean?')) return;
    await removeQueued(account, item.id);
    await refresh();
  }
</script>

{#if offline || queued.length}
  <div class="offline-banner">
    <p role="status">
      {#if offline}Anda offline. Data yang tersedia berasal dari versi tersimpan.
      {/if}
      {queued.filter((item) => item.state === 'pending').length} menunggu sinkron.
    </p>
    {#if queued.length}
      <details>
        <summary>Antrean sinkronisasi ({queued.length})</summary>
        <ul>
          {#each queued as item (item.id)}
            <li>
              <a href={resolve('/(app)/w/[id]', { id: item.woId })}>{item.title}</a>
              <span
                >{item.kind === 'logbook' ? 'Logbook' : 'Status'} ·
                {item.state === 'conflict'
                  ? 'Konflik — tinjau'
                  : item.state === 'failed'
                    ? 'Gagal dikirim'
                    : 'Menunggu sinkron'}
              </span>
              {#if item.error}<span>{item.error}</span>{/if}
              {#if item.state === 'conflict' && item.kind === 'logbook' && (item.body.body || item.body.attachmentIds.length)}
                <Button onclick={() => noteOnly(item)}>Kirim catatan saja</Button>
              {/if}
              {#if item.state !== 'pending'}<Button onclick={() => discard(item)}
                  >Hapus dari antrean</Button
                >{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

<style>
  .offline-banner {
    padding: 8px 16px;
    background: var(--color-accent-subtle);
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border-default);
  }
  ul {
    margin: 8px 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  summary {
    cursor: pointer;
  }
</style>
