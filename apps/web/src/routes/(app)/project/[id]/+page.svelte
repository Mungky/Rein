<script lang="ts">
  import {
    checkWoTransition,
    checkProjectTransition,
    PROJECT_STATUS_LABEL,
    PROJECT_STATUSES,
    projectCreateSchema,
    WO_CATEGORY_META,
    WO_STATUS_LABEL,
    WO_STATUSES,
    todayWib,
    woReasonRequired,
    type ProjectStatus,
    type WoCategory,
    type WoStatus,
  } from '@rein/shared';
  import { onDestroy } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import { fileUrl, isPreviewImage, thumbUrl, uploadPreparedFile } from '$lib/attach';
  import PhotoLightbox from '$lib/components/PhotoLightbox.svelte';
  import { setChrome } from '$lib/chrome.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import CategoryBar from '$lib/components/CategoryBar.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import Kanban from '$lib/components/Kanban.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import ProjectMediaModal from '$lib/components/ProjectMediaModal.svelte';
  import ProjectMembersModal from '$lib/components/ProjectMembersModal.svelte';
  import ProjectMaterials from '$lib/components/ProjectMaterials.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import WoCreateModal from '$lib/components/WoCreateModal.svelte';
  import WoTable from '$lib/components/WoTable.svelte';
  import WoTimeline from '$lib/components/WoTimeline.svelte';
  import WoSCurve from '$lib/components/WoSCurve.svelte';
  import { formatBytes, shortDate } from '$lib/format';
  import { onLive } from '$lib/live.svelte';
  import { submitWoStatus } from '$lib/offline';
  import { toast } from '$lib/toast.svelte';
  import type { WoRow } from '$lib/types';
  import { sortWorklist, type WorklistGroup, type WorklistSort } from '$lib/worklist';

  /** Detail project (Figma D/04c–05, M/04–05; FR-021–026, FR-070–071). */
  let { data } = $props();
  const p = $derived(data.project);
  let mediaKind = $state<'logo' | 'banner' | null>(null);
  let memberOpen = $state(false);
  let rows = $derived<WoRow[]>(data.workOrders);
  let infoOpen = $state(false);
  let infoSaving = $state(false);
  let infoVersion = '';
  let initialInfo = '';
  let infoErrors = $state<Record<string, string>>({});
  let infoMessage = $state('');
  let info = $state({
    name: '',
    clientName: '',
    rpoNumber: '',
    location: '',
    startDate: '',
    endDate: '',
    description: '',
  });
  let initialStatus = $state<ProjectStatus>('active');
  let nextStatus = $state<ProjectStatus>('active');
  let note = $state('');
  const statusActor = $derived({
    canEdit: !!p.can.edit,
    canClose: !!p.can.close,
    canCloseAll: !!p.can.reopen,
  });
  const statusTargets = $derived(
    PROJECT_STATUSES.filter((s) => checkProjectTransition(p.status, s, statusActor).ok),
  );
  const editStatusTargets = $derived(
    PROJECT_STATUSES.filter((s) => checkProjectTransition(initialStatus, s, statusActor).ok),
  );
  const statusChange = $derived(nextStatus !== initialStatus);
  const transition = $derived(checkProjectTransition(initialStatus, nextStatus, statusActor));
  const needsReason = $derived(statusChange && transition.ok && transition.reasonRequired);

  function openInfo() {
    info = {
      name: p.name,
      clientName: p.client.name,
      rpoNumber: p.rpoNumber,
      location: p.location ?? '',
      startDate: p.startDate,
      endDate: p.endDate,
      description: p.description ?? '',
    };
    initialInfo = JSON.stringify(info);
    infoVersion = p.updatedAt;
    initialStatus = p.status;
    nextStatus = p.status;
    note = '';
    infoErrors = {};
    infoMessage = '';
    infoOpen = true;
  }

  async function saveInfo(e: SubmitEvent) {
    e.preventDefault();
    if (infoSaving) return;
    infoErrors = {};
    infoMessage = '';
    let fields = {};
    const changed = p.can.edit && JSON.stringify(info) !== initialInfo;
    if (changed) {
      const parsed = projectCreateSchema.safeParse(info);
      if (!parsed.success) {
        infoErrors = Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        );
        return;
      }
      fields = {
        ...parsed.data,
        location: parsed.data.location || null,
        description: parsed.data.description || null,
      };
    }
    if (needsReason && !note.trim()) {
      infoErrors = { note: 'Alasan wajib diisi' };
      return;
    }
    if (!changed && !statusChange) {
      infoOpen = false;
      return;
    }
    infoSaving = true;
    try {
      await api(`/api/projects/${p.id}`, {
        method: 'PATCH',
        body: {
          ...fields,
          ...(statusChange
            ? { statusChange: { status: nextStatus, note: note.trim() || undefined } }
            : {}),
          expectedUpdatedAt: infoVersion,
        },
      });
      infoOpen = false;
      toast(
        statusChange && !changed
          ? `Status project: ${PROJECT_STATUS_LABEL[nextStatus]}`
          : 'Info project diperbarui',
      );
      await invalidate('app:project');
      await invalidate('app:projects');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) infoErrors = err.fields;
      else infoMessage = err instanceof ApiError ? err.message : 'Gagal menyimpan info project.';
    } finally {
      infoSaving = false;
    }
  }

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
  const tabs = [
    { value: 'worklist', label: 'Worklist' },
    { value: 'files', label: 'Dokumen' },
    { value: 'materials', label: 'Material' },
    { value: 'activity', label: 'Aktivitas' },
  ] as const;
  const tab = $derived(
    tabs.find(({ value }) => value === page.url.searchParams.get('tab'))?.value ?? 'worklist',
  );
  const projectUrl = $derived(resolve('/(app)/project/[id]', { id: p.id }));
  let filterOpen = $state(false);
  let cat = $state<WoCategory | ''>('');
  let onlyUrgent = $state(false);
  let pic = $state('');
  let kind = $state('');
  let status = $state<WoStatus | ''>('');
  let onlyHelp = $state(false);
  let deadline = $state<'' | 'late' | 'next7' | 'range'>('');
  let from = $state('');
  let to = $state('');
  let groupBy = $state<WorklistGroup>('status');
  let sort = $state<WorklistSort>('deadline');
  const activeFilters = $derived(
    [cat, pic, kind, status, deadline, onlyUrgent, onlyHelp].filter(Boolean).length,
  );
  function clearFilters() {
    cat = '';
    pic = '';
    kind = '';
    status = '';
    deadline = '';
    from = '';
    to = '';
    onlyUrgent = false;
    onlyHelp = false;
  }
  const kinds = $derived(
    [...new Map(rows.map((w) => [w.type.id, w.type])).values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'id'),
    ),
  );
  const today = todayWib();
  const nextWeek = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  const dueFrom = $derived(deadline === 'range' ? from : deadline === 'next7' ? today : '');
  const dueTo = $derived(deadline === 'range' ? to : deadline === 'next7' ? nextWeek : '');
  const filtered = $derived(
    sortWorklist(
      rows.filter(
        (w) =>
          (!cat || w.type.category === cat) &&
          (!onlyUrgent || w.urgent) &&
          (!pic || w.assignee.id === pic) &&
          (!kind || w.type.id === kind) &&
          (!status || w.status === status) &&
          (!onlyHelp || w.helpOpen) &&
          (deadline !== 'late' || w.overdue) &&
          (deadline !== 'next7' || (w.status !== 'done' && w.status !== 'canceled')) &&
          (!dueFrom || w.deadline >= dueFrom) &&
          (!dueTo || w.deadline <= dueTo),
      ),
      sort,
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
    if (navigator.onLine) rows = rows.map((x) => (x.id === w.id ? { ...x, status: to } : x));
    try {
      if (await submitWoStatus(w, data.actor.userId, to, why)) {
        rows = before;
        toast('Perubahan status disimpan di antrean');
        return;
      }
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

  // ---------------------------------------------------------------- Lampiran project
  interface PFile {
    id: string;
    fileName: string;
    mime: string;
    hasThumb: boolean;
    sizeBytes: number;
    category: string;
    createdAt: string;
    uploadedBy: string;
    ownerType: 'project' | 'wo' | 'logbook';
    ownerId: string;
    woLinks: Array<{ woId: string; numberLabel: string; title: string }>;
  }
  let filesResult = $state<{ projectId: string; attachments: PFile[] } | null>(null);
  const pfiles = $derived(filesResult?.projectId === p.id ? filesResult.attachments : null);
  let pfilesError = $state('');
  async function loadFiles() {
    const projectId = p.id;
    pfilesError = '';
    try {
      const result = await api<{ attachments: PFile[] }>(`/api/projects/${projectId}/attachments`);
      if (p.id === projectId) filesResult = { projectId, attachments: result.attachments };
    } catch (err) {
      if (p.id === projectId)
        pfilesError = err instanceof ApiError ? err.message : 'Dokumen gagal dimuat';
    }
  }
  $effect(() => {
    if (tab === 'files' && p.updatedAt) void loadFiles();
  });
  let picker = $state<HTMLInputElement>();
  let uploadingFile = $state(false);
  let uploadPercent = $state<number | null>(null);
  let documentPhoto = $state<PFile | null>(null);
  let photoOpen = $state(false);
  async function uploadProjectFile(file: File) {
    uploadingFile = true;
    uploadPercent = null;
    try {
      await uploadPreparedFile(file, { ownerType: 'project', ownerId: p.id }, (fraction) => {
        uploadPercent = Math.round(fraction * 100);
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

{#snippet banner()}
  {#if p.bannerUrl}<img src={p.bannerUrl} alt={p.can.edit ? '' : 'Banner ' + p.name} />{/if}
{/snippet}
{#snippet logo()}
  {#if p.logoUrl}
    <img src={p.logoUrl} alt={p.can.edit ? '' : 'Foto/logo ' + p.client.name} />
  {:else}
    {initials}
  {/if}
{/snippet}

{#if p.can.edit}
  <button
    type="button"
    class="banner media-edit"
    onclick={() => (mediaKind = 'banner')}
    aria-haspopup="dialog"
  >
    {@render banner()}
    <span class="banner-edit"><Icon name="camera" size={14} />Ubah banner</span>
  </button>
{:else}
  <div class="banner">{@render banner()}</div>
{/if}
<header class="ph">
  <div class="ph-top">
    {#if p.can.edit}
      <button
        type="button"
        class="clogo media-edit"
        onclick={() => (mediaKind = 'logo')}
        aria-label="Ubah foto/logo"
        aria-haspopup="dialog"
      >
        {@render logo()}
        <span class="logo-edit"><Icon name="camera" size={12} /></span>
      </button>
    {:else}
      <span class="clogo">{@render logo()}</span>
    {/if}
    <div class="ttl">
      <h1>{p.name}</h1>
      <div class="meta">
        <span><Icon name="building" size={14} />{p.client.name}</span>
        <span><Icon name="file" size={14} />{p.rpoNumber}</span>
        {#if p.location}<span><Icon name="map-pin" size={14} />{p.location}</span>{/if}
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
      <Progress value={p.progress} />
    </div>
    <div class="acts">
      {#if p.can.edit || statusTargets.length}
        <Button icon="edit" aria-haspopup="dialog" onclick={openInfo}>Edit info</Button>
      {/if}
      <Button icon="users" aria-haspopup="dialog" onclick={() => (memberOpen = true)}>
        {p.can.manageMembers ? 'Kelola anggota' : 'Anggota'}
      </Button>
      {#if p.can.createWo}
        <Button variant="primary" icon="plus" onclick={() => (createOpen = true)}>Buat WO</Button>
      {/if}
    </div>
  </div>
  {#if p.status === 'on_hold' && p.onHoldReason}
    <p class="hold"><Icon name="clock" size={14} />Ditunda: {p.onHoldReason}</p>
  {/if}
  {#if p.description}<p class="muted">{p.description}</p>{/if}
  {#if p.categories.length}<CategoryBar categories={p.categories} />{/if}
</header>

<nav class="tabs" aria-label="Bagian project">
  {#each tabs as item (item.value)}
    <!-- eslint-disable svelte/no-navigation-without-resolve -- projectUrl adalah hasil resolve() -->
    <a
      href={item.value === 'worklist' ? projectUrl : projectUrl + '?tab=' + item.value}
      aria-current={tab === item.value ? 'page' : undefined}
      data-sveltekit-noscroll
    >
      {item.label}
      {#if item.value === 'worklist'}<em>{rows.length}</em>{/if}
      {#if item.value === 'files' && pfiles}<em>{pfiles.length}</em>{/if}
    </a>
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  {/each}
</nav>

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
        <Button icon="filter" aria-haspopup="dialog" onclick={() => (filterOpen = true)}>
          Filter{activeFilters ? ' (' + activeFilters + ')' : ''}
        </Button>
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
        <WoTable rows={filtered} group={groupBy} />
      {:else if view === 'timeline'}
        <WoTimeline rows={filtered} />
      {:else if view === 'scurve'}
        <WoSCurve
          projectId={p.id}
          category={cat}
          assignee={pic}
          urgent={onlyUrgent}
          {kind}
          {status}
          help={onlyHelp}
          activeDeadline={deadline === 'late' || deadline === 'next7' ? deadline : ''}
          {dueFrom}
          {dueTo}
          revision={p.updatedAt + rows.map((w) => w.updatedAt).join('')}
        />
      {:else}
        <Kanban rows={filtered} showCanceled={status === 'canceled'} {canDrag} {onmove} />
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
  {#key p.id}<ProjectMaterials projectId={p.id} workOrders={rows} />{/key}
{:else if tab === 'activity'}
  <div class="pane">
    {#key p.id}<ActivityList projectId={p.id} />{/key}
  </div>
{:else}
  <div class="pane documents">
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
        {#if uploadingFile}<span role="status"
            >{uploadPercent === null ? 'Menyiapkan dokumen…' : `Mengunggah ${uploadPercent}%`}</span
          >{/if}
      </div>
    {/if}
    {#if pfilesError}
      <div class="up">
        <p role="alert">{pfilesError}</p>
        <Button onclick={loadFiles}>Coba lagi</Button>
      </div>
    {:else if !pfiles}
      <p role="status" class="faint">Memuat dokumen…</p>
    {:else if !pfiles.length}
      <p class="faint">Belum ada dokumen project, WO, atau Logbook.</p>
    {:else}
      <ul class="document-grid">
        {#each pfiles as f (f.id)}
          {@const source = rows.find((row) => f.ownerType === 'wo' && row.id === f.ownerId)}
          <li>
            <div class="document-heading">
              {#if thumbUrl(f, data.actor.userId)}<img
                  class="fi"
                  src={thumbUrl(f, data.actor.userId)}
                  alt=""
                  loading="lazy"
                />{:else}
                <span class="fi"><Icon name="file" /></span>
              {/if}
              {#snippet fileLabel()}
                <b title={f.fileName}>{f.fileName}</b>
                <small>
                  {f.ownerType === 'wo'
                    ? 'Work Order'
                    : f.ownerType === 'logbook'
                      ? 'Logbook'
                      : 'Project'} · {formatBytes(f.sizeBytes)} · {shortDate(f.createdAt)} · {f.uploadedBy}
                </small>
              {/snippet}
              {#if isPreviewImage(f.mime)}
                <button
                  class="document-name"
                  type="button"
                  onclick={() => {
                    documentPhoto = f;
                    photoOpen = true;
                  }}>{@render fileLabel()}</button
                >
              {:else}
                <a
                  class="document-name"
                  href={fileUrl(f.id)}
                  target={f.mime === 'application/pdf' ? '_blank' : undefined}
                  rel="external noopener"
                >
                  {@render fileLabel()}
                </a>
              {/if}
            </div>
            {#if source || f.woLinks.length || (p.can.upload && rows.length)}
              <div class="document-footer">
                <div class="doc-links">
                  {#if source}<a href={resolve('/(app)/w/[id]', { id: source.id })}
                      >{source.numberLabel}</a
                    >{/if}
                  {#each f.woLinks.filter((link) => link.woId !== source?.id) as link (link.woId)}<a
                      href={resolve('/(app)/w/[id]', { id: link.woId })}
                      title={link.title}>{link.numberLabel}</a
                    >{/each}
                </div>
                {#if p.can.upload && rows.length}<Button
                    size="sm"
                    variant="ghost"
                    icon="paperclip"
                    onclick={() => {
                      attachFile = f;
                      attachWoId = '';
                      attachError = '';
                      attachOpen = true;
                    }}>Hubungkan ke WO</Button
                  >{/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<Modal bind:open={filterOpen} title="Filter Worklist" width={520}>
  <div class="filter-fields">
    <Field label="Kategori" id="filter-category">
      <select id="filter-category" bind:value={cat}>
        <option value="">Semua kategori</option>
        {#each p.categories as c (c.category)}
          <option value={c.category}>{WO_CATEGORY_META[c.category].label}</option>
        {/each}
      </select>
    </Field>
    <Field label="Jenis WO" id="filter-kind">
      <select id="filter-kind" bind:value={kind}>
        <option value="">Semua jenis</option>
        {#each kinds as type (type.id)}<option value={type.id}>{type.name}</option>{/each}
      </select>
    </Field>
    <Field label="Status" id="filter-status">
      <select id="filter-status" bind:value={status}>
        <option value="">Semua status</option>
        {#each WO_STATUSES as item (item)}<option value={item}>{WO_STATUS_LABEL[item]}</option
          >{/each}
      </select>
    </Field>
    <Field label="PIC" id="filter-pic">
      <select id="filter-pic" bind:value={pic}>
        <option value="">Semua PIC</option>
        {#each p.members as mm (mm.userId)}<option value={mm.userId}>{mm.fullName}</option>{/each}
      </select>
    </Field>
    <Field label="Deadline" id="filter-deadline">
      <select id="filter-deadline" bind:value={deadline}>
        <option value="">Semua deadline</option>
        <option value="late">Terlambat</option>
        <option value="next7">7 hari ke depan</option>
        <option value="range">Rentang tanggal</option>
      </select>
    </Field>
    {#if deadline === 'range'}
      <Input label="Deadline dari" type="date" bind:value={from} max={to || undefined} />
      <Input label="Deadline sampai" type="date" bind:value={to} min={from || undefined} />
    {/if}
    {#if view === 'table'}
      <Field label="Kelompokkan" id="filter-group">
        <select id="filter-group" bind:value={groupBy}>
          <option value="status">Status</option>
          <option value="category">Kategori</option>
          <option value="type">Jenis</option>
          <option value="pic">PIC</option>
          <option value="none">Tanpa grup</option>
        </select>
      </Field>
    {/if}
    {#if view !== 'scurve'}
      <Field label="Urutkan" id="filter-sort">
        <select id="filter-sort" bind:value={sort}>
          <option value="deadline">Deadline</option>
          <option value="number">Nomor WO</option>
          <option value="updated">Terakhir diubah</option>
        </select>
      </Field>
    {/if}
  </div>
  <div class="filter-flags">
    <Checkbox bind:checked={onlyUrgent}>Urgent</Checkbox>
    <Checkbox bind:checked={onlyHelp}>Butuh bantuan</Checkbox>
  </div>
  {#snippet footer()}
    <Button onclick={clearFilters} disabled={!activeFilters}>Reset filter</Button>
    <Button variant="primary" onclick={() => (filterOpen = false)}>Selesai</Button>
  {/snippet}
</Modal>

<PhotoLightbox bind:open={photoOpen} photo={documentPhoto} />

<Modal bind:open={infoOpen} title="Edit info project" width={560}>
  <form id="project-info" class="g" onsubmit={saveInfo} novalidate>
    {#if infoMessage}<p role="alert">{infoMessage}</p>{/if}
    <Field label="Status project" id="info-status">
      <select
        id="info-status"
        bind:value={nextStatus}
        disabled={!editStatusTargets.length || infoSaving}
      >
        <option value={initialStatus}>{PROJECT_STATUS_LABEL[initialStatus]}</option>
        {#each editStatusTargets as target (target)}
          <option value={target}>{PROJECT_STATUS_LABEL[target]}</option>
        {/each}
      </select>
    </Field>
    {#if statusChange}
      <Field
        label={needsReason ? 'Alasan perubahan status' : 'Catatan status (opsional)'}
        id="info-note"
        error={infoErrors.note}
      >
        <textarea
          id="info-note"
          bind:value={note}
          rows="2"
          maxlength="300"
          required={needsReason}
          disabled={infoSaving}></textarea>
      </Field>
    {/if}
    {#if p.can.edit}
      <Input
        label="Nama project"
        bind:value={info.name}
        error={infoErrors.name}
        required
        maxlength={160}
      />
      <Input
        label="Nama klien"
        bind:value={info.clientName}
        error={infoErrors.clientName}
        required
        maxlength={120}
      />
      <Input
        label="No RPO"
        bind:value={info.rpoNumber}
        error={infoErrors.rpoNumber}
        required
        maxlength={40}
      />
      <Input
        label="Lokasi"
        bind:value={info.location}
        error={infoErrors.location}
        maxlength={160}
      />
      <Input
        label="Tanggal mulai"
        type="date"
        bind:value={info.startDate}
        error={infoErrors.startDate}
        required
      />
      <Input
        label="Tanggal selesai"
        type="date"
        bind:value={info.endDate}
        error={infoErrors.endDate}
        required
      />
      <Field label="Deskripsi" id="info-desc" error={infoErrors.description}>
        <textarea id="info-desc" bind:value={info.description} rows="3" maxlength={500}></textarea>
      </Field>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (infoOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="project-info" loading={infoSaving}>Simpan</Button>
  {/snippet}
</Modal>

<WoCreateModal
  bind:open={createOpen}
  projectId={p.id}
  members={p.members}
  canWeight={p.can.editWeight}
  canUpload={p.can.upload}
  oncreated={(id) => goto(resolve('/(app)/w/[id]', { id }))}
/>

<Modal bind:open={attachOpen} title="Hubungkan dokumen ke WO" width={500}>
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
      >Hubungkan</Button
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

{#if memberOpen}
  {#key p.id}
    <ProjectMembersModal
      project={p}
      onclose={() => (memberOpen = false)}
      onchange={() => invalidate('app:project')}
    />
  {/key}
{/if}

{#if mediaKind && p.can.edit}
  {#key p.id}
    <ProjectMediaModal
      project={p}
      kind={mediaKind}
      onclose={() => (mediaKind = null)}
      onsaved={async () => {
        mediaKind = null;
        await invalidate('app:project');
        await invalidate('app:projects');
      }}
    />
  {/key}
{/if}

<style>
  .doc-links {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .doc-links a {
    color: var(--color-text-secondary);
    font: var(--text-caption);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
  }
  .pane.documents {
    max-width: none;
  }
  .document-grid {
    display: grid;
    align-items: start;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 8px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .document-grid li {
    display: grid;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }
  .document-heading,
  .document-footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .document-name {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
    text-align: start;
    color: var(--color-text-primary);
    padding: 2px 0;
  }
  .document-name b {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .document-name small {
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .document-footer {
    justify-content: space-between;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .layout.wide {
    grid-template-columns: minmax(0, 1fr);
  }
  .filtered-empty {
    padding: 24px;
  }
  .banner {
    display: block;
    width: 100%;
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
    position: relative;
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
  .media-edit {
    position: relative;
    cursor: pointer;
  }
  .media-edit:focus-visible {
    outline: 2px solid var(--color-accent-default);
    outline-offset: -2px;
  }
  .banner-edit,
  .logo-edit {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  .banner-edit {
    inset: 10px 12px auto auto;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    font: var(--text-caption);
  }
  .logo-edit {
    inset: auto 2px 2px auto;
    padding: 2px;
    border-radius: var(--radius-sm);
  }
  .media-edit:is(:hover, :focus-visible) :is(.banner-edit, .logo-edit) {
    background: var(--color-accent-subtle);
    color: var(--color-accent-default);
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
    width: 180px;
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
  .tabs a {
    padding: 10px 0;
    color: var(--color-text-secondary);
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    text-decoration: none;
  }
  .tabs a[aria-current='page'] {
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
  .filter-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .filter-fields select {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }
  .filter-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
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
  .fi {
    flex-shrink: 0;
    object-fit: cover;
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
    .banner {
      height: 56px;
    }
    .banner-edit {
      min-height: 44px;
      inset: 6px 12px auto auto;
    }
    .ph {
      padding: 12px 16px;
    }
    .ph-top {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      align-items: start;
    }
    .clogo {
      margin-top: 0;
    }
    h1 {
      font-size: 20px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .meta {
      gap: 4px 12px;
      font: var(--text-caption);
    }
    .meta span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .meta span :global(svg) {
      flex: none;
    }
    .ph-prog,
    .acts {
      grid-column: 1 / -1;
    }
    .acts :global(button) {
      flex: 1 1 auto;
      white-space: nowrap;
    }
    .tabs {
      gap: 0;
      padding: 0 12px;
    }
    .tabs a {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 4px;
      font-size: 12px;
    }
    .tabs em {
      display: none;
    }
    .wl {
      padding: 0 0 16px;
    }
    .toolbar {
      justify-content: space-between;
      padding: 10px 16px;
    }
    .toolbar :global(.seg) {
      --item-width: clamp(44px, calc((100vw - 142px) / 4), 68px);
    }
    .ph-prog {
      align-items: flex-start;
      width: 100%;
    }
    .side {
      display: none;
    }
    .filter-fields select {
      min-height: 44px;
      font-size: 16px;
    }
    .pane {
      padding: 16px;
    }
  }
  @media (max-width: 360px) {
    .toolbar :global(.seg svg) {
      display: none;
    }
  }
</style>
