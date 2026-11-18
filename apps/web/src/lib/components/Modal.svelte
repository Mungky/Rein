<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { dur, easeOut } from '$lib/motion';
  import Icon from './Icon.svelte';

  /**
   * Modal (desktop) yang otomatis menjadi Bottom Sheet di < 768 px (prototype .modal / sheetIn).
   * Esc menutup, fokus terkunci di dalam, fokus dikembalikan saat ditutup.
   */
  interface Props {
    open?: boolean;
    title: string;
    width?: number;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { open = $bindable(false), title, width = 640, onclose, children, footer }: Props = $props();

  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  let panel = $state<HTMLElement>();

  function close() {
    open = false;
    onclose?.();
  }

  function isMobile() {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches;
  }

  function sheet(_node: Element) {
    const mobile = isMobile();
    return {
      duration: dur(mobile ? 280 : 200),
      easing: easeOut,
      css: (t: number, u: number) =>
        mobile
          ? `transform: translateY(${u * 100}%)`
          : `opacity: ${t}; transform: translateY(${u * 8}px) scale(${0.98 + 0.02 * t})`,
    };
  }

  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function focusables(root: HTMLElement) {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
    );
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab' || !panel) return;
    const items = focusables(panel);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open || !panel) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const body = panel.querySelector<HTMLElement>('.m-b');
    const target =
      panel.querySelector<HTMLElement>('[autofocus]') ?? (body && focusables(body)[0]) ?? panel;
    target.focus();
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  });
</script>

{#if open}
  <div
    class="scrim"
    role="presentation"
    transition:fade={{ duration: dur(150) }}
    onclick={(e) => e.target === e.currentTarget && close()}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      style:--w="{width}px"
      bind:this={panel}
      transition:sheet
      {onkeydown}
    >
      <header class="m-h">
        <h2 id={titleId}>{title}</h2>
        <button class="close" aria-label="Tutup" onclick={close}><Icon name="x" /></button>
      </header>
      <div class="m-b">{@render children()}</div>
      {#if footer}<footer class="m-f">{@render footer()}</footer>{/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 96px 16px 16px;
    background: var(--color-scrim);
  }
  .modal {
    width: min(var(--w), 100%);
    max-height: calc(100% - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-2);
    outline: none;
  }
  .m-h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .m-h h2 {
    flex: 1;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    color: var(--color-icon-default);
  }
  .close:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .m-b {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px;
    overflow: auto;
  }
  .m-f {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
    padding: 12px 20px;
    background: var(--color-bg-subtle);
    border-top: 1px solid var(--color-border-default);
  }
  @media (max-width: 767px) {
    .scrim {
      align-items: flex-end;
      padding: 0;
    }
    .modal {
      width: 100%;
      max-height: 92%;
      border-radius: 16px 16px 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .m-h::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 6px;
      width: 36px;
      height: 4px;
      margin-left: -18px;
      border-radius: 2px;
      background: var(--color-border-strong);
    }
    .m-h {
      position: relative;
      padding-top: 18px;
    }
    .close {
      width: 44px;
      height: 44px;
    }
  }
</style>
