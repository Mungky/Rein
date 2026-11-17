<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
</script>

<svelte:head><title>{page.status} · REIN</title></svelte:head>

<div class="empty">
  <span class="ic"><Icon name={page.status === 404 ? 'search' : 'alert'} size={20} /></span>
  <h1>{page.status === 404 ? 'Halaman tidak ditemukan' : 'Terjadi kesalahan'}</h1>
  <p class="muted">
    {page.status === 404
      ? 'Halaman ini tidak ada atau belum tersedia.'
      : (page.error?.message ?? 'Coba muat ulang halaman.')}
  </p>
  <p class="faint">Kode: {page.status}</p>
  <Button variant="primary" size="md" href={resolve('/')}>Kembali ke Beranda</Button>
</div>

<style>
  .empty {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px 16px;
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
  }
</style>
