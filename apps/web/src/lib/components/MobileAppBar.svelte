<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /** App bar mobile 52 px (Figma `Mobile App Bar`): tombol kembali opsional, judul, aksi. */
  interface Props {
    title: string;
    back?: string;
    actions?: Snippet;
  }
  let { title, back, actions }: Props = $props();
</script>

<header class="appbar">
  {#if back}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
    <a class="ib" href={back} aria-label="Kembali"><Icon name="chevron-left" size={20} /></a>
  {/if}
  <span class="title">{title}</span>
  {#if actions}<div class="act">{@render actions()}</div>{/if}
</header>

<style>
  .appbar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: calc(52px + env(safe-area-inset-top, 0px));
    padding: env(safe-area-inset-top, 0px) max(8px, env(safe-area-inset-right, 0px)) 0
      max(16px, env(safe-area-inset-left, 0px));
    border-bottom: 1px solid var(--color-border-default);
    background: var(--color-bg-surface);
    flex: none;
  }
  .ib {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-left: -12px;
    color: var(--color-text-primary);
  }
  .title {
    flex: 1;
    min-width: 0;
    font: var(--text-heading-16);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 4px;
  }
</style>
