<script lang="ts">
  import { memberUpsertSchema } from '@rein/shared';
  import { tick } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type { ProjectDetail } from '$lib/types';
  import Avatar from './Avatar.svelte';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import Modal from './Modal.svelte';
  import Toggle from './Toggle.svelte';

  type Member = ProjectDetail['members'][number];
  interface DirectoryUser {
    id: string;
    fullName: string;
    roleName: string;
    avatarUrl: string | null;
  }

  let {
    project,
    onclose,
    onchange,
  }: {
    project: ProjectDetail;
    onclose: () => void;
    onchange: () => Promise<void>;
  } = $props();
  let mode = $state<'list' | 'add' | 'edit' | 'remove'>('list');
  let body: HTMLDivElement;
  let target = $state<Member | null>(null);
  let form = $state({ userId: '', projectRole: 'Anggota', isProjectManager: false });
  let query = $state('');
  let directory = $state<DirectoryUser[] | null>(null);
  let searchError = $state('');
  let searchAttempt = $state(0);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  const candidates = $derived(
    directory?.filter((u) => !project.members.some((m) => m.userId === u.id)),
  );
  const title = $derived(
    mode === 'add'
      ? 'Tambah anggota'
      : mode === 'edit'
        ? 'Edit anggota'
        : mode === 'remove'
          ? 'Keluarkan anggota'
          : project.can.manageMembers
            ? 'Kelola anggota'
            : 'Anggota project',
  );

  async function show(next: typeof mode) {
    mode = next;
    await tick();
    (body?.querySelector<HTMLElement>('input:not([disabled])') ?? body)?.focus();
  }

  function openForm(member: Member | null) {
    target = member;
    form = member
      ? {
          userId: member.userId,
          projectRole: member.projectRole,
          isProjectManager: member.isProjectManager,
        }
      : { userId: '', projectRole: 'Anggota', isProjectManager: false };
    query = '';
    error = '';
    notice = '';
    void show(member ? 'edit' : 'add');
  }

  $effect(() => {
    if (mode !== 'add') return;
    const term = query.trim();
    void searchAttempt;
    const controller = new AbortController();
    directory = null;
    searchError = '';
    const timer = setTimeout(async () => {
      try {
        const result = await api<{ users: DirectoryUser[] }>(
          `/api/directory/users?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) directory = result.users;
      } catch (err) {
        if (!controller.signal.aborted) {
          searchError = err instanceof ApiError ? err.message : 'Pengguna gagal dimuat.';
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy || mode === 'list' || !project.can.manageMembers) return;
    error = '';
    const removing = mode === 'remove';
    const parsed = memberUpsertSchema.safeParse(form);
    if (!removing && !parsed.success) {
      error = parsed.error.issues[0]?.message ?? 'Periksa data anggota.';
      return;
    }
    busy = true;
    try {
      const path = `/api/projects/${project.id}/members`;
      if (removing) await api(`${path}/${form.userId}`, { method: 'DELETE', body: {} });
      else if (parsed.success) await api(path, { method: 'PUT', body: parsed.data });
      await onchange();
      notice = removing
        ? 'Anggota dikeluarkan'
        : mode === 'edit'
          ? 'Peran diperbarui'
          : 'Anggota ditambahkan';
      await show('list');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Perubahan anggota gagal disimpan.';
    } finally {
      busy = false;
    }
  }
</script>

<Modal open {title} width={520} {onclose}>
  <div bind:this={body} tabindex="-1">
    <div role="status" class="notice muted">{notice}</div>
    {#if mode === 'list'}
      {#if !project.members.length}<p class="muted">Belum ada anggota di project ini.</p>{/if}
      <ul class="members">
        {#each project.members as member (member.userId)}
          <li>
            <Avatar name={member.fullName} src={member.avatarUrl} size={32} />
            <div>
              <b>{member.fullName}</b>
              <small
                >{member.roleName} · {member.projectRole}{member.isProjectManager
                  ? ' · Pengelola'
                  : ''}</small
              >
            </div>
            {#if project.can.manageMembers}
              <Button
                variant="ghost"
                aria-label={`Edit anggota ${member.fullName}`}
                onclick={() => openForm(member)}>Edit</Button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <form id="project-member" onsubmit={save}>
        {#if mode === 'add'}
          <Input
            label="Cari pengguna"
            bind:value={query}
            oninput={() => (form.userId = '')}
            placeholder="Nama atau username"
            disabled={busy}
          />
          {#if searchError}
            <p role="alert">{searchError}</p>
            <Button onclick={() => (searchAttempt += 1)}>Coba lagi</Button>
          {:else if !candidates}
            <p role="status" class="muted">Memuat pengguna…</p>
          {:else if !candidates.length}
            <p class="muted">Tidak ada pengguna yang bisa ditambahkan.</p>
          {:else}
            <ul class="pick" aria-label="Pengguna yang bisa ditambahkan">
              {#each candidates as user (user.id)}
                <li>
                  <label>
                    <input
                      type="radio"
                      name="member-user"
                      value={user.id}
                      bind:group={form.userId}
                      disabled={busy}
                    />
                    <Avatar name={user.fullName} src={user.avatarUrl} size={24} />
                    <span>{user.fullName} <small>· {user.roleName}</small></span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if mode === 'edit'}
          <p><b>{target?.fullName}</b></p>
        {:else}
          <p>Keluarkan <b>{target?.fullName}</b> dari project ini?</p>
        {/if}
        {#if mode !== 'remove'}
          <Input
            label="Peran di project"
            bind:value={form.projectRole}
            maxlength={40}
            required
            disabled={busy}
          />
          <Toggle
            bind:checked={form.isProjectManager}
            label="Pengelola project"
            showLabel
            disabled={busy}
          />
        {/if}
        {#if error}<p role="alert">{error}</p>{/if}
      </form>
    {/if}
  </div>
  {#snippet footer()}
    {#if mode === 'list'}
      <Button onclick={onclose}>Tutup</Button>
      {#if project.can.manageMembers}
        <Button variant="primary" icon="plus" onclick={() => openForm(null)}>Tambah anggota</Button>
      {/if}
    {:else}
      {#if mode === 'edit'}
        <Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            error = '';
            void show('remove');
          }}>Keluarkan</Button
        >
      {/if}
      <Button
        disabled={busy}
        onclick={() => {
          error = '';
          void show(mode === 'remove' ? 'edit' : 'list');
        }}>Kembali</Button
      >
      <Button
        type="submit"
        form="project-member"
        variant={mode === 'remove' ? 'danger' : 'primary'}
        loading={busy}
        disabled={mode !== 'remove' && (!form.userId || !form.projectRole.trim())}
      >
        {mode === 'add' ? 'Tambahkan' : mode === 'remove' ? 'Keluarkan anggota' : 'Simpan'}
      </Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .notice:not(:empty) {
    margin-bottom: 8px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .members li,
  .pick label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .members li {
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border-default);
  }
  .members li div {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .members small {
    display: block;
  }
  small {
    color: var(--color-text-secondary);
  }
  form {
    display: grid;
    gap: 12px;
  }
  .pick {
    max-height: 220px;
    overflow: auto;
  }
  .pick label {
    padding: 6px;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .pick label:hover {
    background: var(--color-bg-hover);
  }
</style>
