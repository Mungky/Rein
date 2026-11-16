<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { deviceId } from '$lib/device';
  import { loadMe, logout } from '$lib/session.svelte';

  let { data } = $props();
  interface Challenge {
    challengeId: string;
    phone: string;
    expiresAt: string;
    resendAt: string;
  }
  let phone = $state('');
  let code = $state('');
  let issued = $state<Challenge | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let now = $state(Date.now());
  const left = $derived(
    issued ? Math.max(0, Math.ceil((Date.parse(issued.resendAt) - now) / 1000)) : 0,
  );

  onMount(() => {
    const tick = setInterval(() => {
      now = Date.now();
    }, 1000);
    api<{ pendingPhone: string | null; challenge: Challenge | null }>('/api/auth/verify-whatsapp')
      .then((s) => {
        phone = s.pendingPhone ?? '';
        issued = s.challenge;
      })
      .catch(() => {
        error = 'Gagal memuat nomor. Muat ulang halaman.';
      });
    return () => clearInterval(tick);
  });

  async function start(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    error = null;
    try {
      issued = await api<Challenge>('/api/auth/verify-whatsapp/start', { body: { phone } });
      phone = issued.phone;
      code = '';
      now = Date.now();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Kode belum terkirim. Coba lagi.';
    } finally {
      busy = false;
    }
  }

  async function verify(e: SubmitEvent) {
    e.preventDefault();
    if (!issued) return;
    busy = true;
    error = null;
    try {
      await api('/api/auth/verify-whatsapp/code', {
        body: { challengeId: issued.challengeId, code, deviceId: deviceId() },
      });
      const me = await loadMe(true);
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- path dari server sendiri
      await goto(data.manage ? resolve('/profil') : (me?.onboardingNext ?? resolve('/')), {
        replaceState: true,
      });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Verifikasi gagal. Coba lagi.';
    } finally {
      busy = false;
    }
  }

  async function signOut() {
    await logout();
    await goto(resolve('/masuk'));
  }
</script>

<svelte:head><title>Verifikasi WhatsApp · REIN</title></svelte:head>

<header>
  <h1>{issued ? 'Masukkan kode' : 'Nomor WhatsApp Anda'}</h1>
  <p class="muted">
    {issued
      ? `Kode dikirim ke ${issued.phone}.`
      : 'Kami akan mengirim kode verifikasi ke nomor ini.'}
  </p>
</header>

{#if issued}
  <form onsubmit={verify}>
    <Input
      label="Kode verifikasi"
      bind:value={code}
      inputmode="numeric"
      autocomplete="one-time-code"
      pattern={'[0-9]{6}'}
      maxlength={6}
      required
      {error}
      disabled={busy}
      placeholder="6 digit kode"
    />
    <Button type="submit" variant="primary" size="md" block loading={busy}>Verifikasi</Button>
  </form>
  <div class="secondary">
    <Button variant="ghost" disabled={busy || left > 0} onclick={() => start()}
      >{left > 0 ? `Kirim ulang dalam ${left} dtk` : 'Kirim ulang kode'}</Button
    >
    <Button
      variant="ghost"
      disabled={busy}
      onclick={() => {
        issued = null;
        code = '';
        error = null;
      }}>Ganti nomor</Button
    >
  </div>
{:else}
  <form onsubmit={start}>
    <Input
      label="Nomor WhatsApp"
      bind:value={phone}
      type="tel"
      autocomplete="tel"
      placeholder="08xxxxxxxxxx"
      maxlength={24}
      required
      {error}
      disabled={busy}
    />
    <Button type="submit" variant="primary" size="md" block loading={busy}>Kirim kode</Button>
  </form>
{/if}

{#if data.manage}<Button variant="ghost" href={resolve('/profil')}>Kembali ke profil</Button>
{:else}<Button variant="ghost" disabled={busy} onclick={signOut}>Keluar</Button>{/if}

<style>
  header {
    display: grid;
    gap: 8px;
  }
  form {
    display: grid;
    gap: 20px;
  }
  .secondary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px;
  }
</style>
