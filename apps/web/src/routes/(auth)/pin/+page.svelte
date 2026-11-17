<script lang="ts">
  import { pinProblem, safeNextPath } from '@rein/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import PinPad from '$lib/components/PinPad.svelte';
  import Button from '$lib/components/Button.svelte';
  import { loadMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * FR-004 AC1 (Figma D/01c, M/01c): buat PIN 6 digit, dua kali input. PIN berurutan atau
   * semua digit sama ditolak (dicek juga di server).
   */
  let step = $state<1 | 2>(1);
  let first = $state('');
  let value = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  const next = $derived(safeNextPath(page.url.searchParams.get('next')));

  async function complete(pin: string) {
    error = null;
    if (step === 1) {
      const problem = pinProblem(pin);
      if (problem) {
        error = problem;
        value = '';
        return;
      }
      first = pin;
      value = '';
      step = 2;
      return;
    }
    if (pin !== first) {
      error = 'PIN tidak sama. Ulangi dari awal.';
      value = '';
      first = '';
      step = 1;
      return;
    }
    busy = true;
    try {
      await api('/api/auth/pin/setup', { body: { pin: first, pinConfirm: pin } });
      try {
        sessionStorage.setItem('rein:unlocked', '1');
      } catch {
        // tanpa sessionStorage: layar PIN muncul lagi saat aplikasi dibuka ulang
      }
      const me = await loadMe(true);
      toast('PIN dibuat');
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- next = path internal (safeNextPath)
      await goto(me?.onboardingNext ?? next, { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan';
      value = '';
      first = '';
      step = 1;
    } finally {
      busy = false;
    }
  }

  async function skip() {
    busy = true;
    error = null;
    try {
      await api('/api/auth/pin/skip', { body: {} });
      const me = await loadMe(true);
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- path dari server sendiri
      await goto(me?.onboardingNext ?? next, { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal melanjutkan';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Buat PIN · REIN</title></svelte:head>

<header>
  <span class="ic"><Icon name="key" size={20} /></span>
  <h1>{step === 1 ? 'Buat PIN' : 'Ulangi PIN'}</h1>
  <p class="muted">
    {step === 1
      ? 'PIN 6 digit untuk membuka REIN dengan cepat di perangkat ini.'
      : 'Masukkan PIN yang sama sekali lagi.'}
  </p>
</header>

{#if page.data.me?.device}<PinPad bind:value {error} disabled={busy} oncomplete={complete} />
{:else}<p class="muted">PIN belum tersedia di browser ini. Anda tetap bisa melanjutkan.</p>{/if}
<Button variant="ghost" disabled={busy} onclick={skip}>Lewati dulu</Button>

<style>
  header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
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
</style>
