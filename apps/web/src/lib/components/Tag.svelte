<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { WoCategory } from '@rein/shared';
  import CategoryDot from './CategoryDot.svelte';

  let { category, children }: { category?: WoCategory; children: Snippet } = $props();
</script>

<span class="tag">
  {#if category}<CategoryDot {category} />{/if}
  <span class="t">{@render children()}</span>
</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    max-width: 100%;
    padding: 0 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    font: var(--text-label);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
