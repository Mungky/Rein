<script lang="ts">
  import { displayUrl } from '$lib/attach';
  import Modal from './Modal.svelte';

  let {
    open = $bindable(false),
    photo,
  }: {
    open?: boolean;
    photo: { id: string; fileName: string } | null;
  } = $props();
</script>

<Modal bind:open title={photo?.fileName ?? 'Pratinjau foto'} width={960}>
  {#if photo}<img src={displayUrl(photo.id)} alt={photo.fileName} />{/if}
</Modal>

<style>
  img {
    display: block;
    width: 100%;
    max-height: 70dvh;
    object-fit: contain;
  }
</style>
