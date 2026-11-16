<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import UserNotificationSettings from '$lib/components/UserNotificationSettings.svelte';
  import { invalidateMe, logout } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * FR-003 (Figma D/01b, M/01b) + keputusan D2: akses dibuka setelah SATU kontak terverifikasi.
   * Utama: WhatsApp "dibalik" (AC2) — user mengirim kode REIN-XXXXXX ke nomor REIN, webhook
   * OpenWA mencocokkan, halaman ini lanjut sendiri. Kode email hanya tampil bila email aktif.
   */
  let { data } = $props();

  interface WaState {
    verified: boolean;
    phone: string | null;
    pendingPhone: string | null;
    reinNumberSet: boolean;
  }
  interface Issued {
    phone: string;
    code: string;
    link: string | null;
    expiresAt: string;
  }

  let wa = $state<WaState | null>(null);
  let phone = $state('');
  let phoneError = $state<string | null>(null);
  let issued = $state<Issued | null>(null);
  let starting = $state(false);
  let left = $state(0);
  let mode = $state<'wa' | 'email'>('wa');

  let poll: ReturnType<typeof setInterval> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    wa = await api<WaState>('/api/auth/verify-whatsapp');
    phone = (wa.pendingPhone ?? '').replace(/^\+62/, '0');
    if (wa.verified && !data.manage) await done();
  });
  onDestroy(() => {
    clearInterval(poll);
    clearInterval(tick);
  });

  async function done() {
    clearInterval(poll);
    invalidateMe();
    toast('Nomor WhatsApp terverifikasi');
    await goto(data.manage ? resolve('/profil') : resolve('/'), { replaceState: true });
  }

  async function start(e?: SubmitEvent) {
    e?.preventDefault();
    phoneError = null;
    if (!phone.trim()) {
      phoneError = 'Isi nomor WhatsApp Anda';
      return;
    }
    starting = true;
    try {
      issued = await api<Issued>('/api/auth/verify-whatsapp/start', { body: { phone } });
      const until = new Date(issued.expiresAt).getTime();
      clearInterval(tick);
      left = Math.max(0, Math.round((until - Date.now()) / 1000));
      tick = setInterval(() => {
        left = Math.max(0, Math.round((until - Date.now()) / 1000));
        if (!left) clearInterval(tick);
      }, 1000);
      clearInterval(poll);
      poll = setInterval(async () => {
        const s = await api<WaState>('/api/auth/verify-whatsapp').catch(() => null);
        if (s?.verified) await done();
      }, 3000);
    } catch (err) {
      phoneError =
        err instanceof ApiError ? (err.fields.phone ?? err.message) : 'Terjadi kesalahan';
    } finally {
      starting = false;
    }
  }

  async function copyCode() {
    if (!issued) return;
    await navigator.clipboard?.writeText(issued.code).catch(() => {});
    toast('Kode disalin');
  }

  async function signOut() {
    await logout();
    await goto(resolve('/masuk'));
  }

  const mmss = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
</script>

<svelte:head><title>Verifikasi · REIN</title></svelte:head>

{#if mode === 'wa'}
  <header>
    <span class="ic"><Icon name="whatsapp" size={20} /></span>
    <h1>Verifikasi WhatsApp</h1>
    <p class="muted">
      Notifikasi tugas dikirim lewat WhatsApp. Verifikasi nomor Anda dengan mengirim kode ke nomor
      REIN.
    </p>
  </header>

  {#if wa && !wa.reinNumberSet}
    <p class="warn" role="status">
      <Icon name="alert" size={14} />Nomor WhatsApp REIN belum diatur. Minta Admin memverifikasi
      nomor Anda secara manual.
    </p>
  {/if}

  {#if wa?.verified}
    <p>WhatsApp {wa.phone} sudah terverifikasi.</p>
    <Button href={resolve('/profil')}>Kembali ke profil</Button>
  {:else if !issued}
    <form onsubmit={start} novalidate>
      <Input
        label="Nomor WhatsApp"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        placeholder="0812-3456-7890"
        bind:value={phone}
        error={phoneError}
      />
      <Button type="submit" variant="primary" size="md" block loading={starting}>Buat kode</Button>
    </form>
  {:else}
    <div class="issued">
      <span class="lb">Kirim pesan ini dari <b>{issued.phone}</b></span>
      <button class="code tnum" onclick={copyCode} title="Salin kode">{issued.code}</button>
      {#if issued.link}
        <!-- eslint-disable svelte/no-navigation-without-resolve -- tautan eksternal wa.me -->
        <a class="wa" href={issued.link} target="_blank" rel="noopener noreferrer">
          <Icon name="whatsapp" />Kirim via WhatsApp
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {/if}
      <p class="wait muted">
        <span class="dot" aria-hidden="true"></span>
        {#if left > 0}
          Menunggu pesan Anda… kode berlaku <b class="tnum">{mmss}</b>
        {:else}
          Kode kedaluwarsa. Buat kode baru.
        {/if}
      </p>
    </div>
    <div class="row">
      <button class="link" onclick={() => (issued = null)}>Ganti nomor / kode baru</button>
    </div>
  {/if}

  <div class="row">
    <button class="link muted" onclick={() => (mode = 'email')}
      >Pilih kanal / hubungkan email</button
    >
    <button class="link muted" onclick={signOut}>Keluar</button>
  </div>
{:else}
  <header>
    <span class="ic"><Icon name="mail" size={20} /></span>
    <h1>Kontak & notifikasi</h1>
    <p class="muted">
      Pilih WhatsApp, email, atau keduanya. Verifikasi minimal satu kontak untuk masuk.
    </p>
  </header>
  <UserNotificationSettings verification />
  <div class="row">
    <button class="link muted" onclick={() => (mode = 'wa')}>Pakai WhatsApp</button>
  </div>
{/if}

<style>
  header {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-lg);
    background: var(--color-accent-subtle);
    color: var(--color-accent-default);
    margin-bottom: 4px;
  }
  form,
  .issued {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lb {
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .code {
    height: 56px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg-subtle);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 3px;
    color: var(--color-text-primary);
  }
  .wa {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    border-radius: var(--radius-md);
    background: var(--color-accent-default);
    color: var(--color-text-on-accent);
    font-weight: 500;
    text-decoration: none;
  }
  .wa:hover {
    background: var(--color-accent-hover);
    text-decoration: none;
  }
  .wait {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--text-caption);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent-default);
    animation: pulse 1.4s var(--ease) infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .warn {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    font: var(--text-caption);
    color: var(--color-text-secondary);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .link {
    color: var(--color-accent-default);
    font-weight: 500;
    min-height: 32px;
  }
  .link.muted {
    color: var(--color-text-secondary);
  }
</style>
