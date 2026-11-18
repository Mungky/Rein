<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { chrome, resetChrome } from '$lib/chrome.svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import OfflineBanner from '$lib/components/OfflineBanner.svelte';
  import { live, setUnread, startLive, stopLive } from '$lib/live.svelte';
  import type { NavItem } from '$lib/nav';
  import { hasGlobal, logout, session } from '$lib/session.svelte';

  let { children } = $props();

  const TITLES: Record<string, string> = {
    '/': 'Beranda',
    '/tugas': 'Tugas saya',
    '/project': 'Project',
    '/aktivitas': 'Aktivitas',
    '/notifikasi': 'Notifikasi',
    '/profil': 'Profil & keamanan',
    '/admin/pengguna': 'Pengguna',
    '/admin/role': 'Role & izin',
    '/admin/jenis-wo': 'Jenis WO',
    '/admin/whatsapp': 'WhatsApp',
  };
  const title = $derived(chrome.title ?? TITLES[page.url.pathname] ?? 'REIN');
  const crumbs = $derived(
    chrome.title
      ? chrome.crumbs
      : page.url.pathname.startsWith('/admin')
        ? [{ label: 'Admin' }]
        : [],
  );

  const adminLinks = $derived<NavItem[]>([
    ...(hasGlobal('admin.users')
      ? [
          { href: resolve('/admin/pengguna'), label: 'Pengguna', icon: 'users' as const },
          { href: resolve('/admin/whatsapp'), label: 'WhatsApp', icon: 'bell' as const },
        ]
      : []),
    ...(hasGlobal('admin.roles')
      ? [{ href: resolve('/admin/role'), label: 'Role & izin', icon: 'shield' as const }]
      : []),
    ...(hasGlobal('admin.wo_types')
      ? [{ href: resolve('/admin/jenis-wo'), label: 'Jenis WO', icon: 'logbook' as const }]
      : []),
  ]);

  // FR-004: respons 423 di mana pun → layar PIN, lalu kembali ke halaman ini.
  function onLocked() {
    void goto(
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- path memakai resolve(), query next di-encode
      resolve('/kunci') + `?next=${encodeURIComponent(page.url.pathname + page.url.search)}`,
    );
  }

  onMount(() => {
    startLive();
    window.addEventListener('rein:locked', onLocked);
    void api<{ unread: number }>('/api/notifications/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  });
  onDestroy(() => {
    stopLive();
    if (typeof window !== 'undefined') window.removeEventListener('rein:locked', onLocked);
  });
  beforeNavigate(({ to, from }) => {
    if (to?.url.pathname !== from?.url.pathname) resetChrome();
  });

  async function onlogout() {
    stopLive();
    await logout();
    await goto(resolve('/masuk'));
  }
</script>

{#if session.me}
  <AppShell
    user={session.me.user}
    {adminLinks}
    {title}
    {crumbs}
    back={chrome.back ?? undefined}
    unread={live.unread}
    {onlogout}
  >
    <OfflineBanner account={session.me.user.id} />
    {@render children()}
  </AppShell>
{/if}
