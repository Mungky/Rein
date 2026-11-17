<script lang="ts">
  import { safeNextPath } from '@rein/shared';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import PinPad from '$lib/components/PinPad.svelte';
  import { invalidateMe, logout } from '$lib/session.svelte';

  /**
   * FR-004 AC3–AC5 (Figma D/01d, M/01d): fast login dengan PIN di perangkat trusted saat sesi
   * terkunci. 5× salah → PIN dinonaktifkan, wajib login password lalu membuat PIN baru.
   */
  let { data } = $props();

  let value = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  const next = $derived(safeNextPath(page.url.searchParams.get('next')));

  async function complete(pin: string) {
    busy = true;
    error = null;
    try {
      await api('/api/auth/pin/unlock', { body: { pin } });
      try {
        sessionStorage.setItem('rein:unlocked', '1');
      } catch {
        // abaikan
      }
      invalidateMe();
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- next = path internal (safeNextPath)
      await goto(next, { replaceState: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PIN_DISABLED') {
        invalidateMe();
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() + query string
        await goto(resolve('/masuk') + `?next=${encodeURIComponent(next)}&pin=disabled`, {
          replaceState: true,
        });
        return;
      }
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan';
      value = '';
    } finally {
      busy = false;
    }
  }

  async function forgot() {
    await logout();
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() + query string
    await goto(resolve('/masuk') + `?next=${encodeURIComponent(next)}`);
  }
</script>

<svelte:head><title>Masukkan PIN · REIN</title></svelte:head>

<header>
  <Avatar name={data.me.user.fullName} src={data.me.user.avatarUrl} size={64} />
  <h1>{data.me.user.nickname ?? data.me.user.fullName}</h1>
  <p class="muted">Masukkan PIN untuk melanjutkan</p>
</header>

<PinPad bind:value {error} disabled={busy} oncomplete={complete} />

<div class="row">
  <button class="link" onclick={forgot}>Lupa PIN? Masuk dengan password</button>
</div>

<style>
  header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
  }
  .row {
    display: flex;
    justify-content: center;
  }
  .link {
    color: var(--color-accent-default);
    font-weight: 500;
    min-height: 32px;
  }
</style>
