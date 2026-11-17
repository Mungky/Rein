<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { dur, easeOut } from '$lib/motion';
  import { dismissToast, toasts } from '$lib/toast.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each toasts as t (t.id)}
    <div
      class="toast"
      class:danger={t.tone === 'danger'}
      role={t.tone === 'danger' ? 'alert' : 'status'}
      animate:flip={{ duration: dur(200) }}
      in:fly={{ y: 12, duration: dur(280), easing: easeOut }}
      out:fly={{ x: 16, duration: dur(200) }}
    >
      <Icon name={t.icon} />
      <span class="msg">{t.message}</span>
      {#if t.link}
        <button
          class="lk"
          onclick={() => {
            t.link?.onclick();
            dismissToast(t.id);
          }}>{t.link.label}</button
        >
      {/if}
      <button class="x" aria-label="Tutup" onclick={() => dismissToast(t.id)}>
        <Icon name="x" size={14} />
      </button>
      <span class="tbar" style:animation-duration="{t.duration}ms"></span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: max(16px, env(safe-area-inset-right, 0px));
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    position: relative;
    overflow: hidden;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(440px, calc(100vw - 32px));
    padding: 8px 8px 8px 12px;
    border-radius: var(--radius-lg);
    background: var(--color-bg-overlay);
    color: var(--color-toast-fg);
    box-shadow: var(--shadow-2);
  }
  .toast.danger :global(svg) {
    color: var(--color-danger-default);
  }
  .msg {
    flex: 1;
    min-width: 0;
  }
  .lk {
    color: var(--color-toast-link);
    font-weight: 500;
    white-space: nowrap;
  }
  .x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    opacity: 0.7;
  }
  .x:hover {
    opacity: 1;
  }
  .tbar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--color-accent-default);
    animation: tbar linear forwards;
  }
  @keyframes tbar {
    from {
      width: 100%;
    }
    to {
      width: 0;
    }
  }
  @media (max-width: 767px) {
    .toasts {
      left: 16px;
      right: 16px;
      align-items: stretch;
      bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    }
    .toast {
      max-width: none;
    }
  }
</style>
