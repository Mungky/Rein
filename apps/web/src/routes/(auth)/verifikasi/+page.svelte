<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { invalidateMe, logout } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * FR-003 (Figma D/01b, M/01b): verifikasi email lewat kode 6 digit atau magic link.
   * Verifikasi WhatsApp (kode dikirim ke nomor REIN via OpenWA) menyusul di M1.
   */
  let { data } = $props();

  let code = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let cooldown = $state(60);
  const timer = setInterval(() => (cooldown = Math.max(0, cooldown - 1)), 1000);
  onDestroy(() => clearInterval(timer));

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    error = null;
    if (!/^\d{6}$/.test(code)) {
      error = 'Masukkan 6 digit kode dari email';
      return;
    }
    loading = true;
    try {
      await api('/api/auth/verify-email/code', { body: { code } });
      invalidateMe();
      toast('Email terverifikasi');
      await goto(resolve('/'), { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan';
      code = '';
    } finally {
      loading = false;
    }
  }

  async function resend() {
    try {
      await api('/api/auth/verify-email/resend', { body: {} });
      cooldown = 60;
      toast('Kode baru dikirim ke email Anda');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal mengirim ulang', { tone: 'danger' });
    }
  }

  function oninput() {
    code = code.replace(/\D/g, '').slice(0, 6);
    if (code.length === 6) void submit();
  }

  async function signOut() {
    await logout();
    await goto(resolve('/masuk'));
  }
</script>

<svelte:head><title>Verifikasi email · REIN</title></svelte:head>

<header>
  <span class="ic"><Icon name="mail" size={20} /></span>
  <h1>Verifikasi email</h1>
  <p class="muted">
    Kami mengirim kode 6 digit dan tautan verifikasi ke <b>{data.me.user.email}</b>. Kode berlaku 15
    menit.
  </p>
</header>

<form onsubmit={submit} novalidate>
  <label for="code" class="lb">Kode verifikasi</label>
  <input
    id="code"
    class="code tnum"
    class:err={!!error}
    inputmode="numeric"
    autocomplete="one-time-code"
    maxlength="6"
    placeholder="••••••"
    aria-invalid={error ? 'true' : undefined}
    bind:value={code}
    {oninput}
  />
  {#if error}<p class="msg" role="alert">{error}</p>{/if}
  <Button type="submit" variant="primary" size="md" block {loading}>Verifikasi</Button>
</form>

<div class="row">
  <button class="link" disabled={cooldown > 0} onclick={resend}>
    {cooldown > 0 ? `Kirim ulang kode (${cooldown} dtk)` : 'Kirim ulang kode'}
  </button>
  <button class="link muted" onclick={signOut}>Keluar</button>
</div>

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
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lb {
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .code {
    height: 48px;
    padding: 0 16px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 12px;
    text-align: center;
    outline: none;
    transition:
      border-color var(--dur),
      box-shadow var(--dur);
  }
  .code:focus {
    border-color: var(--color-accent-default);
    box-shadow: 0 0 0 3px var(--color-accent-subtle);
  }
  .code.err {
    border-color: var(--color-danger-default);
  }
  .msg {
    font: var(--text-caption);
    color: var(--color-danger-default);
    margin-bottom: 4px;
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
  .link:disabled {
    color: var(--color-text-tertiary);
    cursor: default;
  }
  .link.muted {
    color: var(--color-text-secondary);
  }
</style>
