<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    checked?: boolean;
    disabled?: boolean;
    name?: string;
    children?: Snippet;
  }
  let { checked = $bindable(false), disabled = false, name, children }: Props = $props();
</script>

<label class="cb" class:disabled>
  <input type="checkbox" bind:checked {disabled} {name} />
  <span class="box" aria-hidden="true">
    <svg viewBox="0 0 16 16"><path d="M4 8.3l2.6 2.5L12 5.4" pathLength="12" /></svg>
  </span>
  {#if children}<span class="lb">{@render children()}</span>{/if}
</label>

<style>
  .cb {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    min-height: 20px;
  }
  .disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .box {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--color-border-strong);
    background: var(--color-bg-surface);
    display: grid;
    place-items: center;
    transition:
      background var(--dur),
      border-color var(--dur);
  }
  svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--color-text-on-accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 12;
    stroke-dashoffset: 12;
    transition: stroke-dashoffset 0.22s var(--ease);
  }
  input:checked + .box {
    background: var(--color-accent-default);
    border-color: var(--color-accent-default);
  }
  input:checked + .box svg {
    stroke-dashoffset: 0;
  }
  input:focus-visible + .box {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
  .lb {
    color: var(--color-text-primary);
  }
  @media (max-width: 767px) {
    .cb {
      min-height: 44px;
    }
  }
</style>
