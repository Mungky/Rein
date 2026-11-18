<script lang="ts">
  import { WO_CATEGORY_META } from '@rein/shared';
  import { resolve } from '$app/paths';
  import type { WoRow } from '$lib/types';
  import { shortDate } from '$lib/format';
  import { SvelteDate } from 'svelte/reactivity';
  import Button from './Button.svelte';
  import StatusIcon from './StatusIcon.svelte';
  let { rows }: { rows: WoRow[] } = $props();
  let scale = $state<'week' | 'month'>('week');
  let page = $state(0);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const day = (value: string) => Date.parse(value) / 86_400_000;
  const sorted = $derived(rows);
  const shown = $derived(sorted.slice(page * 300, (page + 1) * 300));
  const start = $derived(Math.min(day(today), ...rows.map((w) => day(w.plannedStart))) - 1);
  const end = $derived(Math.max(day(today), ...rows.map((w) => day(w.deadline))) + 2);
  const span = $derived(Math.max(1, end - start));
  const x = (value: string) => ((day(value) - start) / span) * 900;
  const ticks = $derived.by(() => {
    const result: number[] = [];
    if (scale === 'week') {
      const step = Math.max(7, Math.ceil(span / 12 / 7) * 7);
      for (let t = start; t <= end; t += step) result.push(t);
    } else {
      const date = new SvelteDate(start * 86_400_000);
      date.setUTCDate(1);
      if (day(date.toISOString().slice(0, 10)) < start) date.setUTCMonth(date.getUTCMonth() + 1);
      while (date.getTime() / 86_400_000 <= end) {
        result.push(date.getTime() / 86_400_000);
        date.setUTCMonth(date.getUTCMonth() + Math.max(1, Math.ceil(span / 365)));
      }
    }
    return result;
  });
  $effect(() => {
    if (page * 300 >= rows.length) page = 0;
  });
</script>

<div class="controls">
  <span class="faint">Mulai rencana → deadline · garis biru: hari ini</span>
  <div>
    <button
      class:on={scale === 'week'}
      aria-pressed={scale === 'week'}
      onclick={() => (scale = 'week')}>Minggu</button
    ><button
      class:on={scale === 'month'}
      aria-pressed={scale === 'month'}
      onclick={() => (scale = 'month')}>Bulan</button
    >
  </div>
</div>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Area jadwal dapat digulir dengan keyboard) -->
<div class="scroll" tabindex="0" role="region" aria-label="Timeline Work Order">
  <div class="timeline">
    <div class="labels">
      <div class="heading">Work Order</div>
      {#each shown as wo (wo.id)}<a href={resolve('/(app)/w/[id]', { id: wo.id })}
          ><StatusIcon status={wo.status} /><span class="number">{wo.numberLabel}</span><span
            class="name">{wo.title}</span
          ></a
        >{/each}
    </div>
    <svg
      viewBox={`0 0 900 ${28 + shown.length * 36}`}
      role="img"
      aria-label="Jadwal dan progres WO, garis hari ini"
    >
      <rect class="header" x="0" y="0" width="900" height="28" />
      {#each ticks as tick (tick)}
        <line
          class="grid"
          x1={((tick - start) / span) * 900}
          x2={((tick - start) / span) * 900}
          y1="0"
          y2={28 + shown.length * 36}
        />
        <text x={((tick - start) / span) * 900 + 6} y="18"
          >{new Intl.DateTimeFormat('id-ID', {
            day: scale === 'week' ? 'numeric' : undefined,
            month: 'short',
            year: scale === 'month' ? 'numeric' : undefined,
            timeZone: 'UTC',
          }).format(new Date(tick * 86_400_000))}</text
        >
      {/each}
      {#each shown as wo, index (wo.id)}
        {@const barWidth = Math.max(4, x(wo.deadline) - x(wo.plannedStart))}
        {@const progress = wo.status === 'done' ? 100 : wo.progress}
        <line class="grid" x1="0" x2="900" y1={28 + index * 36} y2={28 + index * 36} />
        <a
          href={resolve('/(app)/w/[id]', { id: wo.id })}
          aria-label={`${wo.numberLabel} ${wo.title}, ${shortDate(wo.plannedStart)} sampai ${shortDate(wo.deadline)}, ${progress}%`}
        >
          <rect
            class="bar"
            class:done={wo.status === 'done' || wo.status === 'canceled'}
            x={x(wo.plannedStart)}
            y={36 + index * 36}
            width={barWidth}
            height="20"
            rx="3"
            style:--category={`var(${WO_CATEGORY_META[wo.type.category].token})`}
            stroke={wo.overdue
              ? 'var(--color-danger-default)'
              : `var(${WO_CATEGORY_META[wo.type.category].token})`}
          />
          <rect
            class="fill"
            x={x(wo.plannedStart)}
            y={36 + index * 36}
            width={(barWidth * progress) / 100}
            height="20"
            rx="3"
            fill={wo.status === 'done'
              ? 'var(--color-text-tertiary)'
              : `var(${WO_CATEGORY_META[wo.type.category].token})`}
          />
          <title>{wo.assignee.fullName} · {progress}%</title>
        </a>
      {/each}
      <line class="today" x1={x(today)} x2={x(today)} y1="28" y2={28 + shown.length * 36} />
    </svg>
  </div>
</div>
{#if rows.length > 300}<div class="pages">
    <Button disabled={!page} onclick={() => page--}>Sebelumnya</Button><span
      >{page * 300 + 1}–{Math.min((page + 1) * 300, rows.length)} dari {rows.length} WO</span
    ><Button disabled={(page + 1) * 300 >= rows.length} onclick={() => page++}>Berikutnya</Button>
  </div>{/if}

<style>
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default);
    font: var(--text-caption);
  }
  .controls button {
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }
  .controls button.on {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .scroll {
    overflow: auto;
  }
  .timeline {
    display: grid;
    grid-template-columns: 260px minmax(600px, 1fr);
    min-width: 900px;
  }
  .heading {
    height: 28px;
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
    padding: 6px 20px;
    font: var(--text-caption);
  }
  .labels {
    border-right: 1px solid var(--color-border-default);
  }
  .labels a {
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-top: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .labels a:hover {
    background: var(--color-bg-hover);
  }
  .number {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
    flex: none;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  svg {
    width: 100%;
    height: 100%;
    min-height: 28px;
  }
  text {
    fill: var(--color-text-tertiary);
    font: 11px var(--font-sans);
  }
  .grid {
    stroke: var(--color-border-default);
    stroke-width: 1;
  }
  .header {
    fill: var(--color-bg-subtle);
  }
  .bar {
    fill: var(--color-bg-subtle);
    stroke-width: 1;
  }
  .bar.done {
    fill: var(--color-bg-hover);
  }
  .fill {
    opacity: 0.3;
    pointer-events: none;
  }
  .today {
    stroke: var(--color-accent-default);
    stroke-width: 1.5;
  }
  .pages {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 12px;
  }
</style>
