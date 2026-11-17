<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { invalidateMe } from '$lib/session.svelte';

  /** FR-003 AC1: magic link dari email verifikasi. */
  let view = $state<'loading' | 'ok' | 'invalid'>('loading');
  let message = $state('');
  let signedIn = $state(false);

  onMount(async () => {
    const token = page.url.searchParams.get('token');
    if (!token) {
      view = 'invalid';
      return;
    }
    try {
      const res = await api<{ signedIn: boolean }>('/api/auth/verify-email/token', {
        body: { token },
      });
      signedIn = res.signedIn;
      invalidateMe();
      view = 'ok';
    } catch (err) {
      message = err instanceof ApiError ? err.message : 'Terjadi kesalahan';
      view = 'invalid';
    }
  });
</script>

<svelte:head><title>Verifikasi email · REIN</title></svelte:head>

{#if view === 'loading'}
  <p class="muted">Memverifikasi…</p>
{:else if view === 'ok'}
  <EmptyState
    icon="check"
    title="Email terverifikasi"
    message="Terima kasih. Email Anda sekarang dipakai untuk notifikasi REIN."
  >
    <Button variant="primary" size="md" href={signedIn ? resolve('/') : resolve('/masuk')}>
      {signedIn ? 'Lanjut ke Beranda' : 'Masuk ke REIN'}
    </Button>
  </EmptyState>
{:else}
  <EmptyState
    icon="alert"
    title="Tautan tidak berlaku"
    message={message || 'Tautan sudah dipakai atau kedaluwarsa (berlaku 15 menit).'}
  >
    <Button variant="primary" size="md" href={resolve('/verifikasi')}
      >Masukkan kode / kirim ulang</Button
    >
  </EmptyState>
{/if}
