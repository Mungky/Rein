<script lang="ts">
  import {
    MATERIAL_STATUS_LABEL,
    materialIdentity,
    type MaterialInput,
    type MaterialStatus,
  } from '@rein/shared';
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { materialPreview, type MaterialPreview } from '$lib/material-import';
  import { onLive } from '$lib/live.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { MaterialRow, WoRow } from '$lib/types';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ProjectMaterialRow from './ProjectMaterialRow.svelte';

  let { projectId, workOrders }: { projectId: string; workOrders: WoRow[] } = $props();
  let rows = $state<MaterialRow[]>([]);
  let canManage = $state(false);
  let loading = $state(true);
  let loadError = $state('');
  let busy = $state(false);
  let query = $state('');
  let filter = $state<MaterialStatus | ''>('');
  let picker = $state<HTMLInputElement>();
  let preview = $state<MaterialPreview | null>(null);
  let previewOpen = $state(false);
  let importRows = $state<Array<MaterialInput & { clientId: string }>>([]);
  let sourceName = $state('');
  let deleteOpen = $state(false);
  const selected = new SvelteSet<string>();
  let attachOpen = $state(false);
  let attachMaterial = $state<MaterialRow | null>(null);
  let attachWoId = $state('');
  let actionError = $state('');
  const importDuplicates = $derived.by(() => {
    const identities = new SvelteSet(rows.map(materialIdentity));
    let duplicates = 0;
    for (const row of importRows) {
      const identity = materialIdentity(row);
      if (identities.has(identity)) duplicates++;
      identities.add(identity);
    }
    return duplicates;
  });
  const endpoint = $derived('/api/projects/' + projectId + '/materials');
  const selectionEndpoint = $derived(endpoint + '/selection');
  const filtered = $derived(
    rows.filter(
      (r) =>
        (!filter || r.status === filter) &&
        (r.description + ' ' + r.material + ' ' + r.specification)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
  );
  const allVisibleSelected = $derived(
    filtered.length > 0 && filtered.every((r) => selected.has(r.id)),
  );
  const someVisibleSelected = $derived(filtered.some((r) => selected.has(r.id)));

  function selectRow(id: string, value: boolean) {
    if (value) selected.add(id);
    else selected.delete(id);
  }

  let request: AbortController | undefined;
  async function load() {
    request?.abort();
    const current = new AbortController();
    request = current;
    try {
      const result = await api<{ materials: MaterialRow[]; canManage: boolean }>(endpoint, {
        signal: current.signal,
      });
      if (current.signal.aborted) return false;
      rows = result.materials;
      const activeIds = new Set(rows.map((row) => row.id));
      for (const id of selected) if (!activeIds.has(id)) selected.delete(id);
      canManage = result.canManage;
      loadError = '';
      return true;
    } catch (err) {
      if (!current.signal.aborted)
        loadError = err instanceof ApiError ? err.message : 'Material gagal dimuat';
      return false;
    } finally {
      if (!current.signal.aborted) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  const off = onLive((e) => {
    if (e.type === 'project' && e.projectId === projectId) void load();
  });
  onDestroy(() => {
    request?.abort();
    off();
  });

  async function read(file: File) {
    if (busy) return;
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 10 * 1024 * 1024) {
      toast('Pilih file .xlsx maksimal 10 MB', { tone: 'danger' });
      return;
    }
    busy = true;
    try {
      const { default: readExcel } = await import('read-excel-file/browser');
      preview = materialPreview(await readExcel(file));
      importRows = preview.rows.map((r) => ({ ...r, clientId: crypto.randomUUID() }));
      sourceName = file.name;
      previewOpen = true;
    } catch {
      toast('File Excel tidak dapat dibaca. Periksa format .xlsx dan coba lagi.', {
        tone: 'danger',
      });
    } finally {
      busy = false;
    }
  }
  async function importMaterials() {
    if (busy || !preview || preview.errors.length || !importRows.length) return;
    busy = true;
    try {
      const result = await api<{ inserted: number; skipped: number }>(
        `/api/projects/${projectId}/materials`,
        { body: { rows: importRows, source: 'excel' } },
      );
      previewOpen = false;
      toast(
        `${result.inserted} material ditambahkan${result.skipped ? ` · ${result.skipped} duplikat dilewati` : ''}`,
      );
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impor gagal', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
  type Selection = { id: string; expectedUpdatedAt: string };
  async function remove() {
    const affected = rows.filter((row) => selected.has(row.id));
    if (!affected.length || busy) return;
    busy = true;
    actionError = '';
    try {
      const deleted = await api<{ rows: Array<{ id: string; updatedAt: string }> }>(
        selectionEndpoint,
        {
          method: 'DELETE',
          body: {
            rows: affected.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })),
          },
        },
      );
      const removedIds = new Set(deleted.rows.map(({ id }) => id));
      deleteOpen = false;
      selected.clear();
      rows = rows.filter((row) => !removedIds.has(row.id));
      toast(deleted.rows.length + ' material dihapus', {
        duration: 10000,
        link: {
          label: 'Batalkan',
          onclick: () => {
            void restore(
              deleted.rows.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })),
            );
          },
        },
      });
      await load();
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : 'Material gagal dihapus';
      await load();
    } finally {
      busy = false;
    }
  }
  async function restore(entries: Selection[]) {
    try {
      await api(selectionEndpoint, { body: { rows: entries } });
      toast(entries.length + ' material dipulihkan');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Material gagal dipulihkan', {
        tone: 'danger',
      });
    }
  }
  async function link(row: MaterialRow, woId: string, linking: boolean) {
    if (busy || !woId) return;
    busy = true;
    actionError = '';
    try {
      await api(`/api/projects/${projectId}/materials/${row.id}/work-orders`, {
        method: linking ? 'POST' : 'DELETE',
        body: { woId },
      });
      attachOpen = false;
      toast(linking ? 'Material dihubungkan ke WO' : 'Hubungan material ke WO dilepas');
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Hubungan material gagal diubah';
      actionError = message;
      if (!linking) toast(message, { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
</script>

<section class="materials" aria-label="Material project">
  <div class="toolbar">
    <div class="heading">
      <h2>Material</h2>
      <p>{rows.length} item<span class="project-caption"> untuk kebutuhan project ini</span></p>
    </div>
    {#if canManage}<div class="actions">
        <input
          type="file"
          accept=".xlsx"
          hidden
          bind:this={picker}
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void read(f);
          }}
        />
        <Button icon="upload" loading={busy} onclick={() => picker?.click()}>Impor Excel</Button>
      </div>{/if}
  </div>
  <div class="filters">
    <div class="search">
      <Icon name="search" size={16} />
      <input
        type="search"
        aria-label="Cari material"
        placeholder="Cari material…"
        bind:value={query}
      />
    </div>
    <select aria-label="Filter status material" bind:value={filter}
      ><option value="">Semua status</option
      >{#each Object.entries(MATERIAL_STATUS_LABEL) as [value, label] (value)}<option {value}
          >{label}</option
        >{/each}</select
    >
  </div>
  {#if canManage && rows.length}
    <div class="selection-bar">
      <label class="check-all">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected && !allVisibleSelected}
          disabled={busy || !filtered.length}
          onchange={(e) => {
            for (const row of filtered) selectRow(row.id, e.currentTarget.checked);
          }}
        />
        Pilih yang tampil
      </label>
      {#if selected.size}
        <span role="status">{selected.size} dipilih</span>
        <Button size="sm" variant="ghost" disabled={busy} onclick={() => selected.clear()}
          >Batal pilih</Button
        >
        <Button
          size="sm"
          icon="trash"
          disabled={busy}
          onclick={() => {
            actionError = '';
            deleteOpen = true;
          }}>Hapus pilihan</Button
        >
      {/if}
    </div>
  {/if}
  {#if loadError}
    <p role="alert">{loadError}</p>
    <Button onclick={load}>Coba lagi</Button>
  {/if}
  {#if loading && !loadError}
    <p class="muted" role="status">Memuat material…</p>
  {:else if !loading}
    {#if !rows.length && !canManage && !loadError}<p class="muted">Belum ada material.</p>{/if}
    {#if canManage || rows.length}
      <!-- svelte-ignore a11y_no_redundant_roles (Safari needs the table role when displayed as a grid.) -->
      <table class="material-list" role="table" aria-label="Daftar material">
        <!-- svelte-ignore a11y_no_redundant_roles (Preserve the table hierarchy on mobile.) -->
        <thead role="rowgroup">
          <!-- svelte-ignore a11y_no_redundant_roles (Preserve the table hierarchy on mobile.) -->
          <tr role="row">
            {#if canManage}<th
                class="pick-col"
                scope="col"
                aria-label="Pilih material"
                role="columnheader"
              ></th>{/if}
            <th class="description-col" scope="col" role="columnheader">Deskripsi</th>
            <th scope="col" role="columnheader">Material</th>
            <th scope="col" role="columnheader">Spesifikasi</th>
            <th class="quantity-col" scope="col" role="columnheader">Jumlah / Satuan</th>
            <th class="status-col" scope="col" role="columnheader">Status</th>
            <th class="date-col" scope="col" role="columnheader">Diterima</th>
            <th scope="col" role="columnheader">Catatan</th>
            <th class="wo-col" scope="col" role="columnheader">Work Order</th>
          </tr>
        </thead>
        <!-- svelte-ignore a11y_no_redundant_roles (Safari needs the rowgroup role when displayed as a grid.) -->
        <tbody role="rowgroup">
          {#if canManage}
            <ProjectMaterialRow
              {endpoint}
              editable
              {busy}
              oncreated={() => {
                toast('Material ditambahkan');
                void load();
              }}
            />
          {/if}
          {#each filtered as row (row.id)}
            <ProjectMaterialRow
              {row}
              {endpoint}
              editable={canManage}
              {busy}
              checked={selected.has(row.id)}
              onselect={(value) => selectRow(row.id, value)}
              onreload={load}
              onupdated={(updated) => {
                rows = rows.map((item) =>
                  item.id === updated.id && item.updatedAt <= updated.updatedAt
                    ? { ...item, ...updated }
                    : item,
                );
                toast('Perubahan material disimpan');
                void load();
              }}
            >
              {#snippet links()}
                <div class="wo-links">
                  {#each row.woLinks as linked (linked.woId)}
                    <span>
                      <a href={resolve('/(app)/w/[id]', { id: linked.woId })} title={linked.title}
                        >{linked.numberLabel}</a
                      >
                      {#if canManage}
                        <button
                          type="button"
                          class="unlink"
                          aria-label={'Lepas dari ' + linked.numberLabel}
                          disabled={busy}
                          onclick={() => link(row, linked.woId, false)}>×</button
                        >
                      {/if}
                    </span>
                  {/each}
                  {#if canManage && workOrders.some((w) => !row.woLinks.some((l) => l.woId === w.id))}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="paperclip"
                      aria-label={'Hubungkan ' + row.description + ' ke WO'}
                      title="Hubungkan ke WO"
                      disabled={busy}
                      onclick={() => {
                        attachMaterial = row;
                        attachWoId = '';
                        actionError = '';
                        attachOpen = true;
                      }}><span class="attach-label">Hubungkan ke WO</span></Button
                    >
                  {:else if !row.woLinks.length}—{/if}
                </div>
              {/snippet}
            </ProjectMaterialRow>
          {/each}
        </tbody>
      </table>
      {#if rows.length && !filtered.length}<p class="muted">Tidak ada material yang cocok.</p>{/if}
    {/if}
  {/if}
</section>

<Modal bind:open={deleteOpen} title="Hapus material?" width={440}>
  <p>
    {selected.size} material akan dihapus dari daftar project dan WO terkait. Anda dapat membatalkannya
    lewat pemberitahuan setelah menghapus.
  </p>
  {#if actionError}<p role="alert">{actionError}</p>{/if}
  {#snippet footer()}
    <Button disabled={busy} onclick={() => (deleteOpen = false)}>Batal</Button>
    <Button variant="primary" loading={busy} disabled={!selected.size} onclick={remove}
      >Hapus material</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={attachOpen} title="Hubungkan material ke WO" width={500}>
  <p>{attachMaterial?.description}</p>
  <Field label="Work Order" id="material-wo"
    ><select id="material-wo" bind:value={attachWoId} disabled={busy}
      ><option value="">Pilih WO di project ini</option
      >{#each workOrders.filter((w) => !attachMaterial?.woLinks.some((l) => l.woId === w.id)) as wo (wo.id)}<option
          value={wo.id}>{wo.numberLabel} — {wo.title}</option
        >{/each}</select
    ></Field
  >
  <p class="muted">Material tetap di project dan dapat dihubungkan ke beberapa WO.</p>
  {#if actionError}<p role="alert" class="error">{actionError}</p>{/if}
  {#snippet footer()}<Button disabled={busy} onclick={() => (attachOpen = false)}>Batal</Button
    ><Button
      variant="primary"
      disabled={!attachWoId}
      loading={busy}
      onclick={() => {
        if (attachMaterial) void link(attachMaterial, attachWoId, true);
      }}>Hubungkan</Button
    >{/snippet}
</Modal>

<Modal bind:open={previewOpen} title="Pratinjau impor material" width={1000}>
  {#if preview}
    <p>{sourceName} · {preview.rows.length} material · {preview.sheets.join(', ')}</p>
    <p class="muted">
      {importRows.length - importDuplicates} material baru · {importDuplicates} duplikat akan dilewati.
    </p>
    {#if preview.errors.length}<div class="error" role="alert">
        <b>Perbaiki file sebelum mengimpor:</b>
        <ul>
          {#each preview.errors.slice(0, 20) as message, i (i)}<li>{message}</li>{/each}
        </ul>
      </div>{/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal scrolling.) -->
    <div class="table-scroll" tabindex="0" role="region" aria-label="Pratinjau material">
      <table>
        <thead
          ><tr
            ><th>Deskripsi</th><th>Material</th><th>Spesifikasi</th><th>QTY</th><th>Status</th><th
              >Diterima</th
            ><th>Catatan</th></tr
          ></thead
        ><tbody
          >{#each preview.rows as row, i (i)}<tr
              ><td>{row.description}</td><td>{row.material}</td><td>{row.specification}</td><td
                class="qty">{row.quantity} {row.unit}</td
              ><td>{MATERIAL_STATUS_LABEL[row.status]}</td><td>{row.receivedAt ?? ''}</td><td
                >{row.note || '—'}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  {/if}
  {#snippet footer()}<Button disabled={busy} onclick={() => (previewOpen = false)}>Batal</Button
    ><Button
      variant="primary"
      loading={busy}
      disabled={!preview ||
        !!preview.errors.length ||
        !preview.rows.length ||
        importDuplicates === importRows.length}
      onclick={importMaterials}>Impor {importRows.length - importDuplicates} material baru</Button
    >{/snippet}
</Modal>

<style>
  .wo-links,
  .selection-bar,
  .toolbar,
  .filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .wo-links span {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: 0 6px;
  }
  .wo-links .attach-label {
    display: none;
  }
  .unlink {
    padding: 4px 6px;
    color: var(--color-text-secondary);
  }
  .materials {
    padding: 20px 24px 32px;
  }
  .toolbar {
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 4px;
  }
  p {
    margin: 0 0 12px;
  }
  .toolbar p,
  .muted {
    color: var(--color-text-secondary);
  }
  .toolbar p {
    margin: 0;
    font: var(--text-caption);
  }
  .filters,
  .selection-bar {
    margin-bottom: 12px;
  }
  .selection-bar {
    gap: 6px 12px;
    color: var(--color-text-secondary);
    font-size: 12px;
  }
  .check-all {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
  }
  .check-all input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent-default);
  }
  .search {
    position: relative;
    flex: 1;
    max-width: 360px;
    min-width: 0;
  }
  .search input {
    width: 100%;
  }
  .search :global(svg) {
    display: none;
  }
  .filters input,
  select {
    padding: 8px 10px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  .filters input {
    border: 0;
    background: var(--color-bg-subtle);
  }
  .table-scroll {
    overflow: auto;
    max-height: 60vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
  }
  th,
  .table-scroll td {
    padding: 8px;
    border-bottom: 1px solid var(--color-border-default);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th {
    color: var(--color-text-secondary);
    font-weight: 500;
    background: var(--color-bg-subtle);
  }
  .table-scroll th {
    position: sticky;
    top: 0;
  }
  .material-list {
    table-layout: fixed;
    margin-bottom: 12px;
  }
  .pick-col {
    width: 32px;
  }
  .description-col {
    width: 19%;
  }
  .quantity-col {
    width: 126px;
  }
  .status-col {
    width: 116px;
  }
  .date-col {
    width: 126px;
  }
  .wo-col {
    width: 112px;
  }
  .error {
    color: var(--color-danger-default);
    font-size: 12px;
  }
  @media (max-width: 1100px) {
    .material-list {
      --material-gutter: 24px;
      width: calc(100% + var(--material-gutter) * 2);
      margin-inline: calc(-1 * var(--material-gutter));
      border-top: 1px solid var(--color-border-default);
    }
    .material-list,
    .material-list tbody {
      display: grid;
    }
    .material-list thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .unlink {
      min-width: 44px;
      min-height: 44px;
    }
    .wo-links .attach-label {
      display: inline;
      border: 0;
      padding: 0;
    }
  }
  @media (max-width: 767px) {
    .materials {
      padding: 16px;
    }
    .material-list {
      --material-gutter: 16px;
    }
    .toolbar {
      margin-bottom: 10px;
    }
    .heading {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .heading h2 {
      margin: 0;
    }
    .project-caption {
      display: none;
    }
    .filters {
      flex-wrap: nowrap;
      margin-bottom: 4px;
    }
    .filters select {
      max-width: 50%;
      padding-inline: 6px;
    }
    .search :global(svg) {
      display: block;
      position: absolute;
      inset: 50% auto auto 10px;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--color-icon-default);
    }
    .search input {
      padding-inline-start: 34px;
    }
    .selection-bar {
      margin-bottom: 4px;
    }
    .check-all {
      min-height: 44px;
    }
    .filters input,
    select {
      min-height: 44px;
    }
    .filters input {
      font-size: 16px;
    }
    select {
      font: var(--text-body-14);
    }
  }
</style>
