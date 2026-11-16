<script lang="ts">
  import { onMount } from 'svelte';
  import type { PermissionKey, PermissionMap, Scope } from '@rein/shared';
  import { api, ApiError } from '$lib/api';
  import { loadMe } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import Button from './Button.svelte';
  let { userId }: { userId: string } = $props();
  interface Data {
    roleName: string;
    systemKey: string | null;
    inherited: PermissionMap;
    overrides: PermissionMap;
    catalog: { key: PermissionKey; label: string; scopes: Scope[] }[];
  }
  let data = $state<Data | null>(null);
  let draft = $state<PermissionMap>({});
  let busy = $state(false);
  let error = $state('');
  const labels: Record<Scope, string> = {
    none: 'Tidak diizinkan',
    all: 'Semua / global',
    managed: 'Project yang dikelola',
    member: 'Project yang diikuti',
    own: 'Milik / tugas sendiri',
  };
  async function load() {
    try {
      data = await api<Data>(`/api/admin/users/${userId}/access`);
      draft = { ...data.overrides };
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal memuat izin';
    }
  }
  onMount(() => {
    void load();
  });
  async function save(reset = false) {
    busy = true;
    error = '';
    try {
      await api(`/api/admin/users/${userId}/access`, {
        method: 'PUT',
        body: {
          permissions: reset
            ? []
            : Object.entries(draft).map(([permission, scope]) => ({ permission, scope })),
        },
      });
      await load();
      await loadMe(true);
      toast('Akses pengguna disimpan');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Gagal menyimpan izin';
    } finally {
      busy = false;
    }
  }
  function set(key: PermissionKey, value: string) {
    if (value === '') {
      const next = { ...draft };
      delete next[key];
      draft = next;
    } else draft[key] = value as Scope;
  }
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if data}
  <p>
    Role: <b>{data.roleName}</b>. Ikuti role untuk memakai izin bawaan, atau tentukan pengecualian
    khusus pengguna ini.
  </p>
  <div class="permissions">
    {#each data.catalog as p (p.key)}
      <label
        >{p.label}
        <select
          value={draft[p.key] ?? ''}
          disabled={busy ||
            (data.systemKey === 'admin' && ['admin.users', 'admin.roles'].includes(p.key))}
          onchange={(e) => set(p.key, e.currentTarget.value)}
        >
          <option value="">Ikuti role — {labels[data.inherited[p.key] ?? 'none']}</option>
          <option value="none">Tidak diizinkan</option>
          {#each p.scopes as scope (scope)}<option value={scope}>{labels[scope]}</option>{/each}
        </select>
      </label>
    {/each}
  </div>
  <div class="actions">
    <Button onclick={() => save(true)} disabled={busy}>Kembalikan semua ke role</Button><Button
      variant="primary"
      onclick={() => save()}
      loading={busy}>Simpan akses pengguna</Button
    >
  </div>
{:else}<p role="status">Memuat izin…</p>{/if}

<style>
  .permissions {
    display: grid;
    gap: 8px;
  }
  label {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border-default);
  }
  select {
    width: 100%;
    min-height: 36px;
    padding: 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .error {
    color: var(--color-danger-default);
  }
  @media (max-width: 767px) {
    label {
      grid-template-columns: minmax(0, 1fr);
    }
    select {
      min-height: 44px;
    }
  }
</style>
