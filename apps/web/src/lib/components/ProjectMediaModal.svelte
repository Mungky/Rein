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
    kind,
    onclose,
    onsaved,
  }: {
    project: ProjectDetail;
    kind: 'logo' | 'banner';
    onclose: () => void;
    onsaved: () => Promise<void>;
  } = $props();
  const { id, updatedAt } = untrack(() => project);
  const currentUrl = $derived(kind === 'logo' ? project.logoUrl : project.bannerUrl);
  const label = $derived(kind === 'logo' ? 'Foto/logo' : 'Banner');
  let image = $state<ImageResult | null>(null);
  let removed = $state(false);
  let processing = $state(false);
  let saving = $state(false);
  let error = $state('');
  const changed = $derived(!!image || (removed && !!currentUrl));

  async function save() {
    if (!changed || processing || saving) return;
    saving = true;
    error = '';
    try {
      const media = removed
        ? { [kind === 'logo' ? 'logoAttachmentId' : 'bannerAttachmentId']: null }
        : await uploadProjectImages(
            session.me!.user.id,
            kind === 'logo' ? image : null,
            kind === 'banner' ? image : null,
          );
      await api(`/api/projects/${id}/media`, {
        method: 'PUT',
        body: { expectedUpdatedAt: updatedAt, ...media },
      });
      toast(`${label} project diperbarui`);
      await onsaved();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal menyimpan gambar. Coba lagi.';
    } finally {
      saving = false;
    }
  }
</script>

<Modal open title={`Ubah ${label.toLowerCase()} project`} width={560} {onclose}>
  <ProjectImagePicker
    {kind}
    {currentUrl}
    bind:image
    bind:removed
    bind:busy={processing}
    disabled={saving}
  />
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <Button onclick={onclose} disabled={saving}>Batal</Button>
    <Button variant="primary" onclick={save} loading={saving} disabled={!changed || processing}
      >Simpan gambar</Button
    >
  {/snippet}
</Modal>

<style>
  .error {
    color: var(--color-danger-default);
  }
</style>
