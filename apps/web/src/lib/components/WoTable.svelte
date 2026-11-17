<script lang="ts">
  import { WO_STATUS_LABEL, type WoStatus } from '@rein/shared';
  import { resolve } from '$app/paths';
  import { shortDate } from '$lib/format';
  import type { WoRow } from '$lib/types';
  import { flip } from 'svelte/animate';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Progress from './Progress.svelte';
  import StatusIcon from './StatusIcon.svelte';
  import Tag from './Tag.svelte';

  /**
   * Worklist Table (Figma D/05 Table, M/05): baris 44 px, dikelompokkan per status (opsional).
   * Mobile: baris bertumpuk (judul di atas, meta di bawah).
   */
  interface Props {
    rows: WoRow[];
    group?: boolean;
  }
  let { rows, group = true }: Props = $props();

  const ORDER: WoStatus[] = ['in_progress', 'review', 'todo', 'backlog', 'done', 'canceled'];
  const groups = $derived(
    group
      ? ORDER.map((s) => ({ status: s, items: rows.filter((r) => r.status === s) })).filter(
          (g) => g.items.length,
        )
      : [{ status: null as WoStatus | null, items: rows }],
  );
  let closed = $state<Record<string, boolean>>({ done: true, canceled: true });
</script>

<div class="tbl" role="table" aria-label="Worklist">
  <div class="thead" role="row">
    <span role="columnheader">Work Order</span>
    <span role="columnheader">Jenis</span>
    <span role="columnheader">PIC</span>
    <span role="columnheader">Deadline</span>
    <span role="columnheader">Progres</span>
  </div>
  {#each groups as g (g.status ?? 'all')}
    {#if g.status}
      <button
        class="grp"
        class:closed={closed[g.status]}
        onclick={() => (closed[g.status!] = !closed[g.status!])}
        aria-expanded={!closed[g.status]}
      >
        <Icon name="chevron-down" size={14} class="chev" />
        <StatusIcon status={g.status} />
        {WO_STATUS_LABEL[g.status]}<span class="n">{g.items.length}</span>
      </button>
    {/if}
    <div class="rows" class:closed={g.status ? closed[g.status] : false}>
      <div>
        {#each g.items as w (w.id)}
          <a
            class="wr"
            class:done={w.status === 'done' || w.status === 'canceled'}
            href={resolve('/(app)/w/[id]', { id: w.id })}
            role="row"
            animate:flip={{ duration: 200 }}
          >
            <span class="nm" role="cell">
              <StatusIcon status={w.status} />
              <span class="no tnum">{w.numberLabel}</span>
              <b>{w.title}</b>
              {#if w.urgent}<span class="urg" title="Urgent">!</span>{/if}
              {#if w.helpOpen}<span class="flag" title="Butuh bantuan"
                  ><Icon name="flag" size={12} /></span
                >{/if}
            </span>
            <span class="cell" role="cell"><Tag category={w.type.category}>{w.type.name}</Tag></span
            >
            <span class="cell" role="cell">
              <Avatar name={w.assignee.fullName} src={w.assignee.avatarUrl} size={20} />
              <span class="ell">{w.assignee.fullName.split(' ')[0]}</span>
            </span>
            <span class="cell tnum" class:late={w.overdue} role="cell">
              <Icon name="calendar" size={12} />{shortDate(w.deadline)}
            </span>
            <span class="cell prog" role="cell">
              <Progress value={w.status === 'done' ? 100 : w.progress} />
              <span class="tnum faint pc">{w.status === 'done' ? 100 : w.progress}%</span>
            </span>
          </a>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .tbl {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-bg-surface);
  }
  .thead,
  .wr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 150px 120px 84px 120px;
    gap: 12px;
    align-items: center;
    padding: 0 16px;
  }
  .thead {
    height: 32px;
    border-bottom: 1px solid var(--color-border-default);
    font: var(--text-label);
    color: var(--color-text-tertiary);
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 16px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .grp :global(.chev) {
    transition: transform 0.2s var(--ease);
    color: var(--color-icon-default);
  }
  .grp.closed :global(.chev) {
    transform: rotate(-90deg);
  }
  .n {
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
  .rows {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.25s var(--ease);
  }
  .rows > div {
    overflow: hidden;
  }
  .rows.closed {
    grid-template-rows: 0fr;
  }
  .wr {
    height: 44px;
    border-bottom: 1px solid var(--color-border-default);
    color: inherit;
    text-decoration: none;
    transition: background var(--dur);
  }
  .wr:hover {
    background: var(--color-bg-hover);
    text-decoration: none;
  }
  .wr.done b {
    color: var(--color-text-secondary);
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .nm b {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .no {
    color: var(--color-text-tertiary);
    font-size: 12px;
    flex: none;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .ell {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .late {
    color: var(--color-danger-default);
  }
  .prog .pc {
    font-size: 12px;
    width: 32px;
    text-align: right;
  }
  .urg {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--color-danger-default);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .flag {
    flex: none;
    color: var(--color-danger-default);
    display: inline-flex;
  }
  @media (max-width: 767px) {
    .tbl {
      border-radius: 0;
      border-left: 0;
      border-right: 0;
    }
    .thead {
      display: none;
    }
    .wr {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'nm nm' 'type due';
      height: auto;
      padding: 10px 16px;
      row-gap: 6px;
    }
    .wr > :nth-child(1) {
      grid-area: nm;
    }
    .wr > :nth-child(2) {
      grid-area: type;
    }
    .wr > :nth-child(4) {
      grid-area: due;
    }
    .wr > :nth-child(3),
    .wr > :nth-child(5) {
      display: none;
    }
  }
</style>
