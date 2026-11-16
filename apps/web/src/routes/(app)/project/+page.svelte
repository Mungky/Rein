<script lang="ts">
  import { PROJECT_STATUS_LABEL, WO_CATEGORY_META, type ProjectStatus } from '@rein/shared';
  import { goto, invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import ProjectImagePicker from '$lib/components/ProjectImagePicker.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { shortDate } from '$lib/format';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { ImageResult } from '$lib/image';
  import { uploadProjectImages } from '$lib/project-media';

  /** Daftar project (Figma D/03, M/03; FR-025) + Buat project 2 langkah (D/04a–b; FR-020). */
  let { data } = $props();

  let view = $state<'table' | 'kanban'>('table');
  let q = $state('');
  const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'done'];
  const list = $derived(
    data.projects.filter((p) => {
      const t = q.trim().toLowerCase();
      return (
        !t ||
        p.name.toLowerCase().includes(t) ||
        p.rpoNumber.toLowerCase().includes(t) ||
        p.clientName.toLowerCase().includes(t)
      );
    }),
  );
  const groups = $derived(STATUSES.map((s) => ({ s, items: list.filter((p) => p.status === s) })));
  let closed = $state<Record<string, boolean>>({ done: true });
  const catText = (cats: (typeof data.projects)[number]['activeCategories']) =>
    cats.map((c) => WO_CATEGORY_META[c].label).join(' · ') || '—';

  // ---------------------------------------------------------------- Buat project
  interface DirUser {
    id: string;
    fullName: string;
    roleName: string;
    avatarUrl: string | null;
  }
  const EMPTY = {
    clientName: '',
    rpoNumber: '',
    name: '',
    location: '',
    startDate: '',
    endDate: '',
    description: '',
  };
  let open = $state(false);
  let step = $state<1 | 2>(1);
  let f = $state({ ...EMPTY });
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let logo = $state<ImageResult | null>(null);
  let banner = $state<ImageResult | null>(null);
  let logoProcessing = $state(false);
  let bannerProcessing = $state(false);
  let users = $state<DirUser[]>([]);
  let picked = $state<Record<string, { role: string; pm: boolean }>>({});
  let uq = $state('');
  $effect(() => {
    if (!open || step !== 2) return;
    const term = uq;
    const t = setTimeout(async () => {
      users = (
        await api<{ users: DirUser[] }>(`/api/directory/users?q=${encodeURIComponent(term)}`)
      ).users;
    }, 200);
    return () => clearTimeout(t);
  });

  function next(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy || logoProcessing || bannerProcessing) return;
    errors = {};
    if (!f.clientName.trim()) errors.clientName = 'Nama klien wajib diisi';
    if (!f.rpoNumber.trim()) errors.rpoNumber = 'No RPO wajib diisi';
    if (!f.name.trim()) errors.name = 'Nama project wajib diisi';
    if (!f.startDate) errors.startDate = 'Isi tanggal mulai';
    if (!f.endDate) errors.endDate = 'Isi tanggal selesai';
    if (f.startDate && f.endDate && f.endDate < f.startDate) {
      errors.endDate = 'Tanggal selesai tidak boleh sebelum tanggal mulai';
    }
    if (!Object.keys(errors).length) step = 2;
  }

  function toggle(u: DirUser) {
    if (picked[u.id]) {
      const rest = { ...picked };
      delete rest[u.id];
      picked = rest;
    } else picked = { ...picked, [u.id]: { role: 'Anggota', pm: false } };
  }

  async function create() {
    if (busy || logoProcessing || bannerProcessing) return;
    busy = true;
    try {
      const body = Object.fromEntries(
        Object.entries(f)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v !== ''),
      );
      const media = await uploadProjectImages(session.me!.user.id, logo, banner);
      const { id } = await api<{ id: string }>('/api/projects', { body: { ...body, ...media } });
      for (const [userId, m] of Object.entries(picked)) {
        if (userId === session.me?.user.id) continue;
        await api(`/api/projects/${id}/members`, {
          method: 'PUT',
          body: { userId, projectRole: m.role || 'Anggota', isProjectManager: m.pm },
        }).catch(() => toast('Sebagian anggota gagal ditambahkan', { tone: 'danger' }));
      }
      toast('Project dibuat');
      open = false;
      await invalidate('app:projects');
      await goto(resolve('/(app)/project/[id]', { id }));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        errors = err.fields;
        step = 1;
      } else {
        toast(err instanceof ApiError ? err.message : 'Terjadi kesalahan', { tone: 'danger' });
      }
    } finally {
      busy = false;
    }
  }

  function openCreate() {
    logo = banner = null;
    f = { ...EMPTY };
    picked = {};
    errors = {};
    step = 1;
    open = true;
  }
</script>

<svelte:head><title>Project · REIN</title></svelte:head>

<div class="toolbar">
  <Segmented
    bind:value={view}
    options={[
      { value: 'table', label: 'Table', icon: 'table' },
      { value: 'kanban', label: 'Kanban', icon: 'kanban' },
    ]}
  />
  <label class="search">
    <Icon name="search" size={14} />
    <input placeholder="Cari project, RPO, klien" bind:value={q} aria-label="Cari project" />
  </label>
  <span class="sp"></span>
  {#if data.can.create}
    <Button variant="primary" icon="plus" onclick={openCreate}>Buat project</Button>
  {/if}
</div>

{#if !data.projects.length}
  <EmptyState
    icon="folder"
    title="Belum ada project"
    message={data.can.create
      ? 'Buat project pertama dari PO yang diterima.'
      : 'Anda belum memiliki izin membuat project. Minta Admin mengaktifkan Buat project pada role Anda atau menambahkan Anda sebagai anggota project.'}
  >
    {#if data.can.create}
      <Button variant="primary" icon="plus" onclick={openCreate}>Buat project</Button>
    {:else if session.me?.permissions['admin.roles'] === 'all'}
      <Button href={resolve('/admin/role')}>Atur izin role</Button>
    {/if}
  </EmptyState>
{:else if view === 'table'}
  <div class="tbl">
    {#each groups as g (g.s)}
      <button
        class="grp"
        class:closed={closed[g.s]}
        onclick={() => (closed[g.s] = !closed[g.s])}
        aria-expanded={!closed[g.s]}
      >
        <Icon name="chevron-down" size={14} class="chev" /><span class="st st-{g.s}"></span>
        {PROJECT_STATUS_LABEL[g.s]}<span class="n">{g.items.length}</span>
      </button>
      <div class="rows" class:closed={closed[g.s]}>
        <div>
          {#each g.items as p (p.id)}
            <a class="pr" href={resolve('/(app)/project/[id]', { id: p.id })}>
              <span class="nm"
                ><b
                  >{#if p.logoUrl}<img
                      class="project-logo"
                      src={p.logoUrl}
                      alt=""
                    />{/if}{p.name}</b
                ><span>{p.clientName}</span></span
              >
              <span class="faint tnum rpo">{p.rpoNumber}</span>
              <span class="cell cats">{catText(p.activeCategories)}</span>
              <span class="cell prog">
                <Progress value={p.progress} /><span class="tnum faint pc">{p.progress}%</span>
              </span>
              <span class="stack">
                {#each p.team as t (t.id)}<Avatar
                    name={t.fullName}
                    src={t.avatarUrl}
                    size={20}
                  />{/each}
              </span>
              <span class="cell">
                <Icon name="calendar" size={12} />{shortDate(p.startDate)} – {shortDate(p.endDate)}
              </span>
              <span>
                {#if p.urgentCount}
                  <span class="urg" title={`${p.urgentCount} WO urgent`}>{p.urgentCount}</span>
                {/if}
              </span>
            </a>
          {:else}
            <p class="faint none">Tidak ada project.</p>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="board">
    {#each groups as g (g.s)}
      <div class="col">
        <div class="col-h">
          <span class="st st-{g.s}"></span>{PROJECT_STATUS_LABEL[g.s]}<span class="n"
            >{g.items.length}</span
          >
        </div>
        {#each g.items as p (p.id)}
          <a class="pc" href={resolve('/(app)/project/[id]', { id: p.id })}>
            <div class="top">
              {#if p.logoUrl}<img
                  class="project-logo"
                  src={p.logoUrl}
                  alt={'Foto/logo ' + p.clientName}
                />{/if}
              <span class="tnum">{p.rpoNumber}</span>{#if p.urgentCount}<span class="urg">!</span
                >{/if}
            </div>
            <div>
              <b>{p.name}</b>
              <div class="faint small">{p.clientName}</div>
            </div>
            <div class="cell prog">
              <Progress value={p.progress} /><span class="tnum faint pc">{p.progress}%</span>
            </div>
            <div class="faint small">{catText(p.activeCategories)}</div>
          </a>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<Modal bind:open title={step === 1 ? 'Buat project — Info' : 'Buat project — Anggota'} width={600}>
  {#if step === 1}
    <form id="pc-1" class="g" onsubmit={next} novalidate>
      <div class="two">
        <ProjectImagePicker
          kind="logo"
          bind:image={logo}
          bind:busy={logoProcessing}
          disabled={busy}
        />
        <ProjectImagePicker
          kind="banner"
          bind:image={banner}
          bind:busy={bannerProcessing}
          disabled={busy}
        />
      </div>
      <div class="two">
        <Input label="Klien" bind:value={f.clientName} error={errors.clientName} maxlength={120} />
        <Input label="No RPO" bind:value={f.rpoNumber} error={errors.rpoNumber} maxlength={40} />
      </div>
      <Input label="Nama project" bind:value={f.name} error={errors.name} maxlength={160} />
      <Input label="Lokasi (opsional)" bind:value={f.location} maxlength={160} />
      <div class="two">
        <Input label="Mulai" type="date" bind:value={f.startDate} error={errors.startDate} />
        <Input label="Target selesai" type="date" bind:value={f.endDate} error={errors.endDate} />
      </div>
      <Field label="Deskripsi (opsional)" id="pc-desc" error={errors.description}>
        <textarea id="pc-desc" bind:value={f.description} rows="3" maxlength="500"></textarea>
      </Field>
    </form>
  {:else}
    <div class="g">
      <p class="muted small">
        Anda otomatis menjadi pengelola project. Pilih anggota lain (bisa ditambah nanti).
      </p>
      <Input label="Cari pengguna" bind:value={uq} placeholder="Nama atau username" />
      <ul class="pick">
        {#each users.filter((u) => u.id !== session.me?.user.id) as u (u.id)}
          <li class:on={!!picked[u.id]}>
            <label>
              <input type="checkbox" checked={!!picked[u.id]} onchange={() => toggle(u)} />
              <Avatar name={u.fullName} src={u.avatarUrl} size={24} />
              <span class="nm2">{u.fullName}<small class="faint"> · {u.roleName}</small></span>
            </label>
            {#if picked[u.id]}
              <input
                class="role"
                aria-label={`Peran ${u.fullName}`}
                bind:value={picked[u.id]!.role}
                maxlength="40"
              />
              <Toggle bind:checked={picked[u.id]!.pm} label="Pengelola" />
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#snippet footer()}
    {#if step === 1}
      <Button onclick={() => (open = false)}>Batal</Button>
      <Button
        variant="primary"
        type="submit"
        form="pc-1"
        disabled={logoProcessing || bannerProcessing}>Lanjut</Button
      >
    {:else}
      <Button onclick={() => (step = 1)}>Kembali</Button>
      <Button variant="primary" loading={busy} onclick={create}>Buat project</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .project-logo {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-md);
    object-fit: cover;
    flex: none;
    vertical-align: middle;
    margin-right: 8px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 24px;
    border-bottom: 1px solid var(--color-border-default);
    flex-wrap: wrap;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-icon-default);
  }
  .search input {
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    width: 200px;
  }
  .sp {
    flex: 1;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 24px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .grp :global(.chev) {
    transition: transform 0.2s var(--ease);
  }
  .grp.closed :global(.chev) {
    transform: rotate(-90deg);
  }
  .n {
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
  .rows {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.25s var(--ease);
  }
  .rows > div {
    overflow: hidden;
  }
  .rows.closed {
    grid-template-rows: 0fr;
  }
  .pr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 112px 190px 120px 64px 130px 28px;
    gap: 12px;
    align-items: center;
    height: 44px;
    padding: 0 24px;
    border-bottom: 1px solid var(--color-border-default);
    color: inherit;
    text-decoration: none;
    transition: background var(--dur);
  }
  .pr:hover {
    background: var(--color-bg-hover);
    text-decoration: none;
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .nm b {
    font-weight: 500;
    white-space: nowrap;
  }
  .nm span {
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rpo {
    font-size: 12px;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cats {
    display: block;
  }
  .prog .pc {
    font-size: 12px;
    width: 32px;
    text-align: right;
  }
  .stack {
    display: inline-flex;
  }
  .stack :global(.av + .av) {
    margin-left: -5px;
  }
  .urg {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--color-danger-default);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
  }
  .st {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent-default);
  }
  .st-on_hold {
    background: var(--color-text-tertiary);
  }
  .st-done {
    background: var(--color-success-default);
  }
  .none {
    padding: 10px 24px;
  }
  .board {
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    overflow-x: auto;
    align-items: flex-start;
  }
  .col {
    width: 300px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .col-h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    font-weight: 500;
  }
  .pc {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-1);
    color: inherit;
    text-decoration: none;
    transition:
      border-color var(--dur),
      transform var(--dur);
  }
  .pc:hover {
    border-color: var(--color-border-strong);
    transform: translateY(-1px);
    text-decoration: none;
  }
  .pc b {
    font-weight: 500;
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .top .urg {
    margin-left: auto;
  }
  .small {
    font-size: 12px;
  }
  .g {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .pick {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 300px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pick li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-md);
  }
  .pick li.on {
    background: var(--color-accent-subtle);
  }
  .pick label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .nm2 {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role {
    width: 120px;
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  @media (max-width: 767px) {
    .toolbar {
      padding: 10px 16px;
    }
    .search input {
      width: 140px;
    }
    .pr {
      grid-template-columns: minmax(0, 1fr) 56px;
      height: auto;
      padding: 10px 16px;
    }
    .pr > :not(.nm):not(.prog) {
      display: none;
    }
    .nm {
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }
    .two {
      grid-template-columns: 1fr;
    }
    .board {
      padding: 12px 16px;
    }
  }
</style>
