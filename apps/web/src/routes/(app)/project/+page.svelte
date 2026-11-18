<script lang="ts">
  import { PROJECT_STATUS_LABEL, type ProjectStatus } from '@rein/shared';
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
  import Toggle from '$lib/components/Toggle.svelte';
  import { shortDate } from '$lib/format';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { ImageResult } from '$lib/image';
  import { uploadProjectImages } from '$lib/project-media';

  /** Daftar project (Figma D/03, M/03; FR-025) + Buat project 2 langkah (D/04a–b; FR-020). */
  let { data } = $props();

  let status = $state<ProjectStatus | ''>('');
  let q = $state('');
  const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'done'];
  const list = $derived(
    data.projects.filter((p) => {
      const t = q.trim().toLowerCase();
      return (
        (!status || p.status === status) &&
        (!t ||
          p.name.toLowerCase().includes(t) ||
          p.rpoNumber.toLowerCase().includes(t) ||
          p.clientName.toLowerCase().includes(t))
      );
    }),
  );
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
  let directoryRetry = $state(0);
  let directoryLoading = $state(false);
  let directoryError = $state('');
  const candidates = $derived(users.filter((u) => u.id !== session.me?.user.id));
  $effect(() => {
    if (!open || step !== 2) return;
    const term = uq;
    void directoryRetry;
    const request = new AbortController();
    directoryLoading = true;
    directoryError = '';
    const t = setTimeout(async () => {
      try {
        const result = await api<{ users: DirUser[] }>(
          `/api/directory/users?q=${encodeURIComponent(term)}`,
          { signal: request.signal },
        );
        if (!request.signal.aborted) users = result.users;
      } catch {
        if (!request.signal.aborted) directoryError = 'Daftar calon anggota gagal dimuat.';
      } finally {
        if (!request.signal.aborted) directoryLoading = false;
      }
    }, 200);
    return () => {
      clearTimeout(t);
      request.abort();
    };
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
    uq = '';
    users = [];
    errors = {};
    step = 1;
    open = true;
  }
</script>

<svelte:head><title>Project · REIN</title></svelte:head>

<div class="toolbar">
  <select class="status-filter" aria-label="Status project" bind:value={status}>
    <option value="">Semua status</option>
    {#each STATUSES as st (st)}<option value={st}>{PROJECT_STATUS_LABEL[st]}</option>{/each}
  </select>
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
{:else}
  <div class="cards">
    {#each list as p (p.id)}
      <a class="project-card" href={resolve('/(app)/project/[id]', { id: p.id })}>
        <div class="card-head">
          <span class="client-logo"
            >{#if p.logoUrl}<img src={p.logoUrl} alt="" />{:else}{p.clientName
                .split(/\s+/)
                .slice(0, 2)
                .map((word) => word[0] ?? '')
                .join('')
                .toUpperCase()}{/if}</span
          >
          <span class="rpo tnum">{p.rpoNumber}</span>
          <span class="project-status" class:done={p.status === 'done'}
            >{PROJECT_STATUS_LABEL[p.status]}</span
          >
          {#if p.urgentCount}<span class="urgent" title={`${p.urgentCount} WO urgent`}
              ><Icon name="alert" size={14} /></span
            >{/if}
        </div>
        <div class="card-title">
          <h2>{p.name}</h2>
          <p>{p.clientName}</p>
        </div>
        <div class="card-progress">
          <Progress value={p.progress} /><span class="tnum">{p.progress}%</span>
        </div>
        <div class="card-foot">
          <span class="team" aria-label={`${p.memberCount} anggota`}
            >{#each p.team as t (t.id)}<Avatar
                name={t.fullName}
                src={t.avatarUrl}
                size={20}
              />{/each}{#if p.memberCount > p.team.length}<span class="faint"
                >+{p.memberCount - p.team.length}</span
              >{/if}</span
          >
          <span class="dates" title={`${shortDate(p.startDate)} – ${shortDate(p.endDate)}`}
            ><Icon name="calendar" size={12} />{shortDate(p.endDate)}</span
          >
        </div>
      </a>
    {:else}<p class="faint">Tidak ada project yang cocok.</p>{/each}
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
      {#if directoryLoading}
        <p role="status">Memuat calon anggota…</p>
      {:else if directoryError}
        <p role="alert">{directoryError}</p>
        <Button onclick={() => directoryRetry++}>Coba lagi</Button>
      {:else if !candidates.length}
        <p role="status">Tidak ada calon anggota yang cocok.</p>
      {:else}
        <ul class="pick">
          {#each candidates as u (u.id)}
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
      {/if}
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
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-tertiary);
    padding: 6px 10px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }
  .search:focus-within {
    border-color: var(--color-accent-default);
  }
  .search input {
    width: 240px;
    max-width: 100%;
    outline: none;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--color-text-primary);
  }
  .sp {
    flex: 1;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: 12px;
    padding: 24px;
    align-items: start;
  }
  .project-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: inherit;
    text-decoration: none;
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-1);
    transition:
      border-color var(--dur),
      background var(--dur);
  }
  .project-card:hover {
    border-color: var(--color-accent-default);
    background: var(--color-bg-hover);
  }
  .card-head,
  .card-progress,
  .card-foot,
  .team,
  .dates {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .client-logo {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    overflow: hidden;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-strong);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font-size: 9px;
  }
  .client-logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .rpo {
    color: var(--color-text-tertiary);
    font: var(--text-caption);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .project-status {
    font: var(--text-micro);
    color: var(--color-text-secondary);
  }
  .project-status.done {
    color: var(--color-success-default);
  }
  .card-title h2 {
    font: var(--text-body-13);
    font-weight: 500;
  }
  .card-title p {
    font: var(--text-caption);
    color: var(--color-text-secondary);
    margin-top: 2px;
  }
  .card-progress :global(.prog) {
    flex: 1;
  }
  .card-progress > span {
    font: var(--text-caption);
    color: var(--color-text-secondary);
  }
  .card-foot {
    justify-content: space-between;
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .urgent {
    color: var(--color-danger-default);
    display: flex;
  }
  .team {
    gap: 0;
  }
  .team :global(.av) {
    margin-right: -4px;
  }
  .team > span {
    margin-left: 8px;
  }
  .status-filter {
    padding: 6px 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  @media (max-width: 767px) {
    .cards,
    .toolbar {
      padding: 16px;
    }
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
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
