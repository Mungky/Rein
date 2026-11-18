<script lang="ts">
  import {
    LOGBOOK_CATEGORY_LABEL,
    WO_STATUS_LABEL,
    woReasonRequired,
    type LogbookCategory,
    type WoStatus,
  } from '@rein/shared';
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { fileUrl, thumbUrl, type Staged } from '$lib/attach';
  import { setChrome } from '$lib/chrome.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Field from '$lib/components/Field.svelte';
  import FlagBadge from '$lib/components/FlagBadge.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import StagedFiles from '$lib/components/StagedFiles.svelte';
  import StatusIcon from '$lib/components/StatusIcon.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { formatBytes, shortDate, stamp } from '$lib/format';
  import { onLive } from '$lib/live.svelte';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { LogEntry, Member } from '$lib/types';

  /** Detail WO + Logbook (Figma D/07a, M/07; FR-031–034, FR-040–042, FR-050–051). */
  let { data } = $props();
  const wo = $derived(data.wo);
  let entries = $state<LogEntry[]>([]);
  let cursor = $state<string | null>(null);
  $effect(() => {
    entries = data.log.entries;
    cursor = data.log.nextCursor;
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
    if (e.type === 'wo' && e.woId === wo.id) void invalidate('app:wo');
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
  const uploading = $derived(files.some((f) => !f.id && !f.error));

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
  let edit = $state({
    title: '',
    assigneeId: '',
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

  async function post() {
    if (posting || uploading) return;
    if (!body.trim() && !files.some((f) => f.id) && progress === undefined) return;
    posting = true;
    try {
      await api(`/api/work-orders/${wo.id}/logbook`, {
        body: {
          clientId: postId,
          body: body.trim(),
          attachmentIds: files.filter((f) => f.id).map((f) => f.id!),
          ...(progress !== undefined ? { progress, expectedUpdatedAt: wo.updatedAt } : {}),
          ...(category ? { category } : {}),
        },
      });
      body = '';
      files = [];
      progress = undefined;
      category = '';
      postId = crypto.randomUUID();
      reasonFor = null;
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
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
      await api(`/api/work-orders/${wo.id}/status`, {
        body: { status: to, expectedUpdatedAt: wo.updatedAt, ...(why ? { reason: why } : {}) },
      });
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

  async function openEdit() {
    edit = {
      title: wo.title,
      assigneeId: wo.assignee.id,
      deadline: wo.deadline,
      urgent: wo.urgent,
      weight: wo.weight == null ? '' : String(wo.weight),
      detail: wo.detail,
    };
    editOpen = true;
    if (!members.length) {
      members = (await api<{ members: Member[] }>(`/api/projects/${wo.project.id}`)).members;
    }
  }

  async function saveEdit(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    try {
      const patch: Record<string, unknown> = { expectedUpdatedAt: wo.updatedAt };
      if (edit.title.trim() !== wo.title) patch.title = edit.title.trim();
      if (edit.assigneeId !== wo.assignee.id) patch.assigneeId = edit.assigneeId;
      if (edit.deadline !== wo.deadline) patch.deadline = edit.deadline;
      if (edit.urgent !== wo.urgent) patch.urgent = edit.urgent;
      if (edit.detail !== wo.detail) patch.detail = edit.detail;
      if (wo.can.editWeight) {
        const w = edit.weight.trim() === '' ? null : Number(edit.weight.replace(',', '.'));
        if (w !== wo.weight) patch.weight = w;
      }
      if (Object.keys(patch).length > 1) {
        await api(`/api/work-orders/${wo.id}`, { method: 'PATCH', body: patch });
        toast('WO diperbarui');
      }
      editOpen = false;
      await invalidate('app:wo');
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function more() {
    if (!cursor) return;
    const r = await api<{ entries: LogEntry[]; nextCursor: string | null }>(
      `/api/work-orders/${wo.id}/logbook?before=${encodeURIComponent(cursor)}`,
    );
    entries = [...entries, ...r.entries];
    cursor = r.nextCursor;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void post();
    }
  }

  const PILL: Record<LogEntry['kind'], string | null> = {
    note: null,
    comment: 'Komentar',
    system: 'Sistem',
    help_request: 'Butuh bantuan',
    help_resolved: 'Bantuan selesai',
  };
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

    <div class="sep"></div>
    <div class="sec-h">
      <Icon name="logbook" />
      <h2>Logbook</h2>
      <span class="faint">{entries.length}{cursor ? '+' : ''} entri</span>
    </div>

    {#if wo.can.writeLogbook}
      <div class="composer">
        <textarea
          aria-label="Tulis logbook"
          placeholder="Tulis pekerjaan, kendala, atau catatan… (Ctrl+Enter untuk kirim)"
          bind:value={body}
          {onkeydown}
          rows="3"></textarea>
        <div class="row">
          {#if wo.can.upload}<StagedFiles {userId} bind:items={files} compact camera />{/if}
          <span class="sp"></span>
          <Button
            variant="primary"
            onclick={post}
            loading={posting}
            disabled={uploading ||
              (!body.trim() && !files.some((f) => f.id) && progress === undefined) ||
              (progress !== undefined &&
                (!Number.isInteger(progress) || progress < 0 || progress > 100))}>Kirim</Button
          >
        </div>
        <div class="log-options">
          <label
            >Status catatan (opsional)
            <select bind:value={category} disabled={posting}>
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
                disabled={posting}
              />
            </label>
          {/if}
        </div>
      </div>
    {/if}

    <div class="entries">
      {#each entries as e (e.id)}
        <div class="entry" class:sys={e.kind === 'system'}>
          <Avatar name={e.author.fullName} src={e.author.avatarUrl} size={24} />
          <div class="eb">
            <div class="eh">
              <b>{e.author.fullName}</b>
              <span class="faint">· {stamp(e.createdAt)}</span>
              {#if PILL[e.kind]}<span class="pill {e.kind}">{PILL[e.kind]}</span>{/if}
              {#if e.category}<span class="pill">{LOGBOOK_CATEGORY_LABEL[e.category]}</span>{/if}
              {#if e.progressTo != null}
                <span class="pill">Progres {e.progressFrom ?? 0}% → {e.progressTo}%</span>
              {/if}
              {#if e.statusTo && e.statusTo !== e.statusFrom}
                <span class="pill">→ {WO_STATUS_LABEL[e.statusTo]}</span>
              {/if}
            </div>
            {#if e.body}<p>{e.body}</p>{/if}
            {#if e.attachments.length}{@render thumbs(e.attachments)}{/if}
          </div>
        </div>
      {:else}
        <span class="faint">Belum ada entri. Tulis catatan pertama di atas.</span>
      {/each}
      {#if cursor}<Button variant="ghost" onclick={more}>Muat lebih lama</Button>{/if}
    </div>
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
    {#if wo.can.editDetail}
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

{#snippet thumbs(list: typeof wo.attachments)}
  <div class="thumbs">
    {#each list as f (f.id)}
      <!-- eslint-disable svelte/no-navigation-without-resolve -- /files/* disajikan server, bukan route SPA -->
      <a class="thumb" href={fileUrl(f.id)} target="_blank" rel="noopener">
        {#if thumbUrl(f)}
          <img
            src={thumbUrl(f)}
            alt={f.fileName}
            width="112"
            height="84"
            loading="lazy"
            decoding="async"
          />
        {:else}
          <span class="im"><Icon name="file" size={20} /></span>
        {/if}
        <span class="tn">{f.fileName}<small>{formatBytes(f.sizeBytes)}</small></span>
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {/each}
  </div>
{/snippet}

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
    <Input label="Nama WO" bind:value={edit.title} required maxlength={160} />
    {#if wo.can.editAny}
      <Field label="PIC" id="e-pic">
        <select id="e-pic" bind:value={edit.assigneeId}>
          {#each members as m (m.userId)}<option value={m.userId}
              >{m.fullName} · {m.projectRole}</option
            >{/each}
          {#if !members.length}<option value={wo.assignee.id}>{wo.assignee.fullName}</option>{/if}
        </select>
      </Field>
      <Input label="Deadline" type="date" bind:value={edit.deadline} />
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
    <Field label="Detail" id="e-det">
      <textarea id="e-det" bind:value={edit.detail} rows="4" maxlength="5000"></textarea>
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (editOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="edit-f" loading={busy}>Simpan</Button>
  {/snippet}
</Modal>

<style>
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
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .entry {
    display: flex;
    gap: 10px;
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
  .entry.sys p {
    color: var(--color-text-secondary);
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
  .pill.help_request {
    background: var(--color-danger-subtle);
    color: var(--color-danger-default);
  }
  .pill.help_resolved {
    background: var(--color-success-subtle);
    color: var(--color-success-default);
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .thumb {
    width: 112px;
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
