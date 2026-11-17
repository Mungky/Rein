<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type { ImageResult } from '$lib/image';
  import { uploadProjectImages } from '$lib/project-media';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { ProjectDetail } from '$lib/types';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import ProjectImagePicker from './ProjectImagePicker.svelte';

  let {
    project,
    onclose,
    onsaved,
  }: { project: ProjectDetail; onclose: () => void; onsaved: () => Promise<void> } = $props();
  const initial = untrack(() => ({ id: project.id, updatedAt: project.updatedAt }));
  let logo = $state<ImageResult | null>(null);
  let banner = $state<ImageResult | null>(null);
  let removeLogo = $state(false);
  let removeBanner = $state(false);
  let logoProcessing = $state(false);
  let bannerProcessing = $state(false);
  let saving = $state(false);
  let error = $state('');
  const processing = $derived(logoProcessing || bannerProcessing);
  const changed = $derived(
    !!logo ||
      !!banner ||
      (removeLogo && !!project.logoUrl) ||
      (removeBanner && !!project.bannerUrl),
  );

  async function save() {
    if (!changed || processing || saving) return;
    saving = true;
    error = '';
    try {
      const media = await uploadProjectImages(session.me!.user.id, logo, banner);
      await api(`/api/projects/${initial.id}/media`, {
        method: 'PUT',
        body: {
          expectedUpdatedAt: initial.updatedAt,
          ...media,
          ...(removeLogo && project.logoUrl ? { logoAttachmentId: null } : {}),
          ...(removeBanner && project.bannerUrl ? { bannerAttachmentId: null } : {}),
        },
      });
      toast('Foto/logo dan banner project diperbarui.');
      await onsaved();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal menyimpan gambar. Coba lagi.';
    } finally {
      saving = false;
    }
  }
</script>

<Modal open title="Foto/logo & banner project" width={600} {onclose}>
  <div class="fields">
    <ProjectImagePicker
      kind="logo"
      currentUrl={project.logoUrl}
      bind:image={logo}
      bind:removed={removeLogo}
      bind:busy={logoProcessing}
      disabled={saving}
    />
    <ProjectImagePicker
      kind="banner"
      currentUrl={project.bannerUrl}
      bind:image={banner}
      bind:removed={removeBanner}
      bind:busy={bannerProcessing}
      disabled={saving}
    />
  </div>
  <p class="hint">
    Mengganti atau menghapus gambar mengikuti izin Edit info, foto/logo, banner & status project.
  </p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <Button onclick={onclose} disabled={saving}>Batal</Button>
    <Button variant="primary" onclick={save} loading={saving} disabled={!changed || processing}
      >Simpan gambar</Button
    >
  {/snippet}
</Modal>

<style>
  .fields {
    display: grid;
    gap: 24px;
  }
  .hint {
    color: var(--color-text-secondary);
    font: var(--text-caption);
    margin: 16px 0 0;
  }
  .error {
    color: var(--color-danger-default);
  }
</style>
