<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { onLive } from '$lib/live.svelte';
  import type { HomeData } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import NotificationInbox from '$lib/components/NotificationInbox.svelte';
  import WoTable from '$lib/components/WoTable.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';
  import { session } from '$lib/session.svelte';

  let home = $state<HomeData | null>(null);
  let error = $state('');
  let loading = $state(true);
  let showAll = $state(false);
  async function load() {
    error = '';
    try {
      home = await api<HomeData>('/api/home', { account: session.me?.user.id });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Beranda gagal dimuat.';
    } finally {
      loading = false;
    }
  }
  let moreBusy = $state(false);
  async function moreTasks() {
    if (!home || moreBusy) return;
    if (showAll && home.nextOffset === null) {
      showAll = false;
      return;
    }
    showAll = true;
    if (home.nextOffset === null) return;
    moreBusy = true;
    try {
      const result = await api<HomeData>(`/api/home?offset=${home.nextOffset}&limit=30`);
      home = {
        ...result,
        tasks: [
          ...new Map([...home.tasks, ...result.tasks].map((task) => [task.id, task])).values(),
        ],
      };
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Tugas gagal dimuat.';
    } finally {
      moreBusy = false;
    }
  }
  onMount(() => {
    void load();
    const refreshed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === '/api/home') void load();
    };
    window.addEventListener('rein:cache-updated', refreshed);
    return () => window.removeEventListener('rein:cache-updated', refreshed);
  });
  onDestroy(
    onLive((e) => {
      if (e.type === 'wo' || e.type === 'project') void load();
    }),
  );
  const hour = new Date().getHours();
  const greeting =
    hour < 11
      ? 'Selamat pagi'
      : hour < 15
        ? 'Selamat siang'
        : hour < 18
          ? 'Selamat sore'
          : 'Selamat malam';
  const firstName = $derived(
    session.me?.user.nickname ?? session.me?.user.fullName.split(' ')[0] ?? '',
  );
  const today = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());

  const stats: Array<{
    key: keyof HomeData['stats'];
    label: string;
    icon: IconName;
    danger?: boolean;
    sub: string;
  }> = [
    { key: 'myTasks', label: 'Tugas saya', icon: 'check', sub: 'WO aktif' },
    { key: 'urgent', label: 'Urgent', icon: 'alert', danger: true, sub: 'perlu segera' },
    { key: 'dueSoon', label: 'Jatuh tempo 7 hari', icon: 'calendar', sub: 'deadline dekat' },
    { key: 'help', label: 'Butuh bantuan', icon: 'flag', danger: true, sub: 'permintaan terbuka' },
  ];
</script>

<svelte:head><title>Beranda · REIN</title></svelte:head>

<div class="pad">
  <header>
    <h1>{greeting}, {firstName}</h1>
    <p class="muted">{today}</p>
  </header>

  <div class="stats">
    {#each stats as s (s.label)}
      <div class="stat" class:danger={s.danger}>
        <span class="lb"><Icon name={s.icon} size={14} />{s.label}</span>
        <span class="v tnum">{home ? home.stats[s.key] : '—'}</span>
        <span class="s">{s.sub}</span>
      </div>
    {/each}
  </div>

  {#if error}<p role="alert">{error} <Button onclick={load}>Coba lagi</Button></p>{/if}
  {#if home?.help.length}
    <section>
      <h2>Butuh perhatian</h2>
      {#each home.help as item (item.woId)}<a
          class="help"
          href={resolve('/(app)/w/[id]', { id: item.woId })}
          ><Icon name="flag" /><span
            ><b>{item.requestedBy} butuh bantuan · {item.numberLabel} — {item.title}</b><small
              >{item.excerpt}</small
            ></span
          ><span class="help-link">Buka WO</span></a
        >{/each}
    </section>
  {/if}
  <section id="tugas">
    <div class="section-head">
      <h2>Tugas saya <span class="faint">{home?.stats.myTasks ?? ''}</span></h2>
      {#if (home?.stats.myTasks ?? 0) > 10}<Button
          variant="ghost"
          loading={moreBusy}
          onclick={moreTasks}
          >{showAll
            ? home?.nextOffset !== null
              ? 'Muat tugas berikutnya'
              : 'Ringkas'
            : 'Lihat semua'}</Button
        >{/if}
    </div>
    <div class="box" class:has-tasks={!!home?.tasks.length}>
      {#if loading}<p class="loading" role="status">Memuat tugas…</p>
      {:else if home?.tasks.length}<WoTable
          group={false}
          rows={showAll ? home.tasks : home.tasks.slice(0, 10)}
        />
      {:else if !error}<EmptyState
          icon="check"
          title="Belum ada tugas"
          message="Work Order yang ditugaskan kepada Anda akan muncul di sini."
        />{/if}
    </div>
  </section>
  <NotificationInbox />
</div>

<style>
  .box.has-tasks {
    border: 0;
  }
  .stat.danger .v {
    color: var(--color-danger-default);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .section-head h2 span {
    margin-left: 8px;
    font: var(--text-caption);
  }
  .help {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--color-danger-subtle);
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .help > :global(svg) {
    flex: none;
    color: var(--color-danger-default);
  }
  .help > span:first-of-type {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .help b {
    font: var(--text-label);
  }
  .help small {
    font: var(--text-caption);
    color: var(--color-text-secondary);
  }
  .help-link {
    color: var(--color-accent-default);
    font: var(--text-caption);
  }
  .loading {
    padding: 20px;
  }

  .pad {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px 32px 32px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
  }
  .lb {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .v {
    font: var(--text-display);
  }
  .s {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
  .stat.danger .lb :global(svg) {
    color: var(--color-danger-default);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .box {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  @media (max-width: 767px) {
    .pad {
      padding: 16px 16px 24px;
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
