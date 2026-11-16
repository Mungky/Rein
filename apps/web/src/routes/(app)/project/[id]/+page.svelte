<script lang="ts">
  import {
    checkWoTransition,
    PROJECT_STATUS_LABEL,
    PROJECT_STATUSES,
    WO_CATEGORY_META,
    WO_STATUS_LABEL,
    woReasonRequired,
    type AttachmentCategory,
    type ProjectStatus,
    type WoCategory,
    type WoStatus,
  } from '@rein/shared';
  import { onDestroy } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { fileUrl } from '$lib/attach';
  import { setChrome } from '$lib/chrome.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import CategoryBar from '$lib/components/CategoryBar.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import Kanban from '$lib/components/Kanban.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import ProjectMediaModal from '$lib/components/ProjectMediaModal.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import WoCreateModal from '$lib/components/WoCreateModal.svelte';
  import WoTable from '$lib/components/WoTable.svelte';
  import { formatBytes, shortDate } from '$lib/format';
  import { onLive } from '$lib/live.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { WoRow } from '$lib/types';
  import { uploadAttachment } from '$lib/upload';

  /** Detail project (Figma D/04c–05, M/04–05; FR-021–026, FR-070–071). */
  let { data } = $props();
  const p = $derived(data.project);
  let mediaOpen = $state(false);
  let rows = $derived<WoRow[]>(data.workOrders);

  $effect(() => {
    setChrome({
      title: p.name,
      crumbs: [{ label: 'Project', href: resolve('/project') }],
      back: resolve('/project'),
    });
  });
  const off = onLive((e) => {
    if ((e.type === 'wo' || e.type === 'project') && e.projectId === p.id) {
      void invalidate('app:project');
    }
  });
  onDestroy(off);

  const VIEW_KEY = 'rein:wview';
  function savedView(): 'table' | 'kanban' {
    try {
      return localStorage.getItem(VIEW_KEY) === 'kanban' ? 'kanban' : 'table';
    } catch {
      return 'table';
    }
  }
  let view = $state<'table' | 'kanban'>(savedView());
  $effect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // abaikan
    }
  });
  let tab = $state<'worklist' | 'members' | 'files'>('worklist');
  let cat = $state<WoCategory | ''>('');
  let onlyUrgent = $state(false);
  let pic = $state('');
  const filtered = $derived(
    rows.filter(
      (w) =>
        (!cat || w.type.category === cat) &&
        (!onlyUrgent || w.urgent) &&
        (!pic || w.assignee.id === pic),
    ),
  );

  // ---------------------------------------------------------------- Kanban
  function actorFor(w: WoRow) {
    return {
      isAssignee: w.assignee.id === data.actor.userId,
      isCreator: w.createdBy === data.actor.userId,
      canEditAny: data.actor.canEditAny,
    };
  }
  function canDrag(w: WoRow, to: WoStatus) {
    return checkWoTransition(w.status, to, actorFor(w), { hasLogbook: w.hasLogbook }).ok;
  }
  let reasonOpen = $state(false);
  let reason = $state('');
  let pendingMove = $state<{ w: WoRow; to: WoStatus } | null>(null);

  function onmove(w: WoRow, to: WoStatus) {
    const check = checkWoTransition(w.status, to, actorFor(w), { hasLogbook: w.hasLogbook });
    if (!check.ok) {
      toast(check.message, { tone: 'danger' });
      return;
    }
    if (woReasonRequired(w.status, to)) {
      pendingMove = { w, to };
      reason = '';
      reasonOpen = true;
      return;
    }
    void move(w, to);
  }
  async function move(w: WoRow, to: WoStatus, why?: string) {
    const before = rows;
    rows = rows.map((x) => (x.id === w.id ? { ...x, status: to } : x));
    try {
      await api(`/api/work-orders/${w.id}/status`, {
        body: { status: to, expectedUpdatedAt: w.updatedAt, ...(why ? { reason: why } : {}) },
      });
      toast(`${w.numberLabel} → ${WO_STATUS_LABEL[to]}`);
      await invalidate('app:project');
    } catch (err) {
      rows = before;
      toast(err instanceof ApiError ? err.message : 'Gagal mengubah status', { tone: 'danger' });
    }
  }
  function confirmMove(e?: SubmitEvent) {
    e?.preventDefault();
    if (!pendingMove || !reason.trim()) return;
    reasonOpen = false;
    void move(pendingMove.w, pendingMove.to, reason.trim());
    pendingMove = null;
  }

  // ---------------------------------------------------------------- Buat WO
  let createOpen = $state(false);

  // ---------------------------------------------------------------- Status project
  let statusOpen = $state(false);
  let nextStatus = $state<ProjectStatus>('on_hold');
  let note = $state('');
  let busy = $state(false);
  function openStatus() {
    nextStatus = p.status === 'active' ? 'on_hold' : 'active';
    note = '';
    statusOpen = true;
  }
  async function saveStatus(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    try {
      await api(`/api/projects/${p.id}/status`, {
        body: { status: nextStatus, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      statusOpen = false;
      toast(`Status project: ${PROJECT_STATUS_LABEL[nextStatus]}`);
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }

  async function setHandover(v: string) {
    try {
      await api(`/api/projects/${p.id}`, {
        method: 'PATCH',
        body: { expectedUpdatedAt: p.updatedAt, handoverDate: v || null },
      });
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    }
  }

  // ---------------------------------------------------------------- Anggota
  interface DirUser {
    id: string;
    fullName: string;
    roleName: string;
    avatarUrl: string | null;
  }
  let memberOpen = $state(false);
  let dir = $state<DirUser[]>([]);
  let q = $state('');
  let m = $state({ userId: '', projectRole: 'Anggota', isProjectManager: false });
  $effect(() => {
    if (!memberOpen) return;
    const term = q;
    const t = setTimeout(async () => {
      dir = (await api<{ users: DirUser[] }>(`/api/directory/users?q=${encodeURIComponent(term)}`))
        .users;
    }, 200);
    return () => clearTimeout(t);
  });
  const candidates = $derived(dir.filter((u) => !p.members.some((x) => x.userId === u.id)));
  async function addMember(e?: SubmitEvent) {
    e?.preventDefault();
    if (!m.userId) return;
    busy = true;
    try {
      await api(`/api/projects/${p.id}/members`, { method: 'PUT', body: m });
      memberOpen = false;
      m = { userId: '', projectRole: 'Anggota', isProjectManager: false };
      toast('Anggota ditambahkan');
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
  async function removeMember(userId: string) {
    try {
      await api(`/api/projects/${p.id}/members/${userId}`, { method: 'DELETE', body: {} });
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    }
  }

  // ---------------------------------------------------------------- Lampiran project
  interface PFile {
    id: string;
    fileName: string;
    sizeBytes: number;
    category: string;
    createdAt: string;
    uploadedBy: string;
  }
  let pfiles = $state<PFile[] | null>(null);
  async function loadFiles() {
    pfiles = (await api<{ attachments: PFile[] }>(`/api/projects/${p.id}/attachments`)).attachments;
  }
  $effect(() => {
    if (tab === 'files') void loadFiles();
  });
  let upCat = $state<AttachmentCategory>('general');
  let picker = $state<HTMLInputElement>();
  let uploadingFile = $state(false);
  async function uploadProjectFile(file: File) {
    uploadingFile = true;
    try {
      await uploadAttachment({
        ownerType: 'project',
        ownerId: p.id,
        category: upCat,
        file: { blob: file, name: file.name },
      });
      toast('Lampiran diunggah');
      await loadFiles();
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal mengunggah', { tone: 'danger' });
    } finally {
      uploadingFile = false;
    }
  }
  const CAT_LABEL: Record<AttachmentCategory, string> = {
    general: 'Umum',
    po_client: 'PO klien',
    contract: 'Kontrak',
    bast: 'BAST',
    qc_doc: 'Dokumen QC',
    photo: 'Foto',
    drawing: 'Gambar',
    purchase_doc: 'Dokumen pembelian',
  };
  const catLabel = (c: string) => CAT_LABEL[c as AttachmentCategory] ?? c;
  const initials = $derived(
    p.client.name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0] ?? '')
      .join('')
      .toUpperCase(),
  );
</script>

<svelte:head><title>{p.name} · REIN</title></svelte:head>

<div class="banner">
  {#if p.bannerUrl}<img src={p.bannerUrl} alt={'Banner ' + p.name} />{/if}
</div>
<header class="ph">
  <div class="ph-top">
    <span class="clogo"
      >{#if p.logoUrl}<img
          src={p.logoUrl}
          alt={'Foto/logo ' + p.client.name}
        />{:else}{initials}{/if}</span
    >
    <div class="ttl">
      <h1>{p.name}</h1>
      <div class="meta">
        <span><Icon name="building" size={14} />{p.client.name}</span>
        <span><Icon name="file" size={14} />{p.rpoNumber}</span>
        {#if p.location}<span class="hide-m"><Icon name="map-pin" size={14} />{p.location}</span
          >{/if}
        <span
          ><Icon name="calendar" size={14} />{shortDate(p.startDate)} – {shortDate(p.endDate)}</span
        >
      </div>
    </div>
    <div class="ph-prog">
      <span>
        <span class="st st-{p.status}"></span>{PROJECT_STATUS_LABEL[p.status]} · Progres
        <b class="tnum">{p.progress}%</b>
      </span>
      <Progress value={p.progress} width={180} />
    </div>
    <div class="acts">
      {#if p.can.edit}<Button icon="image" onclick={() => (mediaOpen = true)}>Foto & banner</Button
        >{/if}
      {#if p.can.edit || p.can.close}
        <Button icon="refresh" onclick={openStatus}>Status</Button>
      {/if}
      {#if p.can.createWo}
        <Button variant="primary" icon="plus" onclick={() => (createOpen = true)}>Buat WO</Button>
      {/if}
    </div>
  </div>
  {#if p.status === 'on_hold' && p.onHoldReason}
    <p class="hold"><Icon name="clock" size={14} />Ditunda: {p.onHoldReason}</p>
  {/if}
  {#if p.categories.length}<CategoryBar categories={p.categories} />{/if}
</header>

<div class="tabs" role="tablist">
  <button
    role="tab"
    class:on={tab === 'worklist'}
    aria-selected={tab === 'worklist'}
    onclick={() => (tab = 'worklist')}>Worklist<em>{rows.length}</em></button
  >
  <button
    role="tab"
    class:on={tab === 'members'}
    aria-selected={tab === 'members'}
    onclick={() => (tab = 'members')}>Anggota<em>{p.members.length}</em></button
  >
  <button
    role="tab"
    class:on={tab === 'files'}
    aria-selected={tab === 'files'}
    onclick={() => (tab = 'files')}>Lampiran<em>{pfiles?.length ?? ''}</em></button
  >
</div>

{#if tab === 'worklist'}
  <div class="layout">
    <div class="wl">
      <div class="toolbar">
        <Segmented
          bind:value={view}
          options={[
            { value: 'table', label: 'Table', icon: 'table' },
            { value: 'kanban', label: 'Kanban', icon: 'kanban' },
          ]}
        />
        <select class="chip" aria-label="Filter kategori" bind:value={cat}>
          <option value="">Semua kategori</option>
          {#each p.categories as c (c.category)}
            <option value={c.category}>{WO_CATEGORY_META[c.category].label}</option>
          {/each}
        </select>
        <select class="chip" aria-label="Filter PIC" bind:value={pic}>
          <option value="">Semua PIC</option>
          {#each p.members as mm (mm.userId)}<option value={mm.userId}>{mm.fullName}</option>{/each}
        </select>
        <button
          class="chip"
          class:on={onlyUrgent}
          aria-pressed={onlyUrgent}
          onclick={() => (onlyUrgent = !onlyUrgent)}
        >
          <Icon name="alert" size={12} />Urgent
        </button>
        <span class="note faint hide-m">
          {view === 'kanban' ? 'Seret kartu untuk mengubah status' : 'Kelompok: Status'}
        </span>
      </div>
      {#if !rows.length}
        <div class="box">
          <EmptyState
            icon="logbook"
            title="Belum ada Work Order"
            message="Pecah project ini menjadi WO (gambar, belanja, produksi, QC…) agar progres bisa dihitung."
          >
            {#if p.can.createWo}
              <Button variant="primary" icon="plus" onclick={() => (createOpen = true)}>
                Buat WO pertama
              </Button>
            {/if}
          </EmptyState>
        </div>
      {:else if view === 'table'}
        <WoTable rows={filtered} />
      {:else}
        <Kanban rows={filtered} {canDrag} {onmove} />
      {/if}
    </div>
    <aside class="side">
      <h3>Syarat Selesai</h3>
      <ul class="checks">
        <li class:ok={p.completion.punchListClear}>
          <Icon name={p.completion.punchListClear ? 'check' : 'alert'} size={14} />Punch list habis
          {#if p.completion.openPunch}({p.completion.openPunch} terbuka){/if}
        </li>
        <li class:ok={p.completion.handoverDate}>
          <Icon name={p.completion.handoverDate ? 'check' : 'alert'} size={14} />Tanggal serah
          terima
          {#if p.can.edit}
            <input
              type="date"
              aria-label="Tanggal serah terima"
              value={p.handoverDate ?? ''}
              onchange={(e) => setHandover(e.currentTarget.value)}
            />
          {:else if p.handoverDate}<span class="faint">{shortDate(p.handoverDate)}</span>{/if}
        </li>
        <li class:ok={p.completion.bastUploaded}>
          <Icon name={p.completion.bastUploaded ? 'check' : 'alert'} size={14} />BAST diunggah
        </li>
      </ul>
      {#if p.allWorkDone && p.status !== 'done'}
        <p class="faint small">
          Semua WO selesai. Lengkapi syarat di atas untuk menandai project Selesai.
        </p>
      {/if}
      <h3>Anggota <em>{p.members.length}</em></h3>
      <ul>
        {#each p.members.slice(0, 6) as mm (mm.userId)}
          <li>
            <Avatar name={mm.fullName} src={mm.avatarUrl} size={20} />
            <span class="f"><b>{mm.fullName}</b></span>
            <span class="r">{mm.isProjectManager ? 'Pengelola' : mm.projectRole}</span>
          </li>
        {/each}
      </ul>
    </aside>
  </div>
{:else if tab === 'members'}
  <div class="pane">
    {#if p.can.manageMembers}
      <div><Button icon="plus" onclick={() => (memberOpen = true)}>Tambah anggota</Button></div>
    {/if}
    <ul class="list">
      {#each p.members as mm (mm.userId)}
        <li>
          <Avatar name={mm.fullName} src={mm.avatarUrl} size={32} />
          <span class="f">
            <b>{mm.fullName}</b>
            <small>
              {mm.roleName} · {mm.projectRole}{mm.isProjectManager ? ' · Pengelola' : ''}
            </small>
          </span>
          {#if p.can.manageMembers}
            <Button
              variant="ghost"
              icon="x"
              aria-label={`Keluarkan ${mm.fullName}`}
              onclick={() => removeMember(mm.userId)}
            />
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{:else}
  <div class="pane">
    {#if p.can.upload}
      <div class="up">
        <select aria-label="Kategori lampiran" bind:value={upCat}>
          {#each Object.entries(CAT_LABEL) as [k, l] (k)}<option value={k}>{l}</option>{/each}
        </select>
        <input
          bind:this={picker}
          type="file"
          hidden
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void uploadProjectFile(f);
          }}
        />
        <Button icon="upload" loading={uploadingFile} onclick={() => picker?.click()}>
          Unggah lampiran
        </Button>
      </div>
    {/if}
    <ul class="list">
      {#each pfiles ?? [] as f (f.id)}
        <li>
          <span class="fi"><Icon name="file" /></span>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /files/* disajikan server -->
          <a class="f" href={fileUrl(f.id)} target="_blank" rel="noopener">
            <b>{f.fileName}</b>
            <small>
              {catLabel(f.category)} · {f.uploadedBy} · {shortDate(f.createdAt)} · {formatBytes(
                f.sizeBytes,
              )}
            </small>
          </a>
        </li>
      {:else}
        <li class="faint">Belum ada lampiran project.</li>
      {/each}
    </ul>
  </div>
{/if}

<WoCreateModal
  bind:open={createOpen}
  projectId={p.id}
  members={p.members}
  canWeight={p.can.editWeight}
  oncreated={(id) => goto(resolve('/(app)/w/[id]', { id }))}
/>

<Modal bind:open={reasonOpen} title="Alasan perubahan status" width={440}>
  <form id="mv-f" onsubmit={confirmMove}>
    <Field label="Alasan" id="mv-r">
      <textarea id="mv-r" bind:value={reason} rows="3" maxlength="500"></textarea>
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (reasonOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="mv-f" disabled={!reason.trim()}>Simpan</Button>
  {/snippet}
</Modal>

<Modal bind:open={statusOpen} title="Ubah status project" width={460}>
  <form id="st-f" class="g" onsubmit={saveStatus}>
    <Field label="Status" id="st-s">
      <select id="st-s" bind:value={nextStatus}>
        {#each PROJECT_STATUSES as s (s)}
          <option value={s} disabled={s === p.status || (s === 'done' && !p.completion.ready)}>
            {PROJECT_STATUS_LABEL[s]}{s === 'done' && !p.completion.ready
              ? ' (syarat belum lengkap)'
              : ''}
          </option>
        {/each}
      </select>
    </Field>
    <Field
      label="Catatan / alasan"
      id="st-n"
      hint="Wajib saat menunda atau membuka kembali project."
    >
      <textarea id="st-n" bind:value={note} rows="3" maxlength="300"></textarea>
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (statusOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="st-f" loading={busy}>Simpan</Button>
  {/snippet}
</Modal>

<Modal bind:open={memberOpen} title="Tambah anggota" width={480}>
  <form id="mb-f" class="g" onsubmit={addMember}>
    <Input label="Cari pengguna" bind:value={q} placeholder="Nama atau username" />
    <ul class="pick">
      {#each candidates as u (u.id)}
        <li>
          <label>
            <input type="radio" name="mb-u" value={u.id} bind:group={m.userId} />
            <Avatar name={u.fullName} src={u.avatarUrl} size={24} />
            <span>{u.fullName}<small class="faint"> · {u.roleName}</small></span>
          </label>
        </li>
      {/each}
    </ul>
    <Input label="Peran di project" bind:value={m.projectRole} maxlength={40} />
    <Toggle bind:checked={m.isProjectManager} label="Pengelola project" showLabel />
  </form>
  {#snippet footer()}
    <Button onclick={() => (memberOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="mb-f" loading={busy} disabled={!m.userId}>
      Tambahkan
    </Button>
  {/snippet}
</Modal>

{#if mediaOpen && p.can.edit}
  <ProjectMediaModal
    project={p}
    onclose={() => (mediaOpen = false)}
    onsaved={async () => {
      mediaOpen = false;
      await invalidate('app:project');
      await invalidate('app:projects');
    }}
  />
{/if}

<style>
  .banner {
    overflow: hidden;
    height: 72px;
    background: linear-gradient(100deg, var(--color-accent-subtle), var(--color-bg-subtle));
  }
  .ph {
    padding: 12px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .ph-top {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .clogo {
    overflow: hidden;
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-top: -32px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-strong);
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-1);
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .ttl {
    flex: 1;
    min-width: 0;
  }
  .banner img,
  .clogo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    color: var(--color-text-secondary);
  }
  .meta span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ph-prog {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .ph-prog > span {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .acts {
    display: flex;
    gap: 8px;
  }
  .hold {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .tabs {
    display: flex;
    gap: 20px;
    padding: 0 24px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .tabs button {
    padding: 10px 0;
    color: var(--color-text-secondary);
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.on {
    color: var(--color-text-primary);
    border-color: var(--color-text-primary);
  }
  .tabs em {
    font-style: normal;
    color: var(--color-text-tertiary);
    font-weight: 400;
    margin-left: 4px;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
  }
  .wl {
    min-width: 0;
    padding: 0 24px 32px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border-strong);
    background: transparent;
    color: var(--color-text-secondary);
    font: var(--text-label);
  }
  .chip.on {
    border-style: solid;
    border-color: var(--color-accent-default);
    color: var(--color-accent-default);
    background: var(--color-accent-subtle);
  }
  .note {
    margin-left: auto;
    font-size: 12px;
  }
  .box {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .side {
    border-left: 1px solid var(--color-border-default);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .side h3 {
    margin: 0;
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .side h3 em {
    font-style: normal;
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .checks li {
    color: var(--color-danger-default);
    flex-wrap: wrap;
  }
  .checks li.ok {
    color: var(--color-success-default);
  }
  .checks input {
    height: 26px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: var(--text-caption);
  }
  .small {
    font-size: 12px;
  }
  .f {
    min-width: 0;
    flex: 1;
    color: inherit;
    text-decoration: none;
  }
  .f b {
    display: block;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .f small {
    display: block;
    color: var(--color-text-tertiary);
    font-size: 11px;
  }
  .r {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: 12px;
    white-space: nowrap;
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 24px 32px;
    max-width: 720px;
  }
  .list li {
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border-default);
  }
  .fi {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-icon-default);
  }
  .up {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .up select {
    height: 28px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  .g {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pick {
    max-height: 220px;
    overflow: auto;
    gap: 2px;
  }
  .pick label {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .pick label:hover {
    background: var(--color-bg-hover);
  }
  @media (max-width: 1023px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .side {
      border-left: 0;
      border-top: 1px solid var(--color-border-default);
    }
  }
  @media (max-width: 767px) {
    .ph,
    .tabs {
      padding-left: 16px;
      padding-right: 16px;
    }
    .wl {
      padding: 0;
    }
    .toolbar {
      padding: 10px 16px;
    }
    .ph-prog {
      align-items: flex-start;
      width: 100%;
    }
    .hide-m {
      display: none;
    }
    .pane {
      padding: 16px;
    }
  }
</style>
