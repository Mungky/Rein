<script lang="ts">
  import { page } from '$app/state';
  import type { NavItem } from '$lib/nav';
  import Icon from './Icon.svelte';

  /** Bottom nav 5 tab untuk < 768 px (Figma `Bottom Nav`). */
  let { items }: { items: NavItem[] } = $props();

  function active(href: string): boolean {
    const p = page.url.pathname;
    return href === '/' ? p === '/' : p === href || p.startsWith(`${href}/`);
  }
</script>

<nav class="bottomnav" aria-label="Navigasi utama">
  {#each items as it (it.href)}
    <!-- eslint-disable svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
    <a
      href={it.href}
      class:on={active(it.href)}
      aria-current={active(it.href) ? 'page' : undefined}
    >
      <Icon name={it.icon} size={20} />
      <span>{it.label}</span>
      {#if it.badge}<span class="badge">{it.badge}</span>{/if}
    </a>
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  {/each}
</nav>

<style>
  .bottomnav {
    display: flex;
    justify-content: space-around;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--color-border-default);
    background: var(--color-bg-surface);
  }
  a {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 64px;
    min-height: 44px;
    font-size: 11px;
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color var(--dur);
  }
  a:hover {
    text-decoration: none;
  }
  a.on {
    color: var(--color-accent-default);
  }
  .badge {
    position: absolute;
    top: 0;
    left: 36px;
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--color-accent-default);
    color: #fff;
    font-size: 10px;
  }
</style>
