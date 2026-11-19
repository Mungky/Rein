<script lang="ts">
  import { todayWib } from '@rein/shared';
  import { resolve } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { api, ApiError } from '$lib/api';
  import { dayLabel } from '$lib/format';
  import { onLive } from '$lib/live.svelte';
  import Button from './Button.svelte';
  import PeriodPicker, { type Period } from './PeriodPicker.svelte';

  interface Activity {
    id: string;
    happenedAt: string;
    actor: string;
    text: string;
    projectId: string;
    projectName: string;
    woId: string | null;
    woLabel: string | null;
    noteId: string | null;
    subject: string | null;
    detail: string | null;
    target: 'materials' | 'files' | null;
  }
  let { woId, projectId }: { woId?: string; projectId?: string } = $props();
  let period = $state<Period>('week');
  let date = $state(todayWib());
  let page = $state(1);
  let items = $state<Activity[]>([]);
  let hasNext = $state(false);
  let loading = $state(true);
  let error = $state('');
  let revision = $state(0);

  const unsubscribe = onLive((event) => {
    if (page !== 1 || (projectId && 'projectId' in event && event.projectId !== projectId)) return;
    if (event.type === 'wo' && (!woId || event.woId === woId)) revision++;
    if (event.type === 'project' && !woId) revision++;
  });
  onDestroy(unsubscribe);

  const time = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });

  function link(item: Activity) {
    if (item.target)
      return resolve('/(app)/project/[id]', { id: item.projectId }) + '?tab=' + item.target;
    if (item.woId) {
      const url = resolve('/(app)/w/[id]', { id: item.woId });
      return item.noteId
        ? url + '?catatan=' + encodeURIComponent(item.noteId)
        : url + '?tab=activity';
    }
    return resolve('/(app)/project/[id]', { id: item.projectId });
  }

  function setPeriod(nextPeriod: Period, nextDate: string) {
    period = nextPeriod;
    date = nextDate;
    page = 1;
  }

  $effect(() => {
    void revision;
    const query = new SvelteURLSearchParams({ period, date, page: String(page) });
    if (woId) query.set('wo', woId);
    if (projectId) query.set('project', projectId);
    const request = new AbortController();
    loading = true;
    error = '';
    api<{ items: Activity[]; hasNext: boolean }>(`/api/activity?${query}`, {
      signal: request.signal,
    })
      .then((result) => {
        if (request.signal.aborted) return;
        items = result.items;
        hasNext = result.hasNext;
      })
      .catch((err: unknown) => {
        if (!request.signal.aborted)
          error = err instanceof ApiError ? err.message : 'Aktivitas gagal dimuat.';
      })
      .finally(() => {
        if (!request.signal.aborted) loading = false;
      });
    return () => request.abort();
  });
</script>

<section aria-label="Daftar aktivitas">
  <div class="tools">
    <PeriodPicker {period} {date} onchange={setPeriod} showAll />
    <Button icon="refresh" disabled={loading} onclick={() => revision++}>Muat ulang</Button>
  </div>
  {#if loading}
    <p class="state muted" role="status">Memuat aktivitas…</p>
  {:else if error}
    <p class="state" role="alert">{error}</p>
  {:else if !items.length}
    <p class="state muted">Belum ada aktivitas pada periode ini.</p>
  {:else}
    <ul class="activity">
      {#each items as item, i (item.id)}
        {@const label = dayLabel(item.happenedAt)}
        {#if i === 0 || dayLabel(items[i - 1]!.happenedAt) !== label}
          <li class="day"><h2>{label}</h2></li>
        {/if}
        <li class="event">
          <time datetime={item.happenedAt}>{time.format(new Date(item.happenedAt))}</time>
          <div>
            <p><b>{item.actor}</b> {item.text}</p>
            {#if item.detail}<p class="detail">{item.detail}</p>{/if}
            {#if item.target || (!woId && (!projectId || item.woId))}
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- link() memakai resolve() -->
              <a href={link(item)}
                >{(projectId
                  ? [item.woLabel, item.subject]
                  : [item.projectName, item.woLabel, item.subject]
                )
                  .filter(Boolean)
                  .join(' · ') || (item.target === 'materials' ? 'Material' : 'Dokumen')}</a
              >
            {:else if item.subject}
              <p class="muted">{item.subject}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  {#if page > 1 || hasNext}
    <nav class="pages" aria-label="Halaman aktivitas">
      <Button disabled={page === 1 || loading} icon="chevron-left" onclick={() => page--}
        >Sebelumnya</Button
      >
      <span>Halaman {page}</span>
      <Button disabled={!hasNext || loading} icon="chevron-right" onclick={() => page++}
        >Berikutnya</Button
      >
    </nav>
  {/if}
</section>

<style>
  .tools,
  .pages {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tools {
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .pages {
    justify-content: center;
    margin-top: 16px;
  }
  .state {
    margin: 18px 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .day {
    background: var(--color-bg-subtle);
    padding: 7px 12px;
  }
  .day h2 {
    font: var(--text-label);
    margin: 0;
  }
  .event {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-default);
  }
  time {
    font: var(--text-caption);
    color: var(--color-text-secondary);
    padding-top: 2px;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .event a {
    display: inline-block;
    margin-top: 2px;
    font: var(--text-caption);
    overflow-wrap: anywhere;
  }
  .detail {
    margin-top: 4px;
    white-space: pre-wrap;
  }
</style>
