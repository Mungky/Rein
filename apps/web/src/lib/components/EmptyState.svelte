<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';

  /** Empty state umum (Figma D/11b, M/11b): ikon, judul, pesan, CTA opsional. */
  interface Props {
    icon?: IconName;
    title: string;
    message?: string;
    children?: Snippet;
  }
  let { icon = 'layers', title, message, children }: Props = $props();
</script>

<div class="empty">
  <span class="ic"><Icon name={icon} size={20} /></span>
  <h2>{title}</h2>
  {#if message}<p>{message}</p>{/if}
  {@render children?.()}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 72px 24px;
    text-align: center;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-subtle);
    color: var(--color-icon-default);
  }
  p {
    max-width: 380px;
    color: var(--color-text-secondary);
  }
</style>
