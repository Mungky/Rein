<script lang="ts">
  import { MATERIAL_STATUS_LABEL, materialFieldsSchema, type MaterialInput } from '@rein/shared';
  import { tick, type Snippet } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { shortDate } from '$lib/format';
  import type { MaterialRow } from '$lib/types';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let {
    row,
    endpoint,
    editable,
    busy,
    checked,
    onselect,
    onupdated,
    oncreated,
    onreload,
    links,
  }: {
    row?: MaterialRow;
    endpoint: string;
    editable: boolean;
    busy: boolean;
    checked?: boolean;
    onselect?: (checked: boolean) => void;
    onupdated?: (row: MaterialInput & { id: string; updatedAt: string }) => void;
    oncreated?: () => void;
    onreload?: () => Promise<boolean>;
    links?: Snippet;
  } = $props();

  function fields(item?: MaterialRow) {
    return {
      partNo: item?.partNo ?? '',
      description: item?.description ?? '',
      material: item?.material ?? '',
      specification: item?.specification ?? '',
      quantity: item ? String(item.quantity) : '',
      unit: item?.unit ?? '',
      status: item?.status ?? 'not_available',
      receivedAt: item?.status === 'po' ? (item.receivedAt ?? '') : '',
      note: item?.note ?? '',
    };
  }
  type Draft = ReturnType<typeof fields>;
  let draft = $state<Draft | null>(null);
  let initial = $state('');
  let expectedUpdatedAt = '';
  let clientId = crypto.randomUUID();
  let pending = $state<MaterialInput | null>(null);
  let saving = $state(false);
  let error = $state('');
  let stale = $state(false);
  let expanded = $state(false);
  let summaryButton: HTMLButtonElement | undefined;
  let editButton = $state<HTMLButtonElement>();
  const editing = $derived(editable && (!row || draft !== null));
  const values = $derived(draft ?? fields(row));
  const dirty = $derived(draft !== null && JSON.stringify(draft) !== initial);

  function startEdit() {
    draft = fields(row);
    initial = JSON.stringify(draft);
    expectedUpdatedAt = row?.updatedAt ?? '';
  }

  function discard() {
    draft = null;
    stale = false;
    error = '';
  }

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (!editing || saving) return;
    if (!draft) startEdit();
    if (!draft) return;
    draft[key] = value;
    if (key === 'status' && value !== 'po') draft.receivedAt = '';
    if (!stale) error = '';
  }

  function review() {
    if (!draft || !dirty || !editing || busy || saving || stale || pending) return;
    const parsed = materialFieldsSchema.safeParse({
      ...draft,
      quantity: Number(draft.quantity.replace(',', '.')),
      receivedAt: draft.receivedAt || null,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      error =
        issue?.path[0] === 'quantity'
          ? 'Jumlah harus positif, maksimal 999.999.999 dengan tiga desimal.'
          : (issue?.message ?? 'Periksa kembali isian material.');
      return;
    }
    pending = parsed.data;
    error = '';
  }

  async function save() {
    if (!pending || !editing || busy || saving || stale) return;
    const payload = $state.snapshot(pending);
    saving = true;
    try {
      if (row) {
        const updated = await api<MaterialInput & { id: string; updatedAt: string }>(
          endpoint + '/' + row.id,
          { method: 'PATCH', body: { ...payload, expectedUpdatedAt } },
        );
        onupdated?.(updated);
      } else {
        const result = await api<{ skipped: number }>(endpoint, {
          body: { rows: [{ ...payload, clientId }] },
        });
        if (result.skipped) {
          error = 'Material yang sama sudah ada. Ubah item tersebut untuk memperbarui datanya.';
          return;
        }
        clientId = crypto.randomUUID();
        oncreated?.();
        expanded = false;
      }
      discard();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Material gagal disimpan';
      stale = err instanceof ApiError && err.code === 'STALE';
      return;
    } finally {
      pending = null;
      saving = false;
    }
    await tick();
    (row ? editButton : summaryButton)?.focus();
  }

  function enter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    review();
  }

  async function reloadRow() {
    if (!(await onreload?.())) return;
    discard();
  }

  async function toggleDetails() {
    expanded = !expanded;
    if (expanded) {
      await tick();
      summaryButton?.closest('tr')?.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

{#snippet textField(
  key: 'description' | 'material' | 'specification' | 'quantity' | 'unit',
  label: string,
  max: number,
)}
  <label class="field">
    <span>{label}</span>
    <input
      value={values[key]}
      placeholder={!row && key === 'description' ? 'Material baru' : label}
      maxlength={max}
      inputmode={key === 'quantity' ? 'decimal' : undefined}
      disabled={busy || saving}
      oninput={(e) => edit(key, e.currentTarget.value)}
      onkeydown={enter}
    />
  </label>
{/snippet}

<!-- svelte-ignore a11y_no_redundant_roles (Safari needs the table role when the row is a grid.) -->
<tr
  class:new-row={!row}
  class:expanded
  class:read-only={!editable}
  class:checked
  class:editing
  role="row"
>
  {#if editable}
    <td class="selection" role="cell">
      {#if row}
        <label class="check">
          <input
            type="checkbox"
            aria-label={'Pilih ' + row.description}
            {checked}
            disabled={busy}
            onchange={(e) => onselect?.(e.currentTarget.checked)}
          />
        </label>
      {/if}
    </td>
  {/if}
  <td class="summary" role="cell">
    <button
      type="button"
      class="summary-button"
      bind:this={summaryButton}
      aria-expanded={expanded}
      onclick={toggleDetails}
    >
      {#if row}
        <span class="summary-content">
          <b>{row.description}</b>
          <span class="summary-meta">
            <span class="tnum">{row.quantity.toLocaleString('id-ID')} {row.unit}</span>
            <span class="summary-status">{MATERIAL_STATUS_LABEL[row.status]}</span>
            {#if row.status === 'po' && row.receivedAt}
              <span class="summary-date"
                ><Icon name="calendar" size={12} />Diterima {shortDate(row.receivedAt)}</span
              >
            {/if}
          </span>
          {#if !expanded && (error || dirty)}
            <span class="row-error"
              >{error ? 'Periksa perubahan material' : 'Perubahan belum tersimpan'}</span
            >
          {/if}
        </span>
      {:else}
        <span class="add-label"
          ><Icon name="plus" size={16} />{dirty ? 'Lanjutkan material baru' : 'Material baru'}</span
        >
      {/if}
      <span class="summary-chevron"><Icon name="chevron-down" size={16} /></span>
    </button>
  </td>
  <td class="description" role="cell">
    <div class="description-content">
      {#if row && editable}
        <button
          class="edit-toggle"
          type="button"
          bind:this={editButton}
          disabled={busy || saving}
          onclick={() => (editing ? discard() : startEdit())}
        >
          {#if !editing}<Icon name="edit" size={14} />{/if}
          {editing ? 'Batal' : 'Ubah'}
        </button>
      {/if}
      {#if editing}{@render textField('description', 'Deskripsi', 500)}
      {:else}<b>{values.description}</b>{/if}
    </div>
    {#if saving}<small role="status">Menyimpan…</small>{/if}
    {#if error}
      <small role="alert">{error}</small>
      {#if stale}<Button size="sm" onclick={reloadRow}>Muat ulang baris</Button>{/if}
    {/if}
    {#if pending}
      <Modal
        open
        title={row ? 'Simpan perubahan material?' : 'Tambah material ini?'}
        width={440}
        onclose={() => (pending = null)}
      >
        <p class="confirm-copy">Periksa kembali sebelum menyimpan <b>{pending?.description}</b>.</p>
        {#snippet footer()}
          <Button disabled={saving} onclick={() => (pending = null)}>Kembali</Button>
          <Button variant="primary" loading={saving} disabled={busy} onclick={save}
            >Ya, simpan</Button
          >
        {/snippet}
      </Modal>
    {/if}
  </td>
  <td role="cell">
    {#if editing}{@render textField('material', 'Material', 200)}
    {:else}<span class="label">Material</span>{values.material || '—'}{/if}
  </td>
  <td role="cell">
    {#if editing}{@render textField('specification', 'Spesifikasi', 500)}
    {:else}<span class="label">Spesifikasi</span>{values.specification || '—'}{/if}
  </td>
  <td role="cell">
    {#if editing}
      <div class="quantity">
        {@render textField('quantity', 'Jumlah', 14)}
        {@render textField('unit', 'Satuan', 30)}
      </div>
    {:else}
      <span class="label">Jumlah</span>{row?.quantity.toLocaleString('id-ID')} {values.unit}
    {/if}
  </td>
  <td role="cell">
    {#if editing}
      <label class="field">
        <span>Status</span>
        <select
          value={values.status}
          disabled={busy || saving}
          onchange={(e) => edit('status', e.currentTarget.value as MaterialInput['status'])}
        >
          {#each Object.entries(MATERIAL_STATUS_LABEL) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
    {:else}<span class="label">Status</span>{MATERIAL_STATUS_LABEL[values.status]}{/if}
  </td>
  <td class="received" class:empty-date={values.status !== 'po'} role="cell">
    {#if values.status === 'po'}
      {#if editing}
        <label class="field">
          <span>Diterima</span>
          <input
            type="date"
            value={values.receivedAt}
            disabled={busy || saving}
            oninput={(e) => edit('receivedAt', e.currentTarget.value)}
          />
        </label>
      {:else}<span class="label">Diterima</span>{values.receivedAt
          ? shortDate(values.receivedAt)
          : '—'}{/if}
    {/if}
  </td>
  <td class="notes" role="cell">
    {#if editing}
      <label class="field">
        <span>Catatan</span>
        <textarea
          rows="1"
          maxlength="2000"
          value={values.note}
          placeholder="Catatan"
          disabled={busy || saving}
          oninput={(e) => edit('note', e.currentTarget.value)}></textarea>
      </label>
    {:else}<span class="label">Catatan</span>{values.note || '—'}{/if}
  </td>
  <td class="links" role="cell">
    {#if row}
      <span class="label">Work Order</span>
      {@render links?.()}
    {/if}
    {#if editing}
      <div class="save-action">
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || busy || stale}
          loading={saving}
          aria-haspopup="dialog"
          onclick={review}>Simpan</Button
        >
      </div>
    {/if}
  </td>
</tr>

<style>
  td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--color-border-default);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .editing td {
    background: var(--color-bg-subtle);
  }
  .description-content {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .description-content .field {
    flex: 1;
  }
  .description-content b {
    min-width: 0;
  }
  .edit-toggle {
    order: 1;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 0 4px;
    color: var(--color-accent-default);
    font: var(--text-label);
  }
  .save-action {
    margin-top: 4px;
  }
  .confirm-copy {
    font: var(--text-body-14);
  }
  .field {
    display: grid;
    min-width: 0;
  }
  .field span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .label,
  .summary {
    display: none;
  }
  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    min-width: 0;
    min-height: 32px;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font: inherit;
  }
  select {
    border: 1px solid var(--color-border-default);
  }
  textarea {
    resize: vertical;
  }
  .quantity {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }
  .check {
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 32px;
    cursor: pointer;
  }
  .check input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent-default);
  }
  small {
    display: block;
    margin-top: 4px;
    color: var(--color-text-secondary);
    font: var(--text-caption);
  }
  @media (max-width: 1100px) {
    tr {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      column-gap: 12px;
      padding: 0 var(--material-gutter);
      border-bottom: 1px solid var(--color-border-default);
    }
    tr.checked {
      background: var(--color-accent-subtle);
    }
    tr.expanded {
      row-gap: 10px;
      padding-bottom: 12px;
      background: var(--color-bg-subtle);
    }
    tr:not(.expanded) td:not(.summary, .selection),
    .new-row .selection,
    .read-only .description,
    .empty-date {
      display: none;
    }
    td {
      min-width: 0;
      padding: 0;
      border: 0;
    }
    .editing td {
      background: none;
    }
    .description-content b {
      display: none;
    }
    .description-content {
      justify-content: flex-end;
      gap: 8px;
    }
    .edit-toggle {
      min-height: 44px;
      padding-inline: 8px;
    }
    .save-action {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .selection {
      grid-area: 1 / 1 / 2 / 2;
      width: 44px;
      align-self: center;
      z-index: 1;
    }
    .summary {
      display: block;
      grid-area: 1 / 1 / 2 / -1;
    }
    tr:not(.read-only, .new-row) .summary {
      padding-inline-start: 44px;
    }
    .expanded .summary {
      border-bottom: 1px solid var(--color-border-default);
    }
    .summary-button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      min-height: 64px;
      padding: 10px 0;
      color: var(--color-text-primary);
      text-align: start;
    }
    .summary-content {
      display: grid;
      min-width: 0;
      gap: 4px;
    }
    .summary-content b {
      font: var(--text-body-14);
      font-weight: 500;
    }
    .summary-meta,
    .summary-date,
    .add-label {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .summary-meta {
      flex-wrap: wrap;
      font: var(--text-caption);
      color: var(--color-text-secondary);
    }
    .summary-status {
      padding: 1px 6px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-sm);
    }
    .summary-date :global(svg),
    .summary-chevron {
      flex: none;
    }
    .summary-chevron {
      color: var(--color-icon-default);
      transition: transform 0.2s var(--ease);
    }
    .summary-button[aria-expanded='true'] .summary-chevron {
      transform: rotate(180deg);
    }
    .new-row .summary-button {
      min-height: 44px;
    }
    .add-label {
      color: var(--color-accent-default);
      font: var(--text-label);
    }
    .row-error {
      color: var(--color-text-secondary);
      font: var(--text-caption);
    }
    .quantity {
      gap: 6px;
    }
    .description,
    .notes,
    .links,
    .received {
      grid-column: 1 / -1;
    }
    .field span,
    .label {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip-path: none;
      display: block;
      margin-bottom: 3px;
      color: var(--color-text-secondary);
      font: var(--text-caption);
    }
    .check,
    input:not([type='checkbox']),
    textarea,
    select {
      min-height: 44px;
    }
    input:not([type='checkbox']),
    textarea {
      font-size: 16px;
    }
    select {
      font: var(--text-body-14);
    }
  }
</style>
