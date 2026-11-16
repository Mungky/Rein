<script lang="ts">
  import { onMount } from 'svelte';
  import type { NotificationChannels } from '@rein/shared';
  import { base, resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { loadMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  let { userId, verification = false }: { userId?: string; verification?: boolean } = $props();
  interface Settings {
    channels: NotificationChannels;
    email: string | null;
    emailVerified: boolean;
    whatsapp: string | null;
    whatsappVerified: boolean;
    mailEnabled: boolean;
    googleEnabled: boolean;
  }
  let settings = $state<Settings | null>(null);
  let channels = $state<NotificationChannels>('both');
  let email = $state('');
  let code = $state('');
  let error = $state('');
  let busy = $state(false);
  const endpoint = $derived(
    userId ? `/api/admin/users/${userId}/notifications` : '/api/me/notifications',
  );
  async function load() {
    error = '';
    try {
      settings = await api<Settings>(endpoint);
      channels = settings.channels;
      email = settings.email ?? '';
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal memuat pengaturan';
    }
  }
  onMount(() => {
    void load();
  });
  async function action(run: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await run();
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Pengaturan gagal disimpan';
    } finally {
      busy = false;
    }
  }
  async function saveChannels() {
    await action(async () => {
      await api(endpoint, { method: 'PUT', body: { channels } });
      toast('Kanal notifikasi disimpan');
    });
  }
  async function saveEmail(e: SubmitEvent) {
    e.preventDefault();
    await action(async () => {
      await api('/api/me/email', { body: { email } });
      if (settings?.mailEnabled) {
        await api('/api/auth/verify-email/resend', { body: {} });
        toast('Email disimpan. Periksa kode verifikasinya.');
      } else toast('Email disimpan. Layanan pengiriman email belum aktif.');
    });
  }
  async function verify(e: SubmitEvent) {
    e.preventDefault();
    await action(async () => {
      await api('/api/auth/verify-email/code', { body: { code } });
      await loadMe(true);
      toast('Email terverifikasi');
      if (verification) await goto(resolve('/'));
    });
  }
</script>

<div class="settings">
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !settings}<p role="status">Memuat pengaturan notifikasi…</p>
    <Button onclick={load}>Muat ulang</Button>
  {:else}
    <label
      >Terima notifikasi melalui
      <select bind:value={channels} disabled={busy}
        ><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option
          value="both">WhatsApp & email</option
        ></select
      >
    </label>
    <Button onclick={saveChannels} loading={busy} disabled={channels === settings.channels}
      >Simpan kanal</Button
    >
    <p>
      WhatsApp: {settings.whatsapp ?? 'Belum dihubungkan'} · {settings.whatsappVerified
        ? 'Terverifikasi'
        : 'Belum terverifikasi'}
    </p>
    <p>
      Email: {settings.email ?? 'Belum dihubungkan'} · {settings.emailVerified
        ? 'Terverifikasi'
        : 'Belum terverifikasi'}
    </p>
    <p class="hint">
      Notifikasi hanya dikirim ke kontak yang terverifikasi. Notifikasi dalam aplikasi tetap aktif.
    </p>
    {#if !settings.mailEnabled}<p class="hint" role="status">
        Layanan email belum aktif. Pilihan kanal tetap disimpan; pengiriman email menunggu layanan
        diaktifkan.
      </p>{/if}
    {#if !userId}
      {#if !verification}<Button href={resolve('/verifikasi') + '?manage=1'}
          >Hubungkan / verifikasi WhatsApp</Button
        >{/if}
      <form onsubmit={saveEmail}>
        <Input label="Alamat email" type="email" bind:value={email} autocomplete="email" />
        <Button type="submit" loading={busy}
          >Simpan email{settings.mailEnabled ? ' & kirim kode' : ''}</Button
        >
      </form>
      {#if !settings.emailVerified && settings.mailEnabled}
        <form onsubmit={verify}>
          <Input
            label="Kode verifikasi email"
            bind:value={code}
            inputmode="numeric"
            maxlength={6}
          />
          <Button type="submit" loading={busy}>Verifikasi email</Button>
        </form>
      {/if}
      {#if settings.googleEnabled && settings.email && !settings.emailVerified}
        <Button href={`${base}/auth/google/start`}>Verifikasi melalui Masuk dengan Google</Button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .settings,
  form,
  label {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  select {
    width: 100%;
    min-height: 36px;
    padding: 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  .error {
    color: var(--color-danger-default);
  }
  @media (max-width: 767px) {
    select {
      min-height: 44px;
    }
  }
</style>
