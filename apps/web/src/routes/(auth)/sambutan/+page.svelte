<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import { compressImage } from '$lib/image';
  import { loadMe } from '$lib/session.svelte';
  import { uploadAttachment } from '$lib/upload';

  let { data } = $props();
  let nickname = $state('');
  let avatarUrl = $state<string | null>(null);
  $effect(() => {
    nickname = data.me.user.nickname ?? data.me.user.fullName.split(' ')[0] ?? '';
    avatarUrl = data.me.user.avatarUrl;
  });
  let picker = $state<HTMLInputElement>();
  let uploading = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    if (!file.type.startsWith('image/')) {
      error = 'Pilih file gambar.';
      return;
    }
    uploading = true;
    try {
      const img = await compressImage(file, { square: 256, quality: 0.85 });
      const attachment = await uploadAttachment({
        ownerType: 'user',
        ownerId: data.me.user.id,
        category: 'photo',
        file: {
          blob: img.blob,
          name: img.blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg',
        },
        width: img.width,
        height: img.height,
      });
      const result = await api<{ avatarUrl: string }>('/api/me/avatar', {
        body: { attachmentId: attachment.id },
      });
      avatarUrl = result.avatarUrl;
    } catch (err) {
      error =
        err instanceof ApiError
          ? err.message
          : 'Foto gagal diunggah. Pilih foto lain atau lanjutkan dulu.';
    } finally {
      uploading = false;
    }
  }

  async function finish(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      await api('/api/auth/onboarding/complete', { body: { nickname } });
      await loadMe(true);
      await goto(resolve('/'), { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal menyimpan. Coba lagi.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Selamat datang · REIN</title></svelte:head>

<header>
  <h1>Mau dipanggil apa?</h1>
  <p class="muted">Lengkapi profil Anda sebelum mulai.</p>
</header>
<form onsubmit={finish}>
  <div class="photo">
    <button
      type="button"
      class="avatar"
      aria-label="Pilih foto profil"
      disabled={busy || uploading}
      onclick={() => picker?.click()}
    >
      {#key avatarUrl}<Avatar
          name={nickname || data.me.user.fullName}
          src={avatarUrl}
          size={64}
        />{/key}
      <span class="camera"><Icon name="camera" size={16} /></span>
    </button>
    <input type="file" bind:this={picker} accept="image/*" hidden onchange={pick} />
    <Button variant="ghost" disabled={busy || uploading} onclick={() => picker?.click()}
      >{uploading ? 'Mengunggah…' : 'Pilih foto (opsional)'}</Button
    >
  </div>
  <Input
    label="Nama panggilan"
    bind:value={nickname}
    maxlength={40}
    autocomplete="nickname"
    required
    disabled={busy}
  />
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <Button type="submit" variant="primary" size="md" block loading={busy} disabled={uploading}
    >Mulai</Button
  >
</form>

<style>
  header {
    display: grid;
    gap: 8px;
  }
  form {
    display: grid;
    gap: 20px;
  }
  .photo {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .avatar {
    position: relative;
    border-radius: 50%;
  }
  .camera {
    position: absolute;
    bottom: 0;
    right: -2px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-surface);
  }
  .error {
    color: var(--color-danger-default);
  }
</style>
