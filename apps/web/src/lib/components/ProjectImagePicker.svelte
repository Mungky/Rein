<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MAX_ATTACHMENT_BYTES } from '@rein/shared';
  import { compressImage, type ImageResult } from '$lib/image';
  import Button from './Button.svelte';

  let {
    kind,
    currentUrl = null,
    image = $bindable(null),
    removed = $bindable(false),
    busy = $bindable(false),
    disabled = false,
  }: {
    kind: 'logo' | 'banner';
    currentUrl?: string | null;
    image?: ImageResult | null;
    removed?: boolean;
    busy?: boolean;
    disabled?: boolean;
  } = $props();
  let input = $state<HTMLInputElement>();
  let preview = $state<string | null>(null);
  let error = $state('');
  const label = $derived(kind === 'logo' ? 'Foto/logo klien' : 'Banner project');
  const url = $derived(preview ?? (removed ? null : currentUrl));
  let disposed = false;
  onDestroy(() => {
    disposed = true;
  });
  $effect(() => {
    const next = image ? URL.createObjectURL(image.blob) : null;
    preview = next;
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  });

  async function pick(e: Event) {
    const field = e.currentTarget as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    if (!file) return;
    error = '';
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
      error = 'Pilih gambar JPG, PNG, WebP, atau HEIC.';
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      error = 'Ukuran file maksimal 50 MB.';
      return;
    }
    busy = true;
    try {
      const result = await compressImage(file, {
        crop: kind === 'logo' ? { width: 256, height: 256 } : { width: 1600, height: 400 },
        quality: 0.85,
      });
      if (disposed) return;
      image = result;
      removed = false;
    } catch {
      error = 'Gambar tidak bisa diproses. Coba gambar JPG, PNG, atau WebP.';
    } finally {
      busy = false;
    }
  }
  function clear() {
    image = null;
    removed = true;
    error = '';
  }
</script>

<section class:banner={kind === 'banner'} aria-label={label}>
  <b>{label} <small>(opsional)</small></b>
  <div class="preview">
    {#if url}<img src={url} alt={label} />{:else}<span
        >Belum ada {kind === 'logo' ? 'foto/logo' : 'banner'}</span
      >{/if}
  </div>
  <input
    bind:this={input}
    type="file"
    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
    aria-label={'Pilih ' + label}
    hidden
    onchange={pick}
    disabled={disabled || busy}
  />
  <div class="actions">
    <Button icon="image" onclick={() => input?.click()} loading={busy} {disabled}
      >{url ? 'Ganti' : 'Pilih'} {kind === 'logo' ? 'foto/logo' : 'banner'}</Button
    >
    {#if url}<Button variant="ghost" onclick={clear} disabled={disabled || busy}>Hapus</Button>{/if}
  </div>
  <small
    >{kind === 'logo' ? 'Dipotong persegi 256 × 256 px.' : 'Dipotong melebar 1600 × 400 px.'} Gambar dikompres
    otomatis.</small
  >
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  b {
    font: var(--text-label);
  }
  small,
  .preview span {
    color: var(--color-text-tertiary);
    font: var(--text-caption);
  }
  .preview {
    width: 80px;
    height: 80px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    display: grid;
    place-items: center;
    overflow: hidden;
    text-align: center;
  }
  .banner .preview {
    width: 100%;
    height: auto;
    aspect-ratio: 4;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .error {
    color: var(--color-danger-default);
    margin: 0;
    font: var(--text-caption);
  }
</style>
