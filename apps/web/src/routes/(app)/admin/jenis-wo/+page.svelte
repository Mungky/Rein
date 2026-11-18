<script lang="ts">
  import { WO_CATEGORIES, WO_CATEGORY_META, type WoCategory } from '@rein/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import CategoryDot from '$lib/components/CategoryDot.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { hasGlobal } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  interface Kind {
    id: string;
    name: string;
    code: string;
    category: WoCategory;
    isPunchList: boolean;
    active: boolean;
    usage: number;
  }
  const endpoint = '/api/admin/wo-types';
  const allowed = $derived(hasGlobal('admin.wo_types'));
  let kinds = $state<Kind[] | null>(null);
  let error = $state('');
  let busy = $state(false);
  let editOpen = $state(false);
  let deleteOpen = $state(false);
  let selected = $state<Kind | null>(null);
  let editError = $state('');
  let fields = $state<Record<string, string>>({});
  let form = $state({
    name: '',
    code: '',
    category: 'general' as WoCategory,
    isPunchList: false,
    active: true,
  });
  let dragged = $state<string | null>(null);

  async function load() {
    error = '';
    try {
      kinds = (await api<{ types: Kind[] }>(endpoint)).types;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Daftar jenis WO gagal dimuat.';
    }
  }
  onMount(() => {
    if (allowed) void load();
  });

  function edit(kind: Kind | null) {
    selected = kind;
    form = kind
      ? {
          name: kind.name,
          code: kind.code,
          category: kind.category,
          isPunchList: kind.isPunchList,
          active: kind.active,
        }
      : { name: '', code: '', category: 'general', isPunchList: false, active: true };
    fields = {};
    editError = '';
    editOpen = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    editError = '';
    fields = {};
    try {
      await api(selected ? `${endpoint}/${selected.id}` : endpoint, {
        method: selected ? 'PATCH' : 'POST',
        body: form,
      });
      editOpen = false;
      toast('Jenis WO disimpan');
      await load();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) fields = err.fields;
      else editError = err instanceof ApiError ? err.message : 'Jenis WO gagal disimpan.';
    } finally {
      busy = false;
    }
  }

  async function reorder(id: string, to: number) {
    if (!kinds || busy || to < 0 || to >= kinds.length) return;
    const ids = kinds.map((kind) => kind.id);
    const from = ids.indexOf(id);
    if (from < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    busy = true;
    try {
      await api(`${endpoint}/order`, { method: 'PUT', body: { ids } });
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Urutan gagal disimpan.', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!selected || busy) return;
    busy = true;
    editError = '';
    try {
      await api(`${endpoint}/${selected.id}`, { method: 'DELETE' });
      deleteOpen = false;
      toast('Jenis WO dihapus');
      await load();
    } catch (err) {
      editError = err instanceof ApiError ? err.message : 'Jenis WO gagal dihapus.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Jenis WO · REIN</title></svelte:head>
{#if !allowed}
  <EmptyState
    icon="lock"
    title="Tidak ada akses"
    message="Halaman ini memerlukan izin kelola jenis WO."
  />
{:else}
  <div class="surface">
    <header>
      <h1>Jenis WO</h1>
      <Button variant="primary" icon="plus" onclick={() => edit(null)}>Tambah jenis WO</Button>
    </header>
    {#if error}
      <p role="alert">{error}</p>
      <Button onclick={load}>Coba lagi</Button>
    {:else if !kinds}
      <p role="status">Memuat jenis WO…</p>
    {:else if !kinds.length}
      <p>Belum ada jenis WO.</p>
    {:else}
      <ul aria-label="Urutan jenis WO">
        {#each kinds as kind, i (kind.id)}
          <li
            draggable={!busy}
            ondragstart={(e) => {
              dragged = kind.id;
              e.dataTransfer?.setData('text/plain', kind.id);
            }}
            ondragend={() => (dragged = null)}
            ondragover={(e) => {
              if (dragged) e.preventDefault();
            }}
            ondrop={(e) => {
              e.preventDefault();
              if (dragged) void reorder(dragged, i);
              dragged = null;
            }}
          >
            <div>
              <b>{kind.name} · {kind.code}</b>
              <small
                ><CategoryDot category={kind.category} />{WO_CATEGORY_META[kind.category].label} · {kind.active
                  ? 'Aktif'
                  : 'Nonaktif'} · {kind.usage} WO</small
              >
            </div>
            <div class="actions">
              <Button
                aria-label={`Naikkan ${kind.name}`}
                disabled={busy || i === 0}
                onclick={() => reorder(kind.id, i - 1)}>↑</Button
              >
              <Button
                aria-label={`Turunkan ${kind.name}`}
                disabled={busy || i === (kinds?.length ?? 0) - 1}
                onclick={() => reorder(kind.id, i + 1)}>↓</Button
              >
              <Button onclick={() => edit(kind)}>Ubah</Button>
              <Button
                disabled={kind.usage > 0}
                title={kind.usage > 0 ? 'Jenis sudah dipakai WO' : undefined}
                onclick={() => {
                  selected = kind;
                  editError = '';
                  deleteOpen = true;
                }}>Hapus</Button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<Modal bind:open={editOpen} title={selected ? 'Ubah jenis WO' : 'Tambah jenis WO'} width={460}>
  <form id="wo-type" onsubmit={save}>
    {#if editError}<p role="alert">{editError}</p>{/if}
    <Input label="Nama jenis" bind:value={form.name} error={fields.name} required maxlength={60} />
    <Input label="Kode" bind:value={form.code} error={fields.code} required maxlength={4} />
    <Field label="Kategori" id="wo-type-category" error={fields.category}>
      <select id="wo-type-category" bind:value={form.category}>
        {#each WO_CATEGORIES as category (category)}<option value={category}
            >{WO_CATEGORY_META[category].label}</option
          >{/each}
      </select>
    </Field>
    <Toggle label="Aktif" bind:checked={form.active} showLabel />
  </form>
  {#snippet footer()}
    <Button onclick={() => (editOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="wo-type" loading={busy}>Simpan</Button>
  {/snippet}
</Modal>

<Modal bind:open={deleteOpen} title="Hapus jenis WO?" width={440}>
  <p>{selected?.name} akan dihapus dari daftar jenis WO.</p>
  {#if editError}<p role="alert">{editError}</p>{/if}
  {#snippet footer()}
    <Button onclick={() => (deleteOpen = false)}>Batal</Button>
    <Button variant="danger" loading={busy} onclick={remove}>Hapus</Button>
  {/snippet}
</Modal>

<style>
  .surface {
    padding: 20px 24px;
  }
  header,
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  ul {
    list-style: none;
    padding: 0;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  li {
    padding: 8px 12px;
  }
  li + li {
    border-top: 1px solid var(--color-border-default);
  }
  small {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--color-text-secondary);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  form {
    display: grid;
    gap: 12px;
  }
</style>
