<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { safeNextPath } from '@rein/shared';
  import { api, ApiError } from '$lib/api';
  import { stamp } from '$lib/format';
  import { live, onLive, setUnread } from '$lib/live.svelte';
  import type { NotificationItem } from '$lib/types';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';

  let tab = $state('all');
  const tabs = [
    { value: 'all', label: 'Semua' },
    { value: 'unread', label: 'Belum dibaca' },
    { value: 'help', label: 'Butuh bantuan' },
    { value: 'mention', label: 'Disebut' },
  ];
  let items = $state<NotificationItem[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let request = 0;
  async function load(more = false) {
    const version = ++request;
    loading = true;
    error = '';
    try {
      const result = await api<{
        items: NotificationItem[];
        nextCursor: string | null;
        unread: number;
      }>(`/api/notifications?tab=${tab}${more && cursor ? `&before=${cursor}` : ''}`);
      if (version !== request) return;
      items = more ? [...items, ...result.items] : result.items;
      cursor = result.nextCursor;
      setUnread(result.unread);
    } catch (err) {
      if (version === request)
        error = err instanceof ApiError ? err.message : 'Notifikasi gagal dimuat.';
    } finally {
      if (version === request) loading = false;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(
    onLive((e) => {
      if (e.type === 'notification') void load();
    }),
  );
  async function readAll() {
    try {
      await api('/api/notifications/read-all', { body: {} });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal menandai notifikasi.';
    }
  }
  async function open(item: NotificationItem) {
    if (!item.readAt) {
      try {
        const result = await api<{ unread: number }>(`/api/notifications/${item.id}/read`, {
          body: {},
        });
        setUnread(result.unread);
        item.readAt = new Date().toISOString();
      } catch (err) {
        error = err instanceof ApiError ? err.message : 'Gagal menandai notifikasi.';
        return;
      }
    }
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- url API dibatasi ke path internal
    await goto(safeNextPath(item.url));
  }
</script>

<section id="notifikasi" aria-labelledby="inbox-title">
  <header>
    <h2 id="inbox-title">Notifikasi <span class="faint">{live.unread || ''}</span></h2>
    <Button variant="ghost" icon="check" disabled={!live.unread || loading} onclick={readAll}
      >Tandai semua dibaca</Button
    >
  </header>
  <div class="inbox">
    <div class="tabs" role="tablist" aria-label="Filter notifikasi">
      {#each tabs as option (option.value)}<button
          role="tab"
          aria-selected={tab === option.value}
          class:on={tab === option.value}
          onclick={() => {
            tab = option.value;
            void load();
          }}>{option.label}</button
        >{/each}
    </div>
    {#if error}<div class="error" role="alert">
        {error}<Button onclick={() => load()}>Coba lagi</Button>
      </div>{/if}
    {#if loading && !items.length}<p class="loading" role="status">Memuat notifikasi…</p>
    {:else if items.length}
      <ul>
        {#each items as item (item.id)}<li class:unread={!item.readAt}>
            <button class="notification" onclick={() => open(item)}>
              <span class="dot" aria-label={item.readAt ? 'Sudah dibaca' : 'Belum dibaca'}></span>
              <Icon name={item.event.startsWith('help.') ? 'flag' : 'bell'} size={16} />
              <span class="message"
                ><b>{item.title}</b><span
                  >{item.projectName ? item.projectName + ' · ' : ''}{item.body}</span
                ></span
              >
              <time datetime={item.createdAt}>{stamp(item.createdAt)}</time>
            </button>
          </li>{/each}
      </ul>
    {:else if !error}<EmptyState
        icon="bell"
        title="Tidak ada notifikasi"
        message={tab === 'all'
          ? 'Pembaruan project dan WO akan muncul di sini.'
          : 'Tidak ada notifikasi pada filter ini.'}
      />{/if}
    {#if cursor}<div class="more">
        <Button {loading} onclick={() => load(true)}>Muat lebih lama</Button>
      </div>{/if}
  </div>
</section>

<style>
  section {
    display: grid;
    gap: 12px;
    scroll-margin-top: 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  header h2 {
    font: var(--text-heading-14);
  }
  header h2 span {
    margin-left: 8px;
    font: var(--text-caption);
  }
  .inbox {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .tabs {
    display: flex;
    overflow-x: auto;
    gap: 16px;
    padding: 0 16px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .tabs button {
    flex: none;
    padding: 12px 0;
    border-bottom: 2px solid transparent;
    color: var(--color-text-secondary);
    font: var(--text-label);
  }
  .tabs button.on {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-text-primary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--color-border-default);
  }
  .notification {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 16px;
  }
  .notification:hover {
    background: var(--color-bg-hover);
  }
  .unread {
    background: var(--color-accent-subtle);
  }
  .dot {
    width: 5px;
    height: 5px;
    margin-top: 7px;
    flex: none;
    border-radius: 50%;
  }
  .unread .dot {
    background: var(--color-accent-default);
  }
  .notification :global(svg) {
    margin-top: 2px;
    color: var(--color-icon-default);
    flex: none;
  }
  .message {
    display: grid;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .message b {
    font-weight: 500;
  }
  .message > span,
  time {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
  .message > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  time {
    flex: none;
  }
  .loading,
  .error,
  .more {
    padding: 16px;
  }
  .error {
    color: var(--color-danger-default);
  }
  .more {
    display: flex;
    justify-content: center;
  }
  @media (max-width: 767px) {
    .notification {
      flex-wrap: wrap;
      gap: 8px;
    }
    time {
      margin-left: 42px;
      flex-basis: 100%;
    }
  }
</style>
