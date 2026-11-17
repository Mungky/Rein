<script lang="ts">
  import type { PermissionKey, PermissionMap, Scope } from '@rein/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
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
  const groups = [
    { label: 'Project', prefixes: ['project.', 'view.'] },
    { label: 'Logbook & lampiran', prefixes: ['logbook.', 'attachment.'] },
    { label: 'Work Order', prefixes: ['wo.'] },
    { label: 'Administrasi', prefixes: ['admin.'] },
  ];
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
    <span class="muted">Kelola role dan cakupan akses pengguna</span>
    <Button icon="plus" variant="primary" onclick={() => openForm('new')} disabled={busy || dirty}
      >Role baru</Button
    >
  </div>
  {#if error}<div class="error-banner" role="alert">
      {error}<Button onclick={() => load()}>Muat ulang</Button>
    </div>{/if}
  {#if loading}<p class="loading" role="status">Memuat role & izin…</p>
  {:else if selected}
    <div class="role-screen">
      <nav class="role-list" aria-label="Daftar role">
        {#each roles as role (role.id)}
          <button
            class:active={selectedId === role.id}
            aria-current={selectedId === role.id ? 'true' : undefined}
            disabled={busy || dirty}
            onclick={() => select(role.id)}
          >
            <span>{role.name}</span><small>{role.userCount}</small>
          </button>
        {/each}
      </nav>
      <div class="editor">
        <header class="editor-header">
          <div>
            <h1>{selected.name}</h1>
            <p class="hint">
              {selected.divisionLabel || 'Tanpa divisi'} · {selected.userCount} pengguna
            </p>
          </div>
          <div class="actions">
            <Button variant="ghost" onclick={() => openForm('edit')} disabled={busy || dirty}
              >Ubah nama</Button
            >
            <Button variant="ghost" onclick={() => openForm('copy')} disabled={busy || dirty}
              >Duplikat</Button
            >
            {#if selected.systemKey !== 'admin'}<Button
                variant="ghost"
                onclick={() => (deleteOpen = true)}
                disabled={busy || dirty || selected.userCount > 0}>Hapus</Button
              >{/if}
            <Button variant="primary" onclick={savePermissions} loading={busy} disabled={!dirty}
              >Simpan perubahan</Button
            >
          </div>
        </header>
        <p class="hint">Aktifkan izin dan pilih cakupannya. Perubahan berlaku setelah disimpan.</p>
        <div class="permission-groups">
          {#each groups as group (group.label)}
            <section class="permission-group">
              <h2>{group.label}</h2>
              {#each catalog.filter( (p) => group.prefixes.some( (prefix) => p.key.startsWith(prefix) ) ) as p (p.key)}
                {@const enabled = (draft[p.key] ?? 'none') !== 'none'}
                {@const fixed =
                  selected.systemKey === 'admin' && ['admin.roles', 'admin.users'].includes(p.key)}
                <div class="permission">
                  <div class="permission-label">
                    <span id={'label-' + p.key}>{p.label}</span>
                    {#if enabled && p.scopes.length > 1}
                      <select
                        aria-label={'Cakupan ' + p.label}
                        value={draft[p.key]}
                        disabled={busy || fixed}
                        onchange={(e) => (draft[p.key] = e.currentTarget.value as Scope)}
                      >
                        {#each p.scopes as scope (scope)}<option value={scope}
                            >{labels[scope]}</option
                          >{/each}
                      </select>
                    {:else}<small
                        >{enabled ? labels[draft[p.key] as Scope] : 'Tidak diizinkan'}</small
                      >{/if}
                  </div>
                  <Toggle
                    checked={enabled}
                    label={p.label}
                    disabled={busy || fixed}
                    onchange={(on) => (draft[p.key] = on ? (p.scopes[0] ?? 'all') : 'none')}
                  />
                </div>
              {/each}
            </section>
          {/each}
        </div>
        <div class="save">
          <span role="status"
            >{dirty ? 'Ada perubahan yang belum disimpan.' : 'Semua perubahan tersimpan.'}</span
          >
          {#if dirty}<Button onclick={() => select(selectedId)} disabled={busy}
              >Batalkan perubahan</Button
            >{/if}
        </div>
        {#if selected.systemKey === 'admin'}<p class="hint">
            Izin mengelola pengguna dan role Admin selalu aktif.
          </p>
        {:else if selected.userCount > 0}<p class="hint">
            Pindahkan penggunanya ke role lain sebelum menghapus role ini.
          </p>{/if}
      </div>
    </div>
  {:else}<EmptyState
      icon="users"
      title="Belum ada role"
      message="Tambahkan role untuk mengatur akses."
    />{/if}
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
  .role-screen {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: calc(100dvh - 102px);
  }
  .role-list {
    padding: 16px 12px;
    border-right: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .role-list button {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
    text-align: left;
    min-height: 36px;
    padding: 8px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
  .role-list button:hover {
    background: var(--color-bg-hover);
  }
  .role-list button.active {
    background: var(--color-accent-subtle);
    color: var(--color-accent-default);
  }
  .role-list small {
    color: var(--color-text-tertiary);
    font: var(--text-caption);
  }
  .editor {
    padding: 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .editor-header h1 {
    font: var(--text-title);
    margin-bottom: 4px;
  }
  .hint,
  .save {
    color: var(--color-text-tertiary);
    font: var(--text-caption);
  }
  .permission-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .permission-group {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .permission-group h2 {
    padding: 8px 16px;
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font: var(--text-label);
    border-bottom: 1px solid var(--color-border-default);
  }
  .permission {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 56px;
    padding: 8px 16px;
  }
  .permission + .permission {
    border-top: 1px solid var(--color-border-default);
  }
  .permission-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .permission-label small {
    color: var(--color-text-tertiary);
    font: var(--text-caption);
  }
  .permission-label select {
    font: var(--text-caption);
    color: var(--color-text-secondary);
    padding: 2px 4px;
    max-width: 100%;
  }
  select {
    color: var(--color-text-primary);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
  }
  .save {
    justify-content: space-between;
    border-top: 1px solid var(--color-border-default);
    padding-top: 16px;
  }
  form {
    display: grid;
    gap: 12px;
  }
  .error,
  .error-banner {
    color: var(--color-danger-default);
  }
  .error-banner,
  .loading {
    padding: 16px 24px;
  }
  @media (max-width: 1100px) {
    .permission-groups {
      grid-template-columns: 1fr;
    }
    .editor {
      padding: 20px;
    }
  }
  @media (max-width: 767px) {
    .role-screen {
      grid-template-columns: 1fr;
    }
    .role-list {
      border-right: 0;
      border-bottom: 1px solid var(--color-border-default);
      flex-direction: row;
      overflow-x: auto;
    }
    .role-list button {
      flex: none;
      max-width: 240px;
      min-height: 44px;
    }
    .editor,
    .toolbar {
      padding: 16px;
    }
    .permission-label select {
      min-height: 32px;
    }
  }
</style>
