<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { NavItem, PaletteItem } from '$lib/nav';
  import { effectiveTheme, toggleTheme } from '$lib/theme.svelte';
  import BottomNav from './BottomNav.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import Icon from './Icon.svelte';
  import MobileAppBar from './MobileAppBar.svelte';
  import Sidebar from './Sidebar.svelte';

  /** Kerangka aplikasi gaya Linear: sidebar 240 px + kolom utama; bottom nav di < 768 px. */
  interface Props {
    user: {
      fullName: string;
      nickname?: string | null;
      roleName: string;
      avatarUrl?: string | null;
    };
    isAdmin?: boolean;
    title: string;
    crumbs?: Array<{ label: string; href?: string }>;
    back?: string;
    actions?: Snippet;
    onlogout?: () => void;
    /** Jumlah notifikasi belum dibaca (badge sidebar & bottom nav, FR-080). */
    unread?: number;
    /** Menu Admin sesuai izin (dihitung layout). */
    adminLinks?: NavItem[];
    children: Snippet;
  }
  let {
    user,
    isAdmin = false,
    unread = 0,
    adminLinks,
    title,
    crumbs = [],
    back,
    actions,
    onlogout,
    children,
  }: Props = $props();

  let paletteOpen = $state(false);

  const badge = $derived(unread > 0 ? unread : undefined);
  const nav = $derived<NavItem[]>([
    { href: resolve('/'), label: 'Beranda', icon: 'home' },
    { href: resolve('/tugas'), label: 'Tugas saya', icon: 'check' },
    { href: resolve('/notifikasi'), label: 'Notifikasi', icon: 'bell', badge },
    { href: resolve('/project'), label: 'Project', icon: 'folder' },
  ]);
  const bottom = $derived<NavItem[]>([
    { href: resolve('/'), label: 'Beranda', icon: 'home' },
    { href: resolve('/tugas'), label: 'Tugas', icon: 'check' },
    { href: resolve('/project'), label: 'Project', icon: 'folder' },
    { href: resolve('/notifikasi'), label: 'Notifikasi', icon: 'bell', badge },
    { href: resolve('/profil'), label: 'Profil', icon: 'user' },
  ]);
  const adminItems = $derived<NavItem[]>(
    adminLinks ??
      (isAdmin ? [{ href: resolve('/admin/pengguna'), label: 'Pengguna', icon: 'users' }] : []),
  );

  const paletteItems = $derived<PaletteItem[]>([
    ...[
      ...nav,
      { href: resolve('/profil'), label: 'Profil & keamanan', icon: 'user' as const },
      ...adminItems,
    ].map((n) => ({
      id: `go-${n.href}`,
      group: 'Navigasi',
      label: n.label,
      icon: n.icon,
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- n.href sudah hasil resolve()
      run: () => goto(n.href),
    })),
    {
      id: 'theme',
      group: 'Aksi',
      label: 'Ganti tema',
      hint: effectiveTheme() === 'dark' ? 'ke terang' : 'ke gelap',
      icon: 'moon',
      kbd: '⇧ D',
      run: () => toggleTheme(),
    },
    ...(onlogout
      ? [{ id: 'logout', group: 'Aksi', label: 'Keluar', icon: 'logout' as const, run: onlogout }]
      : []),
  ]);

  function typing(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
    } else if (e.key === '/' && !typing(e.target) && !paletteOpen) {
      e.preventDefault();
      paletteOpen = true;
    } else if (e.shiftKey && e.key === 'D' && !typing(e.target)) {
      toggleTheme();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <div class="side">
    <Sidebar {user} items={nav} {adminItems} onpalette={() => (paletteOpen = true)} {onlogout} />
  </div>
  <main class="main">
    <header class="topbar">
      <div class="crumb">
        {#each crumbs as c (c.label)}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
          {#if c.href}<a href={c.href}>{c.label}</a>{:else}<span>{c.label}</span>{/if}
          <Icon name="chevron-right" size={14} />
        {/each}
        <b>{title}</b>
      </div>
      <div class="tb-actions">
        {#if actions}{@render actions()}{/if}
        <button
          class="ibtn"
          aria-label="Command palette (Ctrl K)"
          title="Command palette (Ctrl K)"
          onclick={() => (paletteOpen = true)}
        >
          <Icon name="search" />
        </button>
        <button
          class="ibtn"
          aria-label="Ganti tema"
          title="Ganti tema (Shift D)"
          onclick={(e) => toggleTheme(e.currentTarget)}
        >
          <Icon name={effectiveTheme() === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
    <div class="mbar"><MobileAppBar {title} {back} {actions} /></div>
    <section class="view">{@render children()}</section>
  </main>
  <div class="bnav"><BottomNav items={bottom} /></div>
</div>

<CommandPalette bind:open={paletteOpen} items={paletteItems} />

<style>
  .app {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    height: 100dvh;
  }
  .side {
    display: contents;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--color-bg-surface);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 48px;
    flex: none;
    padding: 0 16px 0 24px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--color-text-secondary);
  }
  .crumb a {
    color: inherit;
    white-space: nowrap;
  }
  .crumb b {
    font-weight: 500;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tb-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ibtn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-md);
    color: var(--color-icon-default);
    transition:
      background var(--dur),
      color var(--dur);
  }
  .ibtn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .mbar,
  .bnav {
    display: none;
  }
  .view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
  }
  @media (max-width: 767px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .side :global(.sidebar),
    .topbar {
      display: none;
    }
    .mbar,
    .bnav {
      display: block;
    }
  }
</style>
