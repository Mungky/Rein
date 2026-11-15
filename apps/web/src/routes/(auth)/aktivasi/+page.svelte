<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Input from '$lib/components/Input.svelte';
  import { invalidateMe } from '$lib/session.svelte';

  /** FR-002: aktivasi akun dari undangan (tautan 72 jam). */
  const token = $derived(page.url.searchParams.get('token') ?? '');

  let view = $state<'loading' | 'form' | 'invalid' | 'requested'>('loading');
  let info = $state<{ fullName: string; username: string; email: string | null } | null>(null);
  let password = $state('');
  let confirm = $state('');
  let loading = $state(false);
  let errors = $state<{ password?: string; confirm?: string; form?: string }>({});

  onMount(async () => {
    if (!token) {
      view = 'invalid';
      return;
    }
    try {
      info = await api('/api/auth/activation/inspect', { body: { token } });
      view = 'form';
    } catch {
      view = 'invalid';
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    if (password.length < 10) errors.password = 'Password minimal 10 karakter';
    if (confirm !== password) errors.confirm = 'Konfirmasi password tidak sama';
    if (errors.password || errors.confirm) return;
    loading = true;
    try {
      const res = await api<{ next: string }>('/api/auth/activation/complete', {
        body: { token, password },
      });
      invalidateMe();
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- res.next = path internal dari server (safeNextPath)
      await goto(res.next, { replaceState: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOKEN_INVALID') view = 'invalid';
      else if (err instanceof ApiError) {
        errors = {
          form: err.message,
          ...(err.fields.password ? { password: err.fields.password } : {}),
        };
      }
    } finally {
      loading = false;
    }
  }

  async function requestNew() {
    loading = true;
    await api('/api/auth/activation/request', { body: { token } }).catch(() => {});
    loading = false;
    view = 'requested';
  }
</script>

<svelte:head><title>Aktivasi akun · REIN</title></svelte:head>

{#if view === 'loading'}
  <p class="muted">Memeriksa tautan…</p>
{:else if view === 'invalid'}
  <EmptyState
    icon="alert"
    title="Tautan tidak berlaku"
    message="Tautan aktivasi sudah dipakai atau kedaluwarsa (berlaku 72 jam)."
  >
    {#if token}
      <Button variant="primary" size="md" {loading} onclick={requestNew}>Minta tautan baru</Button>
    {/if}
    <Button variant="ghost" href={resolve('/masuk')}>Ke halaman masuk</Button>
  </EmptyState>
{:else if view === 'requested'}
  <EmptyState
    icon="mail"
    title="Cek email Anda"
    message="Jika undangan masih berlaku untuk akun ini, tautan aktivasi baru sudah dikirim ke email Anda."
  />
{:else if info}
  <header>
    <h1>Aktifkan akun</h1>
    <p class="muted">
      Halo <b>{info.fullName}</b>. Buat password untuk username
      <b>{info.username}</b>{#if info.email}
        &nbsp;({info.email}){/if}.
    </p>
  </header>
  {#if errors.form && !errors.password}<p class="err" role="alert">{errors.form}</p>{/if}
  <form onsubmit={submit} novalidate>
    <input
      type="text"
      name="username"
      autocomplete="username"
      value={info.username}
      hidden
      readonly
    />
    <Input
      label="Password baru"
      type="password"
      autocomplete="new-password"
      hint="Minimal 10 karakter. Hindari password yang umum."
      error={errors.password}
      bind:value={password}
    />
    <Input
      label="Ulangi password"
      type="password"
      autocomplete="new-password"
      error={errors.confirm}
      bind:value={confirm}
    />
    <Button type="submit" variant="primary" size="md" block {loading}>Aktifkan &amp; lanjut</Button>
  </form>
{/if}

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
  .err {
    color: var(--color-danger-default);
  }
</style>
