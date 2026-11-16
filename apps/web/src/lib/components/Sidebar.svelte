<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { NavItem } from '$lib/nav';
  import { effectiveTheme, theme, toggleTheme } from '$lib/theme.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Kbd from './Kbd.svelte';

  interface Props {
    user: {
      fullName: string;
      nickname?: string | null;
      roleName: string;
      avatarUrl?: string | null;
    };
    items: NavItem[];
    adminItems?: NavItem[];
    onpalette?: () => void;
    onlogout?: () => void;
  }
  let { user, items, adminItems = [], onpalette, onlogout }: Props = $props();

  const isDark = $derived(theme.pref !== undefined && effectiveTheme() === 'dark');

  function active(href: string): boolean {
    const p = page.url.pathname;
    return href === '/' ? p === '/' : p === href || p.startsWith(`${href}/`);
  }
</script>

<aside class="sidebar" aria-label="Navigasi">
  <div class="ws"><span class="logo">R</span>REIN<span class="org">Remula</span></div>
  <button class="search" onclick={onpalette}>
    <Icon name="search" /><span>Cari atau perintah…</span><Kbd>Ctrl K</Kbd>
  </button>

  <nav class="grp">
    {#each items as it (it.href)}
      <!-- eslint-disable svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
      <a
        class="nav"
        class:on={active(it.href)}
        href={it.href}
        aria-current={active(it.href) ? 'page' : undefined}
      >
        <Icon name={it.icon} />{it.label}
        {#if it.badge}<span class="badge">{it.badge}</span>{:else if it.count != null}<span
            class="count">{it.count}</span
          >{/if}
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {/each}
  </nav>

  {#if adminItems.length}
    <div class="sec">Admin</div>
    <nav class="grp">
      {#each adminItems as it (it.href)}
        <!-- eslint-disable svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
        <a
          class="nav"
          class:on={active(it.href)}
          href={it.href}
          aria-current={active(it.href) ? 'page' : undefined}
        >
          <Icon name={it.icon} />{it.label}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {/each}
    </nav>
  {/if}

  <div class="flex"></div>
  <button class="nav" onclick={(e) => toggleTheme(e.currentTarget)}>
    <Icon name={isDark ? 'sun' : 'moon'} />{isDark ? 'Tema terang' : 'Tema gelap'}
  </button>
  {#if onlogout}
    <button class="nav" onclick={onlogout}><Icon name="logout" />Keluar</button>
  {/if}
  <a class="me" href={resolve('/profil')}>
    <Avatar name={user.fullName} src={user.avatarUrl} size={24} />
    <span class="who"
      ><b>{user.nickname ?? user.fullName}</b><span class="faint">{user.roleName}</span></span
    >
  </a>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 12px 8px;
    background: var(--color-bg-app);
    border-right: 1px solid var(--color-border-default);
  }
  .ws {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    font-weight: 600;
    font-size: 14px;
  }
  .org {
    margin-left: auto;
    font-weight: 400;
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .logo {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--color-accent-default);
    color: var(--color-text-on-accent);
    font-size: 11px;
    font-weight: 600;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    margin: 4px 0 8px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-tertiary);
    text-align: left;
    transition: border-color var(--dur);
  }
  .search:hover {
    border-color: var(--color-border-strong);
  }
  .search span {
    flex: 1;
  }
  .grp {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-weight: 500;
    text-align: left;
    text-decoration: none;
    transition:
      background var(--dur),
      color var(--dur);
  }
  .nav:hover,
  .nav.on {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--color-text-tertiary);
  }
  .badge {
    margin-left: auto;
    display: grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--color-accent-default);
    color: var(--color-text-on-accent);
    font-size: 11px;
  }
  .sec {
    padding: 16px 8px 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-tertiary);
  }
  .flex {
    flex: 1;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
  }
  .me:hover {
    background: var(--color-bg-hover);
    text-decoration: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 16px;
  }
  .who b {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who span {
    font-size: 12px;
  }
</style>
