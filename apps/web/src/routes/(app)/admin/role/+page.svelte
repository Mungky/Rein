<script lang="ts">
  import type { PermissionKey, PermissionMap, Scope } from '@rein/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { hasGlobal, loadMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  interface Role {
    id: string;
    name: string;
    divisionLabel: string;
    systemKey: string | null;
    userCount: number;
    permissions: PermissionMap;
  }
  interface Catalog {
    key: PermissionKey;
    label: string;
    scopes: Scope[];
  }
  const labels: Record<Scope, string> = {
    none: 'Tidak diizinkan',
    all: 'Semua / global',
    managed: 'Project yang dikelola',
    member: 'Project yang diikuti',
    own: 'Milik / tugas sendiri',
  };
  const allowed = $derived(hasGlobal('admin.roles'));
  let roles = $state<Role[]>([]);
  let catalog = $state<Catalog[]>([]);
  let selectedId = $state('');
  let draft = $state<PermissionMap>({});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let modal = $state(false);
  let deleteOpen = $state(false);
  let editing = $state<string | null>(null);
  let form = $state({ name: '', divisionLabel: '', copyFrom: '' });
  let formError = $state('');
  const selected = $derived(roles.find((r) => r.id === selectedId));
  const dirty = $derived(
    catalog.some((p) => (draft[p.key] ?? 'none') !== (selected?.permissions[p.key] ?? 'none')),
  );
  const message = (err: unknown) =>
    err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.';

  function select(id: string) {
    selectedId = id;
    draft = { ...roles.find((r) => r.id === id)?.permissions };
    error = '';
  }
  async function load(id = selectedId) {
    loading = true;
    error = '';
    try {
      const result = await api<{ roles: Role[]; catalog: Catalog[] }>('/api/admin/roles/detail');
      roles = result.roles;
      catalog = result.catalog;
      select(roles.some((r) => r.id === id) ? id : (roles[0]?.id ?? ''));
    } catch (err) {
      error = message(err);
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    if (allowed) void load();
  });

  async function savePermissions() {
    if (!selected) return;
    busy = true;
    error = '';
    try {
      await api(`/api/admin/roles/${selected.id}/permissions`, {
        method: 'PUT',
        body: {
          permissions: catalog.map((p) => ({ permission: p.key, scope: draft[p.key] ?? 'none' })),
        },
      });
      selected.permissions = { ...draft };
      await loadMe(true);
      toast('Izin role disimpan. Perubahan berlaku pada permintaan berikutnya.');
    } catch (err) {
      error = message(err);
    } finally {
      busy = false;
    }
  }
  function openForm(mode: 'new' | 'edit' | 'copy') {
    editing = mode === 'edit' ? selectedId : null;
    form = {
      name:
        mode === 'edit'
          ? (selected?.name ?? '')
          : mode === 'copy'
            ? `${selected?.name ?? ''} (salinan)`
            : '',
      divisionLabel: mode === 'new' ? '' : (selected?.divisionLabel ?? ''),
      copyFrom: mode === 'copy' ? selectedId : '',
    };
    formError = '';
    modal = true;
  }
  async function saveRole(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    formError = '';
    try {
      const result = await api<{ id?: string }>(
        editing ? `/api/admin/roles/${editing}` : '/api/admin/roles',
        {
          method: editing ? 'PATCH' : 'POST',
          body: {
            name: form.name,
            divisionLabel: form.divisionLabel,
            ...(!editing && form.copyFrom ? { copyFrom: form.copyFrom } : {}),
          },
        },
      );
      modal = false;
      await load(editing ?? result.id);
      await loadMe(true);
      toast('Role disimpan.');
    } catch (err) {
      formError = message(err);
    } finally {
      busy = false;
    }
  }
  async function remove() {
    if (!selected) return;
    busy = true;
    error = '';
    try {
      await api(`/api/admin/roles/${selected.id}`, { method: 'DELETE' });
      deleteOpen = false;
      await load('');
      toast('Role dihapus.');
    } catch (err) {
      error = message(err);
      deleteOpen = false;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Role & izin · REIN</title></svelte:head>

{#if !allowed}
  <EmptyState
    icon="users"
    title="Akses terbatas"
    message="Anda tidak memiliki izin mengelola role."
  />
{:else}
  <div class="toolbar">
    <p>Atur akses berdasarkan role. Setiap pengguna memiliki satu role global.</p>
    <Button icon="plus" variant="primary" onclick={() => openForm('new')} disabled={busy || dirty}
      >Tambah role</Button
    >
  </div>
  <div class="content">
    {#if error}<p class="error" role="alert">{error}</p>
      <Button onclick={() => load()}>Muat ulang</Button>{/if}
    {#if loading}<p role="status">Memuat role & izin…</p>
    {:else if selected}
      <div class="role-header">
        <label for="selected-role">Role</label>
        <select
          id="selected-role"
          value={selectedId}
          onchange={(e) => select(e.currentTarget.value)}
          disabled={busy || dirty}
        >
          {#each roles as role (role.id)}<option value={role.id}
              >{role.name} · {role.userCount} pengguna</option
            >{/each}
        </select>
        <div class="actions">
          <Button onclick={() => openForm('edit')} disabled={busy || dirty}
            >Ubah nama / divisi</Button
          >
          <Button onclick={() => openForm('copy')} disabled={busy || dirty}>Duplikat</Button>
          {#if !selected.systemKey && selected.userCount === 0}
            <Button onclick={() => (deleteOpen = true)} disabled={busy || dirty}>Hapus role</Button>
          {/if}
        </div>
      </div>
      <p class="hint">
        {selected.divisionLabel || 'Divisi belum diisi'} · {selected.userCount} pengguna. Pilih cakupan
        untuk setiap izin, lalu simpan.
      </p>
      <p class="hint">
        Untuk membuat project, aktifkan <strong>Buat project</strong>. Scope pengelola berlaku
        ketika pengguna ditandai sebagai pengelola di anggota project.
      </p>
      <div class="permissions">
        {#each catalog as p (p.key)}
          <div class="permission">
            <label for={'permission-' + p.key}>{p.label}</label>
            <select
              id={'permission-' + p.key}
              value={draft[p.key] ?? 'none'}
              disabled={busy ||
                (selected.systemKey === 'admin' && ['admin.roles', 'admin.users'].includes(p.key))}
              onchange={(e) => (draft[p.key] = e.currentTarget.value as Scope)}
            >
              <option value="none">{labels.none}</option>
              {#each p.scopes as scope (scope)}<option value={scope}>{labels[scope]}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
      {#if selected.systemKey === 'admin'}<p class="hint">
          Izin Kelola role & izin dan Kelola pengguna wajib aktif agar akses Admin tetap tersedia.
        </p>{/if}
      <div class="save">
        <span role="status"
          >{dirty ? 'Ada perubahan yang belum disimpan.' : 'Izin sesuai data tersimpan.'}</span
        >
        <Button onclick={() => select(selectedId)} disabled={!dirty || busy}
          >Batalkan perubahan</Button
        >
        <Button variant="primary" onclick={savePermissions} loading={busy} disabled={!dirty}
          >Simpan izin</Button
        >
      </div>
    {/if}
  </div>
{/if}

<Modal bind:open={modal} title={editing ? 'Ubah role' : 'Tambah role'} width={480}>
  <form id="role-form" onsubmit={saveRole}>
    <Input label="Nama role" bind:value={form.name} required minlength={2} maxlength={60} />
    <Input label="Divisi" bind:value={form.divisionLabel} maxlength={60} />
    {#if !editing}
      <label for="copy-from">Salin izin dari</label>
      <select id="copy-from" bind:value={form.copyFrom}>
        <option value="">Tanpa izin awal</option>
        {#each roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
      </select>
    {/if}
    {#if formError}<p class="error" role="alert">{formError}</p>{/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (modal = false)} disabled={busy}>Batal</Button>
    <Button type="submit" form="role-form" variant="primary" loading={busy}>Simpan role</Button>
  {/snippet}
</Modal>
<Modal bind:open={deleteOpen} title="Hapus role" width={400}>
  <p>Hapus role {selected?.name}? Role ini belum digunakan pengguna.</p>
  {#snippet footer()}
    <Button onclick={() => (deleteOpen = false)} disabled={busy}>Batal</Button>
    <Button onclick={remove} loading={busy}>Hapus role</Button>
  {/snippet}
</Modal>

<style>
  .toolbar,
  .actions,
  .save {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .toolbar {
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border-default);
    justify-content: space-between;
  }
  p {
    margin: 0;
  }
  .toolbar p,
  .hint,
  .save span {
    color: var(--color-text-secondary);
  }
  .content {
    padding: 24px;
    max-width: 960px;
    display: grid;
    gap: 16px;
  }
  .role-header,
  form {
    display: grid;
    gap: 8px;
  }
  .role-header > select {
    max-width: 400px;
  }
  select {
    width: 100%;
    min-height: 32px;
    padding: 4px 8px;
    color: var(--color-text-primary);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  select:focus-visible {
    outline: 2px solid var(--color-accent-default);
    outline-offset: 2px;
  }
  .permissions {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .permission {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: 16px;
    align-items: center;
    padding: 8px 12px;
    background: var(--color-bg-surface);
  }
  .permission + .permission {
    border-top: 1px solid var(--color-border-default);
  }
  .save span {
    flex: 1;
  }
  .error {
    color: var(--color-danger-default);
  }
  @media (max-width: 767px) {
    .toolbar,
    .content {
      padding: 16px;
    }
    .permission {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      padding: 12px;
    }
    select {
      min-height: 44px;
    }
    .save span {
      flex-basis: 100%;
    }
  }
</style>
