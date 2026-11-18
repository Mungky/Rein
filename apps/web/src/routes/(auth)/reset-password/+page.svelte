<script lang="ts">
  import { PASSWORD_MIN } from '@rein/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { invalidateMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  let token = $state<string | null>(null);
  let identifier = $state('');
  let password = $state('');
  let confirmation = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state('');

  function readToken() {
    token = new URLSearchParams(location.hash.slice(1)).get('token');
    sent = false;
    error = '';
  }
  onMount(readToken);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (token && password !== confirmation) {
      error = 'Konfirmasi password belum sama.';
      return;
    }
    busy = true;
    try {
      if (token) {
        await api('/api/auth/reset-password', { body: { token, password } });
        invalidateMe();
        toast('Password baru disimpan. Silakan masuk.');
        await goto(resolve('/masuk'), { replaceState: true });
      } else {
        await api('/api/auth/forgot-password', { body: { identifier } });
        sent = true;
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Permintaan gagal. Coba lagi.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onhashchange={readToken} />
<svelte:head><title>Reset password · REIN</title></svelte:head>
<h1>{token ? 'Buat password baru' : 'Lupa password'}</h1>
{#if sent}
  <p role="status">
    Jika akun dapat menerima email reset, tautan akan dikirim ke email terverifikasi. Tautan berlaku
    30 menit.
  </p>
{:else}
  <form onsubmit={submit}>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if token}
      <Input
        label="Password baru"
        type="password"
        autocomplete="new-password"
        bind:value={password}
        minlength={PASSWORD_MIN}
        maxlength={200}
        required
      />
      <Input
        label="Ulangi password baru"
        type="password"
        autocomplete="new-password"
        bind:value={confirmation}
        required
      />
    {:else}
      <Input
        label="Email atau username"
        autocomplete="username"
        bind:value={identifier}
        maxlength={254}
        required
      />
    {/if}
    <Button type="submit" variant="primary" block loading={busy}
      >{token ? 'Simpan password' : 'Kirim tautan reset'}</Button
    >
  </form>
{/if}
<a href={resolve('/masuk')}>Kembali ke Masuk</a>

<style>
  form {
    display: grid;
    gap: 14px;
  }
</style>
