<script lang="ts">
  import { safeNextPath } from '@rein/shared';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import { deviceId } from '$lib/device';
  import { flushPendingLogout, invalidateMe } from '$lib/session.svelte';

  /** FR-001 + FR-006 (Figma D/01a, M/01a). */
  let { data } = $props();

  const GOOGLE_ERRORS: Record<string, string> = {
    google_unregistered: 'Akun Google ini belum terdaftar di REIN. Hubungi Admin.',
    google_unverified: 'Email akun Google belum terverifikasi oleh Google.',
    google_disabled_account: 'Akun Anda dinonaktifkan. Hubungi Admin.',
    google_mismatch: 'Akun REIN ini sudah ditautkan ke akun Google lain.',
    google_state: 'Sesi masuk Google kedaluwarsa. Coba lagi.',
    google_failed: 'Masuk dengan Google gagal. Coba lagi.',
    google_disabled: 'Masuk dengan Google belum diaktifkan.',
  };

  const next = $derived(safeNextPath(page.url.searchParams.get('next')));
  const urlError = $derived(GOOGLE_ERRORS[page.url.searchParams.get('error') ?? ''] ?? null);

  let identifier = $state('');
  let password = $state('');
  let remember = $state(true);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let shake = $state(false);

  const googleHref = $derived(
    `/auth/google/start?next=${encodeURIComponent(next)}&remember=${remember ? 1 : 0}&device=${deviceId() ?? ''}`,
  );

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!identifier.trim() || !password) {
      error = 'Isi email/username dan password';
      return;
    }
    loading = true;
    try {
      await flushPendingLogout();
      const res = await api<{ next: string }>('/api/auth/login', {
        body: { identifier, password, remember, next, deviceId: deviceId() },
      });
      invalidateMe();
      try {
        sessionStorage.setItem('rein:unlocked', '1');
      } catch {
        // abaikan
      }
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- res.next = path internal dari server (safeNextPath)
      await goto(res.next, { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Terjadi kesalahan';
      password = '';
      shake = true;
      setTimeout(() => (shake = false), 450);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Masuk · REIN</title></svelte:head>

<header>
  <h1>Masuk ke REIN</h1>
  <p class="muted">Gunakan email atau username kantor Anda.</p>
</header>

{#if error || urlError}
  <div class="alert" role="alert"><Icon name="alert" size={14} />{error ?? urlError}</div>
{/if}

<form class:shake onsubmit={submit} novalidate>
  <Input
    label="Email atau username"
    name="username"
    autocomplete="username"
    autocapitalize="none"
    spellcheck={false}
    bind:value={identifier}
  />
  <Input
    label="Password"
    type="password"
    name="password"
    autocomplete="current-password"
    bind:value={password}
  />
  <Checkbox bind:checked={remember}>Ingat perangkat ini</Checkbox>
  <Button type="submit" variant="primary" size="md" block {loading}>Masuk</Button>
</form>
<a href={resolve('/reset-password')}>Lupa password?</a>

{#if data.googleEnabled}
  <div class="or"><span>atau</span></div>
  <a class="google" href={googleHref} rel="external" data-sveltekit-reload>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
      />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" />
      <path
        fill="#EA4335"
        d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z"
      />
    </svg>
    Masuk dengan Google
  </a>
{/if}

<p class="hint faint">Belum punya akun? Minta tautan undangan dari Admin.</p>

<style>
  header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: var(--color-danger-subtle);
    color: var(--color-danger-default);
    font-size: 13px;
  }
  .alert :global(svg) {
    margin-top: 3px;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-text-tertiary);
    font-size: 12px;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border-default);
  }
  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 32px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font-weight: 500;
    text-decoration: none;
    transition: background var(--dur);
  }
  .google:hover {
    background: var(--color-bg-hover);
    text-decoration: none;
  }
  .hint {
    font-size: 12px;
    text-align: center;
  }
  .shake {
    animation: shake 0.4s;
  }
  @keyframes shake {
    20%,
    60% {
      transform: translateX(-6px);
    }
    40%,
    80% {
      transform: translateX(6px);
    }
  }
  @media (max-width: 767px) {
    .google {
      height: 44px;
    }
  }
</style>
