<script lang="ts" generics="T extends string">
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';

  /** Pilihan tampilan (Table/Kanban) dengan pill yang bergeser (Figma `Segmented`). */
  interface Props {
    value: T;
    options: Array<{ value: T; label: string; icon?: IconName }>;
    label?: string;
  }
  let { value = $bindable(), options, label = 'Tampilan' }: Props = $props();
  const idx = $derived(
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
</script>

<div class="seg" role="tablist" aria-label={label} style:--n={options.length} style:--i={idx}>
  {#each options as o (o.value)}
    <button
      role="tab"
      aria-selected={o.value === value}
      class:on={o.value === value}
      onclick={() => (value = o.value)}
    >
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}<span>{o.label}</span>
    </button>
  {/each}
  <span class="pill" aria-hidden="true"></span>
</div>

<style>
  .seg {
    --item-width: 84px;
    position: relative;
    display: inline-grid;
    grid-template-columns: repeat(var(--n), var(--item-width));
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-default);
  }
  button {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font: var(--text-label);
    transition: color var(--dur);
  }
  button.on {
    color: var(--color-text-primary);
  }
  .pill {
    position: absolute;
    z-index: 0;
    top: 2px;
    left: calc(2px + var(--i) * (var(--item-width) + 2px));
    width: var(--item-width);
    height: 24px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-1);
    transition: left 0.22s var(--ease);
  }
  @media (max-width: 767px) {
    .seg {
      --item-width: 68px;
    }
    button {
      height: 44px;
      padding: 0 4px;
      gap: 4px;
      font-size: 11px;
    }
    .pill {
      height: 44px;
    }
  }
</style>
