<script lang="ts">
  import { WO_CATEGORY_META, WO_STATUS_LABEL, type WoStatus } from '@rein/shared';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { shortDate } from '$lib/format';
  import { prefersReducedMotion } from '$lib/motion';
  import type { WoRow } from '$lib/types';
  import { flip } from 'svelte/animate';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Progress from './Progress.svelte';
  import StatusIcon from './StatusIcon.svelte';
  import Tag from './Tag.svelte';

  /**
   * Kanban WO (Figma D/05 Kanban, M/05b; FR-032): seret kartu ke kolom lain untuk mengubah
   * status. Mouse: langsung seret. Sentuh: tekan-tahan 350 ms lalu seret (agar papan tetap
   * bisa digeser). Izin & state machine tetap diputuskan server; `onmove` dipanggil parent.
   */
  interface Props {
    rows: WoRow[];
    canDrag?: (w: WoRow, to: WoStatus) => boolean;
    onmove?: (w: WoRow, to: WoStatus) => void;
  }
  let { rows, canDrag = () => true, onmove }: Props = $props();

  const COLS: WoStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];
  const columns = $derived(COLS.map((s) => ({ status: s, items: rows.filter((r) => r.status === s) })));

  let drag = $state<{ w: WoRow; x: number; y: number; dx: number; dy: number; width: number } | null>(
    null,
  );
  let over = $state<WoStatus | null>(null);
  let pending: {
    w: WoRow;
    el: HTMLElement;
    x: number;
    y: number;
    id: number;
    timer?: ReturnType<typeof setTimeout>;
    touch: boolean;
  } | null = null;
  let moved = false;

  function begin(p: NonNullable<typeof pending>, x: number, y: number) {
    const r = p.el.getBoundingClientRect();
    drag = { w: p.w, x, y, dx: x - r.left, dy: y - r.top, width: r.width };
    over = p.w.status;
  }

  function down(e: PointerEvent, w: WoRow) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    moved = false;
    pending = { w, el, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
    if (pending.touch) {
      const p = pending;
      p.timer = setTimeout(() => {
        if (pending === p) {
          begin(p, p.x, p.y);
          navigator.vibrate?.(10);
        }
      }, 350);
    }
  }

  function move(e: PointerEvent) {
    if (!pending || e.pointerId !== pending.id) return;
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (!drag) {
      if (pending.touch) {
        if (dist > 8) cancel(); // pengguna menggeser papan
        return;
      }
      if (dist < 6) return;
      begin(pending, e.clientX, e.clientY);
    }
    moved = true;
    e.preventDefault();
    drag!.x = e.clientX;
    drag!.y = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-col]');
    over = (el?.dataset.col as WoStatus | undefined) ?? null;
  }

  function up(e: PointerEvent) {
    if (!pending || e.pointerId !== pending.id) return;
    const d = drag;
    const target = over;
    const w = pending.w;
    cancel();
    if (d && target && target !== w.status && moved) {
      if (canDrag(w, target)) onmove?.(w, target);
    } else if (!d) {
      void goto(resolve('/(app)/w/[id]', { id: w.id }));
    }
  }

  function cancel() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    drag = null;
    over = null;
  }

  // Cegah gulir halaman saat menyeret dengan sentuhan.
  function blockScroll(node: HTMLElement) {
    const h = (e: TouchEvent) => {
      if (drag) e.preventDefault();
    };
    node.addEventListener('touchmove', h, { passive: false });
    return { destroy: () => node.removeEventListener('touchmove', h) };
  }

  const dur = prefersReducedMotion() ? 0 : 220;
</script>

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={cancel} />

<div class="board" use:blockScroll>
  {#each columns as c (c.status)}
    <div
      class="col"
      class:over={drag && over === c.status && over !== drag.w.status}
      class:deny={drag && over === c.status && over !== drag.w.status && !canDrag(drag.w, c.status)}
      data-col={c.status}
    >
      <div class="col-h"><StatusIcon status={c.status} />{WO_STATUS_LABEL[c.status]}<span class="n">{c.items.length}</span></div>
      {#each c.items as w (w.id)}
        <div
          class="kc"
          class:src={drag?.w.id === w.id}
          class:done={w.status === 'done'}
          style:--c={`var(${WO_CATEGORY_META[w.type.category].token})`}
          role="link"
          tabindex="0"
          aria-label={`${w.numberLabel} ${w.title}`}
          onpointerdown={(e) => down(e, w)}
          onkeydown={(e) => e.key === 'Enter' && goto(resolve('/(app)/w/[id]', { id: w.id }))}
          animate:flip={{ duration: dur }}
        >
          {@render card(w)}
        </div>
      {/each}
    </div>
  {/each}
</div>

{#if drag}
  <div
    class="kc ghost"
    style:left={`${drag.x - drag.dx}px`}
    style:top={`${drag.y - drag.dy}px`}
    style:width={`${drag.width}px`}
    aria-hidden="true"
  >
    {@render card(drag.w)}
  </div>
{/if}

{#snippet card(w: WoRow)}
  <div class="top">
    <span class="tnum">{w.numberLabel}</span>
    {#if w.helpOpen}<span class="flag"><Icon name="flag" size={12} /></span>{/if}
    {#if w.urgent}<span class="urg">!</span>{/if}
  </div>
  <b>{w.title}</b>
  <Tag category={w.type.category}>{w.type.name}</Tag>
  <div class="m">
    <Avatar name={w.assignee.fullName} src={w.assignee.avatarUrl} size={20} />
    <span class:late={w.overdue}><Icon name="calendar" size={12} />{shortDate(w.deadline)}</span>
    <span class="pg"><Progress value={w.status === 'done' ? 100 : w.progress} width={40} /></span>
  </div>
{/snippet}

<style>
  .board {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    overflow-x: auto;
    align-items: flex-start;
    scroll-snap-type: x proximity;
    min-height: 360px;
  }
  .col {
    width: 252px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px;
    border-radius: var(--radius-lg);
    scroll-snap-align: start;
    min-height: 120px;
    transition:
      background var(--dur),
      box-shadow var(--dur);
  }
  .col.over {
    background: var(--color-accent-subtle);
    box-shadow: inset 0 0 0 1px var(--color-accent-default);
  }
  .col.deny {
    background: var(--color-bg-subtle);
    box-shadow: inset 0 0 0 1px var(--color-border-strong);
  }
  .col-h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    font-weight: 500;
  }
  .n {
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
  .kc {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 12px 15px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition:
      border-color var(--dur),
      opacity var(--dur);
  }
  /* Garis kiri 3 px warna kategori (PRD §9.9). */
  .kc::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--c);
  }
  .kc:hover {
    border-color: var(--color-border-strong);
  }
  .kc.src {
    opacity: 0.35;
  }
  .kc.done {
    opacity: 0.7;
  }
  .ghost {
    position: fixed;
    z-index: 60;
    pointer-events: none;
    cursor: grabbing;
    box-shadow: var(--shadow-2);
    transform: rotate(1.5deg) scale(1.03);
    transition: none;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .top .flag {
    margin-left: auto;
    color: var(--color-danger-default);
    display: inline-flex;
  }
  .top .urg {
    margin-left: auto;
  }
  .top .flag + .urg {
    margin-left: 0;
  }
  b {
    font-weight: 500;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .m {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .m span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .m .pg {
    margin-left: auto;
  }
  .late {
    color: var(--color-danger-default);
  }
  .urg {
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
  @media (max-width: 767px) {
    .board {
      padding: 12px 16px;
    }
    .col {
      width: 80vw;
      max-width: 300px;
    }
  }
</style>
