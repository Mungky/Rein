<script lang="ts">
  import {
    MATERIAL_STATUS_LABEL,
    materialFieldsSchema,
    type MaterialInput,
    type MaterialStatus,
  } from '@rein/shared';
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { shortDate } from '$lib/format';
  import { materialPreview, type MaterialPreview } from '$lib/material-import';
  import { onLive } from '$lib/live.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { MaterialRow } from '$lib/types';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Modal from './Modal.svelte';

  let { projectId }: { projectId: string } = $props();
  let rows = $state<MaterialRow[]>([]);
  let canManage = $state(false);
  let loading = $state(true);
  let loadError = $state('');
  let busy = $state(false);
  let query = $state('');
  let filter = $state<MaterialStatus | ''>('');
  let formOpen = $state(false);
  let selected = $state<MaterialRow | null>(null);
  const empty = () => ({
    partNo: '',
    description: '',
    material: '',
    specification: '',
    quantity: '',
    unit: '',
    status: 'not_available' as MaterialStatus,
    receivedAt: '',
    note: '',
  });
  let form = $state(empty());
  let formId = crypto.randomUUID();
  let error = $state('');
  let picker = $state<HTMLInputElement>();
  let preview = $state<MaterialPreview | null>(null);
  let previewOpen = $state(false);
  let importRows = $state<Array<MaterialInput & { clientId: string }>>([]);
  let sourceName = $state('');
  const filtered = $derived(
    rows.filter(
      (r) =>
        (!filter || r.status === filter) &&
        `${r.partNo} ${r.description} ${r.material} ${r.specification}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  );

  async function load() {
    try {
      const result = await api<{ materials: MaterialRow[]; canManage: boolean }>(
        `/api/projects/${projectId}/materials`,
      );
      rows = result.materials.sort((a, b) =>
        a.partNo.localeCompare(b.partNo, 'id', { numeric: true }),
      );
      canManage = result.canManage;
      loadError = '';
    } catch (err) {
      loadError = err instanceof ApiError ? err.message : 'Material gagal dimuat';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void projectId;
    void load();
  });
  const off = onLive((e) => {
    if (e.type === 'project' && e.projectId === projectId) void load();
  });
  onDestroy(off);
  function edit(row: MaterialRow | null) {
    selected = row;
    formId = crypto.randomUUID();
    error = '';
    form = row
      ? {
          partNo: row.partNo,
          description: row.description,
          material: row.material,
          specification: row.specification,
          quantity: String(row.quantity),
          unit: row.unit,
          status: row.status,
          receivedAt: row.receivedAt ?? '',
          note: row.note,
        }
      : empty();
    formOpen = true;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = materialFieldsSchema.safeParse({
      ...form,
      quantity: Number(form.quantity.replace(',', '.')),
      receivedAt: form.receivedAt || null,
    });
    if (!parsed.success) {
      error = parsed.error.issues.map((i) => i.message).join('. ');
      return;
    }
    busy = true;
    error = '';
    try {
      if (selected)
        await api(`/api/projects/${projectId}/materials/${selected.id}`, {
          method: 'PATCH',
          body: { ...parsed.data, expectedUpdatedAt: selected.updatedAt },
        });
      else
        await api(`/api/projects/${projectId}/materials`, {
          body: { rows: [{ ...parsed.data, clientId: formId }] },
        });
      formOpen = false;
      toast('Material disimpan');
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Material gagal disimpan';
    } finally {
      busy = false;
    }
  }
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
      await api(`/api/projects/${projectId}/materials`, { body: { rows: importRows } });
      previewOpen = false;
      toast(`${importRows.length} material diimpor`);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impor gagal', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
</script>

<section class="materials" aria-label="Material project">
  <div class="toolbar">
    <div>
      <h2>Material</h2>
      <p>{rows.length} item untuk kebutuhan project ini</p>
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
        <Button icon="plus" variant="primary" disabled={busy} onclick={() => edit(null)}
          >Tambah material</Button
        >
      </div>{/if}
  </div>
  <div class="filters">
    <input
      type="search"
      aria-label="Cari material"
      placeholder="Cari Part No., description, material…"
      bind:value={query}
    />
    <select aria-label="Filter status material" bind:value={filter}
      ><option value="">Semua status</option
      >{#each Object.entries(MATERIAL_STATUS_LABEL) as [value, label] (value)}<option {value}
          >{label}</option
        >{/each}</select
    >
  </div>
  {#if loadError}<p role="alert">{loadError}</p>
    <Button onclick={load}>Coba lagi</Button>
  {:else if loading}<p class="muted">Memuat material…</p>
  {:else if !rows.length}<div class="empty">
      <h3>Belum ada material</h3>
      <p>Tambahkan manual atau impor material list dari Excel.</p>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal scrolling.) -->
    <div class="table-scroll" tabindex="0" role="region" aria-label="Daftar material">
      <table>
        <thead
          ><tr
            ><th>Part No.</th><th>Description</th><th>Material</th><th>Size or Specification</th><th
              >QTY</th
            ><th>Status</th><th>Diterima</th><th>Note</th>{#if canManage}<th>Aksi</th>{/if}</tr
          ></thead
        >
        <tbody
          >{#each filtered as row (row.id)}<tr
              ><td>{row.partNo || '—'}</td><td>{row.description}</td><td>{row.material || '—'}</td
              ><td>{row.specification || '—'}</td><td class="qty"
                >{row.quantity.toLocaleString('id-ID')} {row.unit}</td
              ><td><span class="badge">{MATERIAL_STATUS_LABEL[row.status]}</span></td><td
                >{row.receivedAt ? shortDate(row.receivedAt) : '—'}</td
              ><td>{row.note || '—'}</td>{#if canManage}<td
                  ><Button size="sm" variant="ghost" onclick={() => edit(row)}>Ubah</Button></td
                >{/if}</tr
            >{:else}<tr><td colspan={canManage ? 9 : 8}>Tidak ada material yang cocok.</td></tr
            >{/each}</tbody
        >
      </table>
    </div>
  {/if}
</section>

<Modal bind:open={formOpen} title={selected ? 'Ubah material' : 'Tambah material'} width={640}>
  <form id="material-form" onsubmit={save} class="form">
    <Input label="Part No." bind:value={form.partNo} maxlength={120} />
    <Input label="Description" bind:value={form.description} required maxlength={500} />
    <Input label="Material" bind:value={form.material} maxlength={200} />
    <Input label="Size or Specification" bind:value={form.specification} maxlength={500} />
    <div class="columns">
      <Input
        label="QTY"
        inputmode="decimal"
        bind:value={form.quantity}
        required
        placeholder="Contoh: 4"
      /><Input
        label="Satuan"
        bind:value={form.unit}
        required
        maxlength={30}
        placeholder="Pcs, Btg, Lbr…"
      />
    </div>
    <div class="columns">
      <Field label="Status" id="material-status"
        ><select id="material-status" bind:value={form.status}
          >{#each Object.entries(MATERIAL_STATUS_LABEL) as [value, label] (value)}<option {value}
              >{label}</option
            >{/each}</select
        ></Field
      >
      <Input label="Tanggal diterima (opsional)" type="date" bind:value={form.receivedAt} />
    </div>
    <Field label="Note (opsional)" id="material-note"
      ><textarea id="material-note" rows="3" maxlength="2000" bind:value={form.note}
      ></textarea></Field
    >
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}<Button disabled={busy} onclick={() => (formOpen = false)}>Batal</Button
    ><Button variant="primary" type="submit" form="material-form" loading={busy}>Simpan</Button
    >{/snippet}
</Modal>

<Modal bind:open={previewOpen} title="Pratinjau impor material" width={1000}>
  {#if preview}
    <p>{sourceName} · {preview.rows.length} material · {preview.sheets.join(', ')}</p>
    <p class="muted">
      Impor menambahkan baris baru. Material yang sudah ada tetap tersimpan. Periksa daftar sebelum
      mengimpor ulang file yang sama.
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
            ><th>Part No.</th><th>Description</th><th>Material</th><th>Size or Specification</th><th
              >QTY</th
            ><th>Status</th><th>Diterima</th><th>Note</th></tr
          ></thead
        ><tbody
          >{#each preview.rows as row, i (i)}<tr
              ><td>{row.partNo}</td><td>{row.description}</td><td>{row.material}</td><td
                >{row.specification}</td
              ><td class="qty">{row.quantity} {row.unit}</td><td
                >{MATERIAL_STATUS_LABEL[row.status]}</td
              ><td>{row.receivedAt || '—'}</td><td>{row.note || '—'}</td></tr
            >{/each}</tbody
        >
      </table>
    </div>
  {/if}
  {#snippet footer()}<Button disabled={busy} onclick={() => (previewOpen = false)}>Batal</Button
    ><Button
      variant="primary"
      loading={busy}
      disabled={!preview || !!preview.errors.length || !preview.rows.length}
      onclick={importMaterials}>Impor {preview?.rows.length ?? 0} material</Button
    >{/snippet}
</Modal>

<style>
  .materials {
    padding: 24px 32px;
  }
  .toolbar,
  .actions,
  .filters {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .toolbar {
    justify-content: space-between;
    margin-bottom: 20px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 4px;
  }
  p {
    margin: 0 0 12px;
    line-height: 1.6;
  }
  .toolbar p,
  .muted,
  .empty {
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  .filters {
    margin-bottom: 16px;
  }
  .filters input {
    width: min(100%, 360px);
  }
  input,
  select,
  textarea {
    padding: 8px 10px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  .form {
    display: grid;
    gap: 16px;
  }
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
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
  th {
    color: var(--color-text-secondary);
    font-weight: 500;
    background: var(--color-bg-subtle);
    position: sticky;
    top: 0;
    white-space: nowrap;
  }
  td,
  th {
    padding: 12px;
    border-bottom: 1px solid var(--color-border-default);
    vertical-align: top;
  }
  td {
    min-width: 90px;
    max-width: 300px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .qty {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .badge {
    display: inline-block;
    white-space: nowrap;
    padding: 3px 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
  }
  .empty {
    text-align: center;
    padding: 48px 16px;
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .error {
    color: var(--color-danger-default);
    font-size: 12px;
  }
  @media (max-width: 767px) {
    .materials {
      padding: 16px;
    }
    .columns {
      grid-template-columns: 1fr;
    }
    .filters input {
      width: 100%;
    }
    .actions {
      width: 100%;
    }
    input,
    select {
      min-height: 44px;
      font-size: 16px;
    }
  }
</style>
