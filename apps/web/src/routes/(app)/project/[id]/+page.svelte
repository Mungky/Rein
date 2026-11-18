<script lang="ts">
  import {
    checkWoTransition,
    checkProjectTransition,
    PROJECT_STATUS_LABEL,
    PROJECT_STATUSES,
    WO_CATEGORY_META,
    WO_STATUS_LABEL,
    woReasonRequired,
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
  import ProjectMaterials from '$lib/components/ProjectMaterials.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import WoCreateModal from '$lib/components/WoCreateModal.svelte';
  import WoTable from '$lib/components/WoTable.svelte';
  import WoTimeline from '$lib/components/WoTimeline.svelte';
  import WoSCurve from '$lib/components/WoSCurve.svelte';
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
  type WorkView = 'table' | 'kanban' | 'timeline' | 'scurve';
  function savedView(): WorkView {
    try {
      const value = localStorage.getItem(VIEW_KEY);
      return ['table', 'kanban', 'timeline', 'scurve'].includes(value ?? '')
        ? (value as WorkView)
        : 'table';
    } catch {
      return 'table';
    }
  }
  let view = $state<WorkView>(savedView());
  $effect(() => {
    if (view === 'scurve' && !p.can.scurve) view = 'table';
  });
  $effect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // abaikan
    }
  });
  let tab = $state<'worklist' | 'members' | 'files' | 'materials'>('worklist');
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
  const statusTargets = $derived(
    PROJECT_STATUSES.filter(
      (status) =>
        checkProjectTransition(p.status, status, {
          canEdit: p.can.edit ?? false,
          canClose: p.can.close ?? false,
          canCloseAll: p.can.reopen ?? false,
        }).ok,
    ),
  );
  function openStatus() {
    nextStatus = statusTargets[0] ?? p.status;
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
    ownerType: 'project' | 'wo' | 'logbook';
    ownerId: string;
    woLinks: Array<{ woId: string; numberLabel: string; title: string }>;
  }
  let pfiles = $state<PFile[] | null>(null);
  async function loadFiles() {
    try {
      pfiles = (await api<{ attachments: PFile[] }>(`/api/projects/${p.id}/attachments`))
        .attachments;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Dokumen gagal dimuat', { tone: 'danger' });
    }
  }
  $effect(() => {
    if (tab === 'files' && p.updatedAt) void loadFiles();
  });
  let picker = $state<HTMLInputElement>();
  let uploadingFile = $state(false);
  async function uploadProjectFile(file: File) {
    uploadingFile = true;
    try {
      await uploadAttachment({
        ownerType: 'project',
        ownerId: p.id,
        category: 'general',
        file: { blob: file, name: file.name },
      });
      toast('Dokumen diunggah');
      await loadFiles();
      await invalidate('app:project');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal mengunggah', { tone: 'danger' });
    } finally {
      uploadingFile = false;
    }
  }
  let attachFile = $state<PFile | null>(null);
  let attachOpen = $state(false);
  let attachWoId = $state('');
  let attaching = $state(false);
  let attachError = $state('');
  async function linkDocument() {
    if (!attachFile || !attachWoId || attaching) return;
    attaching = true;
    attachError = '';
    try {
      await api(`/api/projects/${p.id}/attachments/${attachFile.id}/link`, {
        body: { woId: attachWoId },
      });
      toast('Dokumen dihubungkan ke WO');
      attachOpen = false;
      await loadFiles();
    } catch (err) {
      attachError = err instanceof ApiError ? err.message : 'Dokumen gagal dihubungkan';
    } finally {
      attaching = false;
    }
  }
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
      {#if statusTargets.length}
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
    onclick={() => (tab = 'files')}>Dokumen<em>{pfiles?.length ?? ''}</em></button
  >
  <button
    role="tab"
    class:on={tab === 'materials'}
    aria-selected={tab === 'materials'}
    onclick={() => (tab = 'materials')}>Material</button
  >
</div>

{#if tab === 'worklist'}
  <div class="layout" class:wide={view === 'timeline' || view === 'scurve'}>
    <div class="wl">
      <div class="toolbar">
        <Segmented
          bind:value={view}
          options={[
            { value: 'table', label: 'Table', icon: 'table' },
            { value: 'kanban', label: 'Kanban', icon: 'kanban' },
            { value: 'timeline', label: 'Timeline', icon: 'timeline' },
            ...(p.can.scurve
              ? [{ value: 'scurve' as const, label: 'S-Curve', icon: 's-curve' as const }]
              : []),
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
          {view === 'kanban'
            ? 'Seret kartu untuk mengubah status'
            : view === 'table'
              ? 'Kelompok: Status'
              : view === 'scurve'
                ? 'Rencana vs aktual'
                : 'Jadwal Work Order'}
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
      {:else if !filtered.length}<p class="filtered-empty faint">
          Tidak ada WO yang cocok dengan filter.
        </p>
      {:else if view === 'table'}
        <WoTable rows={filtered} />
      {:else if view === 'timeline'}
        <WoTimeline rows={filtered} />
      {:else if view === 'scurve'}
        <WoSCurve
          projectId={p.id}
          category={cat}
          assignee={pic}
          urgent={onlyUrgent}
          revision={p.updatedAt + rows.map((w) => w.updatedAt).join('')}
        />
      {:else}
        <Kanban rows={filtered} {canDrag} {onmove} />
      {/if}
    </div>
    {#if view === 'table' || view === 'kanban'}<aside class="side">
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
      </aside>{/if}
  </div>
{:else if tab === 'materials'}
  {#key p.id}<ProjectMaterials projectId={p.id} />{/key}
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
          Unggah dokumen
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
              {f.ownerType === 'wo'
                ? 'Work Order'
                : f.ownerType === 'logbook'
                  ? 'Logbook'
                  : 'Project'} · {f.uploadedBy} · {shortDate(f.createdAt)} ·
              {formatBytes(f.sizeBytes)}
            </small>
          </a>
          <div class="doc-links">
            {#if f.ownerType === 'wo'}{@const source = rows.find(
                (r) => r.id === f.ownerId,
              )}{#if source}<a href={resolve('/(app)/w/[id]', { id: source.id })}
                  >{source.numberLabel}</a
                >{/if}{/if}
            {#each f.woLinks as link (link.woId)}<a
                href={resolve('/(app)/w/[id]', { id: link.woId })}
                title={link.title}>{link.numberLabel}</a
              >{/each}
            {#if p.can.upload}<Button
                size="sm"
                variant="ghost"
                icon="paperclip"
                disabled={!rows.length}
                onclick={() => {
                  attachFile = f;
                  attachWoId = '';
                  attachError = '';
                  attachOpen = true;
                }}>Attach</Button
              >{/if}
          </div>
        </li>
      {:else}
        <li class="faint">Belum ada dokumen project, WO, atau Logbook.</li>
      {/each}
    </ul>
  </div>
{/if}

<WoCreateModal
  bind:open={createOpen}
  projectId={p.id}
  members={p.members}
  canWeight={p.can.editWeight}
  canUpload={p.can.upload}
  oncreated={(id) => goto(resolve('/(app)/w/[id]', { id }))}
/>

<Modal bind:open={attachOpen} title="Attach dokumen ke Work Order" width={500}>
  <p>{attachFile?.fileName}</p>
  <Field label="Work Order" id="attach-wo"
    ><select id="attach-wo" bind:value={attachWoId} disabled={attaching}>
      <option value="">Pilih WO di project ini</option>
      {#each rows.filter((r) => !attachFile?.woLinks.some((l) => l.woId === r.id) && !(attachFile?.ownerType === 'wo' && attachFile.ownerId === r.id)) as row (row.id)}<option
          value={row.id}>{row.numberLabel} — {row.title}</option
        >{/each}
    </select></Field
  >
  <p class="muted">Dokumen tetap tersimpan di asalnya dan akan tampil di WO yang dipilih.</p>
  {#if attachError}<p role="alert">{attachError}</p>{/if}
  {#snippet footer()}<Button disabled={attaching} onclick={() => (attachOpen = false)}>Batal</Button
    ><Button variant="primary" loading={attaching} disabled={!attachWoId} onclick={linkDocument}
      >Attach</Button
    >{/snippet}
</Modal>

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
        {#each statusTargets as s (s)}
          <option value={s}>
            {PROJECT_STATUS_LABEL[s]}
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
  .doc-links {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .doc-links a {
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .layout.wide {
    grid-template-columns: minmax(0, 1fr);
  }
  .filtered-empty {
    padding: 24px;
  }
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
    flex-wrap: wrap;
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
  .list .f {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
  }
  .list .f small {
    color: var(--color-text-secondary);
  }
  .doc-links {
    max-width: 180px;
  }
  .fi {
    flex-shrink: 0;
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
    .list li {
      flex-wrap: wrap;
    }
    .list .f {
      flex-basis: calc(100% - 40px);
    }
    .doc-links {
      margin-left: 40px;
      max-width: 100%;
    }
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
