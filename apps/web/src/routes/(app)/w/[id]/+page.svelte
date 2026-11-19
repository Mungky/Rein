<script lang="ts">
  import {
    LOGBOOK_CATEGORY_LABEL,
    MATERIAL_STATUS_LABEL,
    WO_STATUS_LABEL,
    WO_CATEGORIES,
    WO_CATEGORY_META,
    todayWib,
    woReasonRequired,
    type LogbookCategory,
    type WoStatus,
  } from '@rein/shared';
  import { onDestroy, onMount } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { goto, invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { fileUrl, isPreviewImage, thumbUrl, type Staged } from '$lib/attach';
  import { setChrome } from '$lib/chrome.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Field from '$lib/components/Field.svelte';
  import FlagBadge from '$lib/components/FlagBadge.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PeriodPicker, { type Period } from '$lib/components/PeriodPicker.svelte';
  import PhotoLightbox from '$lib/components/PhotoLightbox.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import StagedFiles from '$lib/components/StagedFiles.svelte';
  import StatusIcon from '$lib/components/StatusIcon.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { dayLabel, formatBytes, shortDate, stamp } from '$lib/format';
  import { onLive } from '$lib/live.svelte';
  import { logbookText } from '$lib/logbook-text';
  import { enqueueOffline, submitWoStatus } from '$lib/offline';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { FileItem, LogEntry, Member, WoType } from '$lib/types';
  import { woEditFields, woEditPatch } from '$lib/wo-edit';

  /** Detail WO + Logbook (Figma D/07a, M/07; FR-031–034, FR-040–042, FR-050–051). */
  let { data } = $props();
  const wo = $derived(data.wo);
  const currentWoId = $derived(data.wo.id);
  let entries = $state<LogEntry[]>([]);
  let cursor = $state<string | null>(null);
  let moreBusy = $state(false);
  let moreError = $state('');
  let columns = $state<1 | 2>(1);
  const woUrl = $derived(resolve('/(app)/w/[id]', { id: wo.id }));
  const filterQuery = $derived.by(() => {
    const query = new SvelteURLSearchParams(data.logQuery);
    query.delete('view');
    query.delete('entry');
    return query.toString();
  });
  onMount(() => {
    try {
      if (localStorage.getItem('rein:logbook-columns') === '2') columns = 2;
    } catch {
      /* Storage opsional. */
    }
  });

  function setColumns(value: 1 | 2) {
    columns = value;
    try {
      localStorage.setItem('rein:logbook-columns', String(value));
    } catch {
      /* Storage opsional. */
    }
  }

  function setLogPeriod(period: Period, date: string) {
    const query = new SvelteURLSearchParams();
    if (period !== 'week') query.set('period', period);
    if (date !== todayWib()) query.set('date', date);
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- woUrl berasal dari resolve()
    void goto(query.size ? `${woUrl}?${query}` : woUrl, { noScroll: true, keepFocus: true });
  }
  $effect(() => {
    entries = data.log.entries;
    cursor = data.log.nextCursor;
    moreError = '';
  });

  $effect(() => {
    setChrome({
      title: wo.numberLabel,
      crumbs: [
        { label: 'Project', href: resolve('/project') },
        { label: wo.project.name, href: resolve('/(app)/project/[id]', { id: wo.project.id }) },
      ],
      back: resolve('/(app)/project/[id]', { id: wo.project.id }),
    });
  });

  const off = onLive((e) => {
    if (
      (e.type === 'wo' && e.woId === wo.id) ||
      (e.type === 'project' && e.projectId === wo.project.id)
    )
      void invalidate('app:wo');
  });
  onDestroy(off);

  const userId = $derived(session.me?.user.id ?? '');
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const daysLeft = $derived(Math.round((Date.parse(wo.deadline) - Date.parse(today)) / 86_400_000));

  // ---------------------------------------------------------------- composer
  let body = $state('');
  let files = $state<Staged[]>([]);
  let posting = $state(false);
  let progress = $state<number | undefined>(undefined);
  let category = $state<LogbookCategory | ''>('');
  let postId = crypto.randomUUID();
  let postError = $state('');
  let retryPost = $state<ReturnType<typeof postPayload> | null>(null);
  let photo = $state<FileItem | null>(null);
  let photoOpen = $state(false);
  let entryOpen = $state(false);
  let activeEntry = $state<LogEntry | null>(null);
  let entryBody = $state('');
  let entryDeleting = $state(false);
  let entryBusy = $state(false);
  let entryError = $state('');

  function openEntry(entry: LogEntry, remove: boolean) {
    activeEntry = entry;
    entryBody = entry.body;
    entryDeleting = remove;
    entryError = '';
    entryOpen = true;
  }

  async function saveEntry(e: SubmitEvent) {
    e.preventDefault();
    if (!activeEntry || entryBusy) return;
    entryBusy = true;
    entryError = '';
    try {
      await api(`/api/work-orders/${wo.id}/logbook/${activeEntry.id}`, {
        method: entryDeleting ? 'DELETE' : 'PATCH',
        body: {
          expectedEditedAt: activeEntry.editedAt,
          ...(entryDeleting ? {} : { body: entryBody }),
        },
      });
      entryOpen = false;
      toast(entryDeleting ? 'Catatan dihapus' : 'Catatan diperbarui');
      await invalidate('app:wo');
    } catch (err) {
      entryError = err instanceof ApiError ? err.message : 'Perubahan catatan gagal disimpan.';
    } finally {
      entryBusy = false;
    }
  }
  const uploading = $derived(files.some((f) => !f.id && !f.error && !f.offlineFile));
  const hasFiles = $derived(files.some((f) => f.id || f.offlineFile));

  $effect(() => {
    void currentWoId;
    body = '';
    files = [];
    progress = undefined;
    category = '';
    retryPost = null;
    postError = '';
    postId = crypto.randomUUID();
  });

  // ---------------------------------------------------------------- modals
  let reasonOpen = $state(false);
  let reason = $state('');
  let reasonFor = $state<{ to: WoStatus; via: 'prop' } | null>(null);
  let helpOpen = $state(false);
  let helpBody = $state('');
  let replyOpen = $state(false);
  let replyBody = $state('');
  let replyResolve = $state(true);
  let editOpen = $state(false);
  let members = $state<Member[]>([]);
  let editTypes = $state<WoType[]>([]);
  let editError = $state('');
  let editLoading = $state(false);
  let editLoadFailed = $state(false);
  let editBaseline: ReturnType<typeof snapshotEdit> | undefined;
  let originalType = $state<WoType | null>(null);
  let edit = $state({
    title: '',
    typeId: '',
    assigneeId: '',
    plannedStart: '',
    deadline: '',
    urgent: false,
    weight: '',
    detail: '',
  });
  let busy = $state(false);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.code === 'STALE') {
      toast(err.message, { tone: 'danger' });
      void invalidate('app:wo');
      return;
    }
    toast(err instanceof ApiError ? err.message : 'Terjadi kesalahan', { tone: 'danger' });
  }

  function postPayload() {
    return {
      clientId: postId,
      body: body.trim(),
      attachmentIds: files.filter((f) => f.id).map((f) => f.id!),
      ...(progress !== undefined ? { progress, expectedUpdatedAt: wo.updatedAt } : {}),
      ...(category ? { category } : {}),
    };
  }

  async function post() {
    if (posting || uploading) return;
    if (!body.trim() && !hasFiles && progress === undefined) return;
    const payload = retryPost ? $state.snapshot(retryPost) : postPayload();
    const woId = wo.id;
    postError = '';
    posting = true;
    try {
      const pendingFiles = files.flatMap((f) => (f.offlineFile ? [f.offlineFile] : []));
      if (!navigator.onLine || pendingFiles.length) {
        const createdAt = new Date().toISOString();
        await enqueueOffline({
          account: userId,
          id: payload.clientId,
          woId,
          title: wo.title,
          createdAt,
          state: 'pending',
          kind: 'logbook',
          files: pendingFiles,
          body: retryPost ? payload : { ...payload, clientCreatedAt: createdAt },
        });
        toast('Logbook disimpan di antrean');
      } else await api(`/api/work-orders/${woId}/logbook`, { account: userId, body: payload });
      if (wo.id !== woId) return;
      retryPost = null;
      body = '';
      for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
      files = [];
      progress = undefined;
      category = '';
      postId = crypto.randomUUID();
      reasonFor = null;
      if (navigator.onLine) void invalidate('app:wo');
    } catch (err) {
      if (wo.id !== woId) return;
      if (err instanceof ApiError) {
        if (!err.code.startsWith('OFFLINE_'))
          retryPost = err.status === 0 || err.status >= 500 ? payload : null;
        postError = err.message;
        if (err.code === 'STALE') void invalidate('app:wo');
      } else postError = 'Pengiriman Logbook gagal. Coba lagi.';
    } finally {
      posting = false;
    }
  }

  async function changeStatus(to: WoStatus, why?: string) {
    if (woReasonRequired(wo.status, to) && why === undefined) {
      reasonFor = { to, via: 'prop' };
      reason = '';
      reasonOpen = true;
      return;
    }
    try {
      if (await submitWoStatus(wo, userId, to, why)) {
        toast('Perubahan status disimpan di antrean');
        return;
      }
      toast(`Status: ${WO_STATUS_LABEL[to]}`);
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
    }
  }

  async function confirmReason(e?: SubmitEvent) {
    e?.preventDefault();
    if (!reason.trim() || !reasonFor) return;
    reasonOpen = false;
    const to = reasonFor.to;
    reasonFor = null;
    await changeStatus(to, reason.trim());
  }

  async function requestHelp(e?: SubmitEvent) {
    e?.preventDefault();
    if (!helpBody.trim()) return;
    busy = true;
    try {
      await api(`/api/work-orders/${wo.id}/help`, {
        body: { clientId: crypto.randomUUID(), body: helpBody.trim(), showFlag: true },
      });
      helpOpen = false;
      helpBody = '';
      toast('Permintaan bantuan terkirim ke pengelola project');
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function reply(e?: SubmitEvent) {
    e?.preventDefault();
    if (!replyBody.trim()) return;
    busy = true;
    try {
      await api(`/api/work-orders/${wo.id}/help/reply`, {
        body: { clientId: crypto.randomUUID(), body: replyBody.trim(), resolve: replyResolve },
      });
      replyOpen = false;
      replyBody = '';
      toast(replyResolve ? 'Bantuan ditandai selesai' : 'Balasan terkirim');
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function toggleWatch() {
    try {
      await api(`/api/work-orders/${wo.id}/watch`, {
        method: wo.isWatching ? 'DELETE' : 'POST',
        body: {},
      });
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
    }
  }

  function snapshotEdit() {
    return { id: wo.id, updatedAt: wo.updatedAt, can: wo.can, fields: woEditFields(wo) };
  }

  function openEdit() {
    editBaseline = snapshotEdit();
    edit = { ...editBaseline.fields };
    originalType = wo.type;
    members = [];
    editTypes = [];
    editLoading = false;
    editError = '';
    editLoadFailed = false;
    editOpen = true;
    if (wo.can.editCore) void loadEditOptions();
  }

  async function loadEditOptions() {
    const snapshot = editBaseline;
    editLoading = true;
    editLoadFailed = false;
    try {
      const [project, directory] = await Promise.all([
        api<{ members: Member[] }>(`/api/projects/${wo.project.id}`),
        api<{ woTypes: WoType[] }>('/api/directory/wo-types'),
      ]);
      if (snapshot !== editBaseline) return;
      members = project.members;
      editTypes = directory.woTypes.filter((type) => type.active !== false);
    } catch {
      if (snapshot === editBaseline) editLoadFailed = true;
    } finally {
      if (snapshot === editBaseline) editLoading = false;
    }
  }

  async function saveEdit(e?: SubmitEvent) {
    e?.preventDefault();
    if (!editBaseline || editBaseline.id !== wo.id || busy) return;
    editError = '';
    if (editBaseline.can.editCore && edit.deadline < edit.plannedStart) {
      editError = 'Deadline tidak boleh sebelum tanggal mulai.';
      return;
    }
    busy = true;
    try {
      const patch = woEditPatch(editBaseline, edit);
      if (Object.keys(patch).length > 1) {
        await api(`/api/work-orders/${wo.id}`, { method: 'PATCH', body: patch });
        toast('WO diperbarui');
      }
      editOpen = false;
      await invalidate('app:wo');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE') {
        editError =
          'WO sudah diubah orang lain. Salin isian Anda, lalu buka kembali Edit WO untuk meninjau versi terbaru.';
        void invalidate('app:wo');
      } else {
        editError = err instanceof ApiError ? err.message : 'Perubahan gagal disimpan.';
      }
    } finally {
      busy = false;
    }
  }

  async function more() {
    if (!cursor || moreBusy) return;
    const firstPage = data.log;
    const query = new SvelteURLSearchParams(data.logQuery);
    query.set('before', cursor);
    moreBusy = true;
    moreError = '';
    try {
      const result = await api<{ entries: LogEntry[]; nextCursor: string | null }>(
        `/api/work-orders/${wo.id}/logbook?${query}`,
      );
      if (data.log !== firstPage) return;
      entries = [...entries, ...result.entries];
      cursor = result.nextCursor;
    } catch (err) {
      if (data.log === firstPage)
        moreError = err instanceof ApiError ? err.message : 'Catatan lama gagal dimuat.';
    } finally {
      moreBusy = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void post();
    }
  }
</script>

<svelte:head><title>{wo.numberLabel} — {wo.title} · REIN</title></svelte:head>

<div class="wo">
  <div class="main">
    <div class="head">
      <div class="chips">
        <span class="faint tnum">{wo.numberLabel}</span>
        <Tag category={wo.type.category}>{wo.type.name}</Tag>
        {#if wo.urgent}<FlagBadge type="urgent" />{/if}
        {#if wo.help}<FlagBadge type="help" pulse />{/if}
        {#if wo.overdue}<FlagBadge type="late" />{/if}
      </div>
      <h1>{wo.title}</h1>
      {#if wo.status === 'canceled' && wo.canceledReason}
        <p class="muted">Dibatalkan: {wo.canceledReason}</p>
      {/if}
    </div>

    {#if wo.detail}<p class="desc">{wo.detail}</p>{/if}

    {#if wo.attachments.length}
      <div class="files">
        <span class="faint lbl"
          ><Icon name="paperclip" size={14} />Lampiran WO · {wo.attachments.length}</span
        >
        {@render thumbs(wo.attachments)}
      </div>
    {/if}

    {#if wo.materials.length}
      <div class="sec-h">
        <Icon name="file" />
        <h2>Material WO</h2>
        <span class="faint">{wo.materials.length} item</span>
      </div>
      <ul class="wo-materials">
        {#each wo.materials as material (material.id)}
          <li>
            <div>
              <b>{material.description}</b><small
                >{material.material} · {material.specification}</small
              >
            </div>
            <span>{material.quantity.toLocaleString('id-ID')} {material.unit}</span><span
              class="faint">{MATERIAL_STATUS_LABEL[material.status]}</span
            >
          </li>
        {/each}
      </ul>
    {/if}
    <nav class="wo-tabs" aria-label="Catatan dan aktivitas WO">
      <!-- eslint-disable svelte/no-navigation-without-resolve -- woUrl berasal dari resolve() -->
      <a
        href={filterQuery ? `${woUrl}?${filterQuery}` : woUrl}
        aria-current={data.tab === 'logbook' ? 'page' : undefined}
      >
        <Icon name="logbook" size={16} />Logbook
      </a>
      <a
        href={`${woUrl}?tab=activity${filterQuery ? `&${filterQuery}` : ''}`}
        aria-current={data.tab === 'activity' ? 'page' : undefined}
      >
        <Icon name="clock" size={16} />Aktivitas
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    </nav>
    {#if data.tab === 'activity'}
      <ActivityList woId={wo.id} />
    {:else}
      <div class="log-layout">
        {#if wo.can.writeLogbook && !data.entry}
          <div class="composer">
            <textarea
              aria-label="Tulis logbook"
              placeholder="Tulis pekerjaan, kendala, atau catatan… (Ctrl+Enter untuk kirim)"
              bind:value={body}
              readonly={posting || !!retryPost}
              {onkeydown}
              rows="3"></textarea>
            <div class="row">
              {#if wo.can.upload}<StagedFiles
                  {userId}
                  bind:items={files}
                  compact
                  camera
                  offline
                  disabled={posting || !!retryPost}
                />{/if}
              <span class="sp"></span>
              <Button
                variant="primary"
                onclick={post}
                loading={posting}
                disabled={uploading ||
                  (!body.trim() && !hasFiles && progress === undefined) ||
                  (progress !== undefined &&
                    (!Number.isInteger(progress) || progress < 0 || progress > 100))}
                >{retryPost ? 'Coba lagi' : 'Kirim'}</Button
              >
            </div>
            <div class="log-options">
              <label
                >Status catatan (opsional)
                <select bind:value={category} disabled={posting || !!retryPost}>
                  <option value="">Tanpa status</option>
                  {#each Object.entries(LOGBOOK_CATEGORY_LABEL) as [value, label] (value)}<option
                      {value}>{label}</option
                    >{/each}
                </select>
              </label>
              {#if wo.can.updateProgress}
                <label
                  >Progres WO % (opsional)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    placeholder={`Saat ini ${wo.progress}%`}
                    bind:value={progress}
                    disabled={posting || !!retryPost}
                  />
                </label>
              {/if}
            </div>
            {#if postError}<p role="alert">{postError}</p>{/if}
          </div>
        {/if}

        <div class="log-tools">
          {#if data.entry}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- woUrl berasal dari resolve() -->
            <a href={woUrl}>Lihat Logbook minggu ini</a>
          {:else}
            <PeriodPicker period={data.period} date={data.date} onchange={setLogPeriod} />
            <div class="log-columns" role="group" aria-label="Tata letak Logbook">
              <Button aria-pressed={columns === 1} onclick={() => setColumns(1)}>1 kolom</Button>
              <Button aria-pressed={columns === 2} onclick={() => setColumns(2)}>2 kolom</Button>
            </div>
          {/if}
        </div>
        <div class="entries" class:two={columns === 2 && !data.entry}>
          {#each entries as e, i (e.id)}
            {@const day = todayWib(new Date(e.createdAt))}
            {#if i === 0 || todayWib(new Date(entries[i - 1]!.createdAt)) !== day}
              <h2 class="log-day">{dayLabel(e.createdAt)}</h2>
            {/if}
            <article class="entry">
              <Avatar name={e.author.fullName} src={e.author.avatarUrl} size={24} />
              <div class="eb">
                <div class="eh">
                  <b>{e.author.fullName}</b>
                  <span class="faint">· {stamp(e.createdAt)}</span>
                  {#if e.editedAt}<span class="faint" title={stamp(e.editedAt)}>· diedit</span>{/if}
                  {#if e.kind === 'comment'}<span class="pill">Komentar</span>{/if}
                  {#if e.category}<span class="pill">{LOGBOOK_CATEGORY_LABEL[e.category]}</span
                    >{/if}
                  {#if e.progressTo != null}
                    <span class="pill">Progres {e.progressFrom ?? 0}% → {e.progressTo}%</span>
                  {/if}
                </div>
                {#if e.body}<p>
                    {#each logbookText(e.body) as part, i (i)}{#if part.href}<a
                          href={part.href}
                          target="_blank"
                          rel="external noopener noreferrer">{part.text}</a
                        >{:else}{part.text}{/if}{/each}
                  </p>{/if}
                {#if e.attachments.length}{@render thumbs(e.attachments)}{/if}
                {#if e.canEdit}
                  <div class="entry-actions">
                    <Button variant="ghost" onclick={() => openEntry(e, false)}>Edit catatan</Button
                    >
                    <Button variant="ghost" onclick={() => openEntry(e, true)}>Hapus catatan</Button
                    >
                  </div>
                {/if}
              </div>
            </article>
          {:else}
            <p class="muted">
              {data.entry
                ? 'Catatan ini sudah tidak tersedia.'
                : 'Belum ada catatan pada periode ini.'}
            </p>
          {/each}
        </div>
        {#if moreError}<p role="alert">{moreError}</p>{/if}
        {#if cursor}<Button variant="ghost" loading={moreBusy} onclick={more}
            >Muat lebih lama</Button
          >{/if}
      </div>
    {/if}
  </div>

  <aside class="props">
    <div class="prop">
      <span>Status</span>
      <span class="v">
        <StatusIcon status={wo.status} />
        {#if wo.can.statusTargets.length}
          <select
            aria-label="Ubah status"
            value=""
            onchange={(e) => {
              const v = e.currentTarget.value as WoStatus;
              e.currentTarget.value = '';
              if (v) void changeStatus(v);
            }}
          >
            <option value="">{WO_STATUS_LABEL[wo.status]}</option>
            {#each wo.can.statusTargets as s (s)}<option value={s}>→ {WO_STATUS_LABEL[s]}</option
              >{/each}
          </select>
        {:else}
          {WO_STATUS_LABEL[wo.status]}
        {/if}
      </span>
    </div>
    {#if wo.statusHint}<p class="status-hint">{wo.statusHint}</p>{/if}
    <div class="prop">
      <span>PIC</span>
      <span class="v"
        ><Avatar name={wo.assignee.fullName} src={wo.assignee.avatarUrl} size={20} />{wo.assignee
          .fullName}</span
      >
    </div>
    <div class="prop"><span>Pembuat</span><span class="v">{wo.creator.fullName}</span></div>
    <div class="prop">
      <span>Deadline</span>
      <span class="v" class:late={wo.overdue}>
        {shortDate(wo.deadline)} ·
        {#if wo.status === 'done'}selesai{:else if daysLeft >= 0}{daysLeft} hari lagi{:else}terlambat
          {-daysLeft} hari{/if}
      </span>
    </div>
    <div class="prop"><span>Urgent</span><span class="v">{wo.urgent ? 'Ya' : 'Tidak'}</span></div>
    <div class="prop">
      <span>Bobot</span><span class="v tnum"
        >{wo.weight != null ? `${wo.weight}%` : 'otomatis'}</span
      >
    </div>
    <div class="prop">
      <span>Progres</span>
      <span class="v"
        ><Progress value={wo.status === 'done' ? 100 : wo.progress} width={96} /><b class="tnum"
          >{wo.status === 'done' ? 100 : wo.progress}%</b
        ></span
      >
    </div>
    {#if wo.can.editCore || wo.can.editDetail || wo.can.editWeight}
      <Button icon="edit" onclick={openEdit}>Edit WO</Button>
    {/if}

    <div class="sep"></div>
    <div class="help" class:active={!!wo.help}>
      {#if wo.help}
        <b class="hb"><Icon name="flag" />Bantuan diminta</b>
        <span class="muted small"
          >Pengelola project sudah dinotifikasi lewat in-app dan WhatsApp.</span
        >
        {#if wo.can.resolveHelp}
          <Button icon="comment" onclick={() => (replyOpen = true)}>Balas / tandai selesai</Button>
        {/if}
      {:else}
        <b class="hb plain"><Icon name="flag" />Ada kendala?</b>
        <span class="muted small"
          >Tandai "Butuh bantuan" agar pengelola project langsung mendapat notifikasi.</span
        >
        {#if wo.can.requestHelp}
          <Button icon="flag" onclick={() => (helpOpen = true)}>Minta bantuan</Button>
        {/if}
      {/if}
    </div>

    <div class="watch">
      <span class="faint small">Pengikut · {wo.watchers.length}</span>
      <div class="stack">
        {#each wo.watchers.slice(0, 6) as p (p.id)}<Avatar
            name={p.fullName}
            src={p.avatarUrl}
            size={24}
          />{/each}
      </div>
      <Button variant="ghost" onclick={toggleWatch}
        >{wo.isWatching ? 'Berhenti ikuti' : 'Ikuti'}</Button
      >
    </div>
  </aside>
</div>

{#snippet thumbContent(f: FileItem)}
  {#if thumbUrl(f, userId)}
    <img src={thumbUrl(f, userId)} alt="" width="112" height="84" loading="lazy" decoding="async" />
  {:else}
    <span class="im"><Icon name={isPreviewImage(f.mime) ? 'camera' : 'file'} size={20} /></span>
  {/if}
  <span class="tn">{f.fileName}<small>{formatBytes(f.sizeBytes)}</small></span>
{/snippet}

{#snippet thumbs(list: typeof wo.attachments)}
  <div class="thumbs">
    {#each list as f (f.id)}
      {#if isPreviewImage(f.mime)}
        <button
          class="thumb"
          type="button"
          onclick={() => {
            photo = f;
            photoOpen = true;
          }}>{@render thumbContent(f)}</button
        >
      {:else}
        <a
          class="thumb"
          href={fileUrl(f.id)}
          target={f.mime === 'application/pdf' ? '_blank' : undefined}
          rel="external noopener"
        >
          {@render thumbContent(f)}
        </a>
      {/if}
    {/each}
  </div>
{/snippet}

<PhotoLightbox bind:open={photoOpen} {photo} />

<Modal
  bind:open={entryOpen}
  title={entryDeleting ? 'Hapus catatan Logbook?' : 'Edit catatan Logbook'}
  width={520}
>
  <form id="logbook-entry" class="grid" onsubmit={saveEntry}>
    {#if entryError}<p role="alert">{entryError}</p>{/if}
    {#if entryDeleting}
      <p>Catatan dan lampirannya akan hilang dari Logbook. Riwayat progres WO tetap tercatat.</p>
    {:else}
      <Field label="Catatan" id="edit-logbook">
        <textarea id="edit-logbook" rows="4" maxlength="5000" bind:value={entryBody}></textarea>
      </Field>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (entryOpen = false)}>Batal</Button>
    <Button
      variant={entryDeleting ? 'danger' : 'primary'}
      type="submit"
      form="logbook-entry"
      loading={entryBusy}
    >
      {entryDeleting ? 'Hapus' : 'Simpan'}
    </Button>
  {/snippet}
</Modal>

<Modal bind:open={reasonOpen} title="Alasan perubahan status" width={440}>
  <form id="reason-f" onsubmit={confirmReason}>
    <Field label={`Kenapa ${reasonFor ? WO_STATUS_LABEL[reasonFor.to] : ''}?`} id="reason">
      <textarea id="reason" bind:value={reason} rows="3" required maxlength="500"></textarea>
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (reasonOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="reason-f" disabled={!reason.trim()}>Simpan</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={helpOpen} title="Butuh bantuan" width={480}>
  <form id="help-f" onsubmit={requestHelp}>
    <Field
      label="Apa kendalanya?"
      id="help-b"
      hint="Pengelola project & pembuat WO menerima notifikasi segera, termasuk di jam tenang."
    >
      <textarea id="help-b" bind:value={helpBody} rows="4" required maxlength="1000"></textarea>
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (helpOpen = false)}>Batal</Button>
    <Button
      variant="danger"
      icon="flag"
      type="submit"
      form="help-f"
      loading={busy}
      disabled={!helpBody.trim()}>Kirim permintaan</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={replyOpen} title="Balas permintaan bantuan" width={480}>
  <form id="reply-f" onsubmit={reply}>
    <Field label="Balasan" id="reply-b">
      <textarea id="reply-b" bind:value={replyBody} rows="4" required maxlength="5000"></textarea>
    </Field>
    <Checkbox bind:checked={replyResolve}>Tandai bantuan selesai</Checkbox>
  </form>
  {#snippet footer()}
    <Button onclick={() => (replyOpen = false)}>Batal</Button>
    <Button
      variant="primary"
      type="submit"
      form="reply-f"
      loading={busy}
      disabled={!replyBody.trim()}>Kirim</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={editOpen} title={`Edit ${wo.numberLabel}`} width={560}>
  <form id="edit-f" class="grid" onsubmit={saveEdit}>
    {#if editError}<p role="alert">{editError}</p>{/if}
    {#if wo.can.editCore}
      <Input label="Nama WO" bind:value={edit.title} required maxlength={160} />
      {#if editLoadFailed}
        <p role="status">
          Pilihan Jenis dan PIC gagal dimuat. <Button onclick={loadEditOptions}>Coba lagi</Button>
        </p>
      {/if}
      <Field label="Jenis" id="e-type">
        <select
          id="e-type"
          bind:value={edit.typeId}
          disabled={editLoading || editLoadFailed}
          required
        >
          {#if originalType && !editTypes.some((type) => type.id === originalType?.id)}
            <option value={originalType.id}>{originalType.name}</option>
          {/if}
          {#each WO_CATEGORIES as category (category)}
            {@const types = editTypes.filter((type) => type.category === category)}
            {#if types.length}
              <optgroup label={WO_CATEGORY_META[category].label}>
                {#each types as type (type.id)}<option value={type.id}>{type.name}</option>{/each}
              </optgroup>
            {/if}
          {/each}
        </select>
      </Field>
      <Field label="PIC" id="e-pic">
        <select
          id="e-pic"
          bind:value={edit.assigneeId}
          disabled={editLoading || editLoadFailed}
          required
        >
          {#each members as m (m.userId)}<option value={m.userId}
              >{m.fullName} · {m.projectRole}</option
            >{/each}
          {#if !members.length}<option value={wo.assignee.id}>{wo.assignee.fullName}</option>{/if}
        </select>
      </Field>
      <Input label="Mulai (rencana)" type="date" bind:value={edit.plannedStart} required />
      <Input label="Deadline" type="date" bind:value={edit.deadline} required />
      <Toggle bind:checked={edit.urgent} label="Urgent" showLabel />
    {/if}
    {#if wo.can.editWeight}
      <Input
        label="Bobot (%)"
        inputmode="decimal"
        bind:value={edit.weight}
        hint="Kosongkan = otomatis"
      />
    {/if}
    {#if wo.can.editDetail}
      <Field label="Detail" id="e-det">
        <textarea id="e-det" bind:value={edit.detail} rows="4" maxlength="5000"></textarea>
      </Field>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (editOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="edit-f" loading={busy}>Simpan</Button>
  {/snippet}
</Modal>

<style>
  .entry-actions {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .wo-materials {
    list-style: none;
    padding: 0;
    margin: 12px 0;
  }
  .wo-materials li {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--color-border-default);
  }
  .wo-materials li div {
    flex: 1;
    min-width: 160px;
    overflow-wrap: anywhere;
  }
  .wo-materials small {
    display: block;
    margin-top: 4px;
    color: var(--color-text-secondary);
  }
  .log-options {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 0 12px 12px;
  }
  .log-options label {
    display: grid;
    gap: 6px;
    font: var(--text-caption);
    color: var(--color-text-secondary);
    flex: 1;
    min-width: 150px;
  }
  .log-options input,
  .log-options select {
    width: 100%;
    height: 36px;
    padding: 0 8px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  .status-hint {
    font: var(--text-caption);
    color: var(--color-text-secondary);
    line-height: 1.6;
    margin: 0 0 14px;
  }
  .wo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    min-height: 100%;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px 32px 48px;
    max-width: 860px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .desc {
    white-space: pre-wrap;
    color: var(--color-text-primary);
  }
  .files {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lbl {
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .sep {
    height: 1px;
    background: var(--color-border-default);
  }
  .sec-h {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sec-h h2 {
    font: var(--text-heading-16);
  }
  .composer {
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    transition:
      border-color var(--dur),
      box-shadow var(--dur);
  }
  .composer:focus-within {
    border-color: var(--color-accent-default);
    box-shadow: 0 0 0 3px var(--color-accent-subtle);
  }
  .composer textarea {
    width: 100%;
    border: 0;
    resize: vertical;
    padding: 12px;
    background: transparent;
    color: var(--color-text-primary);
    font: var(--text-body-14);
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--color-border-default);
  }
  .prop select {
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: var(--text-label);
  }
  .sp {
    flex: 1;
  }
  .entries {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-bottom: 8px;
  }
  .wo-tabs {
    display: flex;
    gap: 16px;
    margin: 20px 0 14px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .wo-tabs a {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 4px;
    border-bottom: 2px solid transparent;
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .wo-tabs a[aria-current] {
    border-color: var(--color-accent-default);
    color: var(--color-text-primary);
  }
  .log-layout {
    container: logbook / inline-size;
  }
  .log-tools {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin: 12px 0;
  }
  .log-columns {
    display: none;
    gap: 4px;
  }
  .log-columns :global([aria-pressed='true']) {
    border-color: var(--color-accent-default);
    background: var(--color-accent-subtle);
  }
  .log-day {
    grid-column: 1 / -1;
    margin: 6px 0 0;
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  @container logbook (min-width: 620px) {
    .log-columns {
      display: flex;
    }
    .entries.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .entry {
    display: flex;
    gap: 10px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    animation: fade 0.25s var(--ease);
  }
  .eb {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .eh {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .eh b {
    font-size: 13px;
    font-weight: 500;
  }
  .entry p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font: var(--text-micro);
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .thumb {
    width: 112px;
    text-align: start;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    overflow: hidden;
    color: inherit;
    text-decoration: none;
    background: var(--color-bg-surface);
  }
  .thumb:hover {
    border-color: var(--color-border-strong);
    text-decoration: none;
  }
  .thumb img,
  .thumb .im {
    display: grid;
    place-items: center;
    width: 112px;
    height: 84px;
    object-fit: cover;
    background: var(--color-bg-subtle);
    color: var(--color-icon-default);
  }
  .tn {
    display: block;
    padding: 4px 6px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tn small {
    display: block;
    color: var(--color-text-tertiary);
  }
  .props {
    border-left: 1px solid var(--color-border-default);
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--color-bg-app);
  }
  .prop {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .prop > span:first-child {
    color: var(--color-text-tertiary);
    font-size: 12px;
  }
  .v {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .v b {
    font-weight: 500;
  }
  .late {
    color: var(--color-danger-default);
  }
  .help {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
  }
  .help.active {
    background: var(--color-danger-subtle);
    border-color: transparent;
  }
  .hb {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--color-danger-default);
    font-weight: 500;
  }
  .hb.plain {
    color: var(--color-text-primary);
  }
  .small {
    font-size: 12px;
  }
  .watch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .stack {
    display: inline-flex;
  }
  .stack :global(.av + .av) {
    margin-left: -5px;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  @media (max-width: 1023px) {
    .wo {
      grid-template-columns: 1fr;
    }
    .props {
      order: -1;
      border-left: 0;
      border-bottom: 1px solid var(--color-border-default);
    }
  }
  @media (max-width: 767px) {
    .main {
      padding: 16px 16px 96px;
    }
  }
</style>
