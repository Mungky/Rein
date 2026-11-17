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
  import Icon from './Icon.svelte';
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
  let editingEmail = $state(false);
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
      editingEmail = false;
      code = '';
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
  {#if !settings}
    {#if error}<Button onclick={load}>Coba lagi</Button>{:else}<p class="hint" role="status">
        Memuat pengaturan kontak…
      </p>{/if}
  {:else}
    <div class="section-heading">
      <h2>Kontak</h2>
    </div>
    <div class="group">
      <div class="contact-row">
        <Icon name="whatsapp" size={18} />
        <div class="contact-copy">
          <h3>WhatsApp</h3>
          <p>{settings.whatsapp ?? 'Belum dihubungkan'}</p>
        </div>
        <span class="status" class:verified={settings.whatsappVerified}
          >{#if settings.whatsappVerified}<Icon
              name="check"
              size={12}
            />{/if}{settings.whatsappVerified ? 'Terverifikasi' : 'Belum terverifikasi'}</span
        >
        {#if !userId && !verification}<Button href={resolve('/verifikasi') + '?manage=1'}
            >{settings.whatsappVerified
              ? 'Ubah'
              : settings.whatsapp
                ? 'Verifikasi'
                : 'Hubungkan'}</Button
          >{/if}
      </div>
      <div class="contact-row">
        <Icon name="mail" size={18} />
        <div class="contact-copy">
          <h3>Email <span class="optional">Opsional</span></h3>
          <p>{settings.email ?? 'Belum dihubungkan'}</p>
        </div>
        {#if settings.email}<span class="status" class:verified={settings.emailVerified}
            >{#if settings.emailVerified}<Icon name="check" size={12} />{/if}{settings.emailVerified
              ? 'Terverifikasi'
              : 'Menunggu verifikasi'}</span
          >{/if}
        {#if !userId}<Button
            aria-expanded={editingEmail}
            aria-controls="email-editor"
            disabled={busy}
            onclick={() => {
              editingEmail = !editingEmail;
              email = settings?.email ?? '';
            }}>{editingEmail ? 'Tutup' : settings.email ? 'Ubah' : 'Hubungkan'}</Button
          >{/if}
      </div>
      {#if !userId && editingEmail}
        <form class="editor" id="email-editor" onsubmit={saveEmail}>
          <Input
            label="Alamat email"
            type="email"
            bind:value={email}
            autocomplete="email"
            required
            disabled={busy}
          />
          <p class="hint">Email baru perlu diverifikasi sebelum digunakan.</p>
          <div class="actions">
            <Button type="submit" variant="primary" loading={busy}
              >Simpan email{settings.mailEnabled ? ' & kirim kode' : ''}</Button
            >
          </div>
        </form>
      {/if}
      {#if !userId && settings.email && !settings.emailVerified && settings.mailEnabled}
        <form class="editor" onsubmit={verify}>
          <p class="hint">Masukkan kode yang dikirim ke {settings.email}.</p>
          <Input
            label="Kode verifikasi email"
            bind:value={code}
            inputmode="numeric"
            maxlength={6}
            minlength={6}
            pattern={'[0-9]{6}'}
            autocomplete="one-time-code"
            required
            disabled={busy}
          />
          <div class="actions">
            <Button type="submit" variant="primary" loading={busy}>Verifikasi email</Button>
            <Button
              variant="ghost"
              disabled={busy}
              onclick={() =>
                action(async () => {
                  await api('/api/auth/verify-email/resend', { body: {} });
                  toast('Kode verifikasi dikirim ulang');
                })}>Kirim ulang kode</Button
            >
          </div>
        </form>
      {/if}
      {#if !userId && settings.googleEnabled && settings.email && !settings.emailVerified}
        <div class="editor">
          <Button href={`${base}/auth/google/start`}>Verifikasi dengan Google</Button>
        </div>
      {/if}
    </div>

    <div class="notifications">
      <div class="section-heading">
        <h2>Notifikasi</h2>
      </div>
      <div class="group channel-settings">
        <div class="channel-form">
          <label
            >Terima notifikasi melalui
            <select bind:value={channels} disabled={busy}>
              <option value="whatsapp">WhatsApp</option><option value="email">Email</option><option
                value="both">WhatsApp & email</option
              >
            </select>
          </label>
          <Button
            variant="secondary"
            onclick={saveChannels}
            loading={busy}
            disabled={channels === settings.channels}>Simpan kanal</Button
          >
        </div>
        <p class="hint">Dikirim ke kontak terverifikasi. Notifikasi di Beranda tetap aktif.</p>
        {#if !settings.mailEnabled && channels !== 'whatsapp'}<p class="service-note" role="status">
            <Icon name="mail" size={14} />Pengiriman email belum aktif. Pilihan kanal tetap
            disimpan.
          </p>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .section-heading {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .group {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
  }
  .contact-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
  }
  .contact-row + .contact-row,
  .editor {
    border-top: 1px solid var(--color-border-default);
  }
  .contact-row > :global(svg) {
    color: var(--color-text-tertiary);
  }
  .contact-copy {
    flex: 1;
    min-width: 0;
  }
  h3 {
    font: var(--text-body-13);
    font-weight: 500;
    margin: 0 0 2px;
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .contact-copy p {
    font: var(--text-caption);
  }
  .optional {
    font: var(--text-caption);
    margin-left: 6px;
    color: var(--color-text-tertiary);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: var(--text-caption);
    color: var(--color-text-tertiary);
    flex: none;
  }
  .verified {
    color: var(--color-accent-default);
  }
  .editor {
    padding: 16px;
    display: grid;
    gap: 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .notifications {
    margin-top: 32px;
  }
  .channel-settings {
    padding: 16px;
    display: grid;
    gap: 12px;
  }
  .channel-form {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }
  .channel-form label {
    flex: 1;
    max-width: 360px;
    min-width: 0;
    display: grid;
    gap: 6px;
    color: var(--color-text-secondary);
    font: var(--text-label);
  }
  .hint {
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  select {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: var(--text-body-13);
  }
  .service-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .error {
    color: var(--color-danger-default);
    margin-bottom: 12px;
  }
  @media (max-width: 767px) {
    select {
      min-height: 44px;
      font-size: 16px;
    }
    .contact-row {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      padding: 14px 12px;
      gap: 4px 10px;
    }
    .contact-row > :global(svg) {
      grid-column: 1;
      grid-row: 1 / span 2;
    }
    .contact-copy {
      grid-column: 2;
      grid-row: 1;
    }
    .status {
      grid-column: 2;
      grid-row: 2;
    }
    .contact-row > :global(.btn) {
      grid-column: 3;
      grid-row: 1 / span 2;
    }
    .channel-form {
      flex-wrap: wrap;
    }
    .channel-form label {
      flex-basis: 100%;
    }
  }
</style>
