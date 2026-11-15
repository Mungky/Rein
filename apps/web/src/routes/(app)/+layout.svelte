<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import AppShell from '$lib/components/AppShell.svelte';
  import { hasGlobal, logout, session } from '$lib/session.svelte';

  let { children } = $props();

  const TITLES: Record<string, string> = {
    '/': 'Beranda',
    '/tugas': 'Tugas saya',
    '/project': 'Project',
    '/notifikasi': 'Notifikasi',
    '/profil': 'Profil & keamanan',
    '/admin/pengguna': 'Pengguna',
  };
  const title = $derived(TITLES[page.url.pathname] ?? 'REIN');
  const crumbs = $derived(page.url.pathname.startsWith('/admin') ? [{ label: 'Admin' }] : []);

  async function onlogout() {
    await logout();
    await goto(resolve('/masuk'));
  }
</script>

{#if session.me}
  <AppShell user={session.me.user} isAdmin={hasGlobal('admin.users')} {title} {crumbs} {onlogout}>
    {@render children()}
  </AppShell>
{/if}
