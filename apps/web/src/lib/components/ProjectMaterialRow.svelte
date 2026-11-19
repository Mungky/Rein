<script lang="ts">
  import { MATERIAL_STATUS_LABEL, materialFieldsSchema, type MaterialInput } from '@rein/shared';
  import { api, ApiError } from '$lib/api';
  import { shortDate } from '$lib/format';
  import type { MaterialRow } from '$lib/types';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import type { Snippet } from 'svelte';

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
  let expectedUpdatedAt = '';
  let clientId = crypto.randomUUID();
  let editVersion = 0;
  let queued = false;
  let saving = $state(false);
  let error = $state('');
  let stale = $state(false);
  let expanded = $state(false);
  const values = $derived(draft ?? fields(row));

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (!draft) {
      draft = fields(row);
      expectedUpdatedAt = row?.updatedAt ?? '';
    }
    draft[key] = value;
    if (key === 'status' && value !== 'po') draft.receivedAt = '';
    editVersion++;
  }

  async function save() {
    if (!draft || busy || stale) return;
    if (saving) {
      queued = true;
      return;
    }
    if (JSON.stringify(draft) === JSON.stringify(fields(row))) {
      draft = null;
      error = '';
      return;
    }
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
    saving = true;
    error = '';
    const submittedVersion = editVersion;
    try {
      if (row) {
        const updated = await api<MaterialInput & { id: string; updatedAt: string }>(
          endpoint + '/' + row.id,
          { method: 'PATCH', body: { ...parsed.data, expectedUpdatedAt } },
        );
        expectedUpdatedAt = updated.updatedAt;
        onupdated?.(updated);
      } else {
        const result = await api<{ skipped: number }>(endpoint, {
          body: { rows: [{ ...parsed.data, clientId }] },
        });
        if (result.skipped) {
          error = 'Material yang sama sudah ada. Ubah item tersebut untuk memperbarui datanya.';
          return;
        }
        clientId = crypto.randomUUID();
        oncreated?.();
      }
      if (submittedVersion === editVersion) draft = null;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Material gagal disimpan';
      stale = err instanceof ApiError && err.code === 'STALE';
    } finally {
      saving = false;
      if (queued) {
        queued = false;
        if (!error) void save();
      }
    }
  }

  function enter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void save();
  }

  async function reloadRow() {
    if (!(await onreload?.())) return;
    draft = null;
    stale = false;
    error = '';
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
      disabled={busy || (!row && saving)}
      oninput={(e) => edit(key, e.currentTarget.value)}
      onchange={() => row && save()}
      onkeydown={enter}
    />
  </label>
{/snippet}

<!-- svelte-ignore a11y_no_redundant_roles (Safari needs the table role when the row is a grid.) -->
<tr class:new-row={!row} class:expanded class:read-only={!editable} role="row">
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
  <td class="description" role="cell">
    {#if editable}{@render textField('description', 'Deskripsi', 500)}
    {:else}<b>{values.description}</b>{/if}
    {#if saving}<small role="status">Menyimpan…</small>{/if}
    {#if error}
      <small role="alert">{error}</small>
      {#if row}
        {#if stale}
          <Button size="sm" onclick={reloadRow}>Muat ulang baris</Button>
        {:else}
          <Button size="sm" onclick={save}>Coba simpan lagi</Button>
        {/if}
      {/if}
    {/if}
  </td>
  <td class="extra" role="cell">
    {#if editable}{@render textField('material', 'Material', 200)}
    {:else}<span class="label">Material</span>{values.material || '—'}{/if}
  </td>
  <td class="extra" role="cell">
    {#if editable}{@render textField('specification', 'Spesifikasi', 500)}
    {:else}<span class="label">Spesifikasi</span>{values.specification || '—'}{/if}
  </td>
  <td role="cell">
    {#if editable}
      <div class="quantity">
        {@render textField('quantity', 'Jumlah', 14)}
        {@render textField('unit', 'Satuan', 30)}
      </div>
    {:else}
      <span class="label">Jumlah</span>{row?.quantity.toLocaleString('id-ID')} {values.unit}
    {/if}
  </td>
  <td role="cell">
    {#if editable}
      <label class="field">
        <span>Status</span>
        <select
          value={values.status}
          disabled={busy || (!row && saving)}
          onchange={(e) => {
            edit('status', e.currentTarget.value as MaterialInput['status']);
            if (row) void save();
          }}
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
      {#if editable}
        <label class="field">
          <span>Diterima</span>
          <input
            type="date"
            value={values.receivedAt}
            disabled={busy || (!row && saving)}
            oninput={(e) => edit('receivedAt', e.currentTarget.value)}
            onchange={() => row && save()}
          />
        </label>
      {:else}<span class="label">Diterima</span>{values.receivedAt
          ? shortDate(values.receivedAt)
          : '—'}{/if}
    {/if}
  </td>
  <td class="extra notes" role="cell">
    {#if editable}
      <label class="field">
        <span>Catatan</span>
        <textarea
          rows="1"
          maxlength="2000"
          value={values.note}
          placeholder="Catatan"
          disabled={busy || (!row && saving)}
          oninput={(e) => edit('note', e.currentTarget.value)}
          onchange={() => row && save()}></textarea>
      </label>
    {:else}<span class="label">Catatan</span>{values.note || '—'}{/if}
  </td>
  <td class="links" role="cell">
    {#if row}
      <div class="extra">
        <span class="label">Work Order</span>
        {@render links?.()}
      </div>
    {:else}
      <Button size="sm" disabled={!draft || busy} loading={saving} onclick={save}>Simpan</Button>
    {/if}
    <button
      type="button"
      class="details"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class:expanded><Icon name="chevron-down" size={14} /></span>
      {expanded ? 'Tutup rincian' : 'Rincian'}
    </button>
  </td>
</tr>

<style>
  td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--color-border-default);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .new-row td {
    background: var(--color-bg-subtle);
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
  .details {
    display: none;
  }
  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    min-width: 0;
    min-height: 32px;
    padding: 4px 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font: inherit;
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
      gap: 8px 12px;
      padding: 12px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
    }
    td {
      min-width: 0;
      padding: 0;
      border: 0;
    }
    .new-row {
      background: var(--color-bg-subtle);
    }
    .new-row td {
      background: none;
    }
    .selection {
      grid-area: 1 / 1;
      width: 44px;
      z-index: 1;
      align-self: end;
    }
    .description {
      grid-area: 1 / 1 / 2 / -1;
      padding-left: 48px;
    }
    .new-row .description,
    .read-only .description {
      padding-left: 0;
    }
    .quantity {
      gap: 6px;
    }
    .notes,
    .links,
    .received {
      grid-column: 1 / -1;
    }
    .empty-date,
    tr:not(.expanded) .extra {
      display: none;
    }
    .links {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;
    }
    .links .extra {
      flex-basis: 100%;
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
    .details {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
      min-height: 44px;
      padding: 0 8px;
      color: var(--color-text-secondary);
    }
    .details span {
      display: inline-flex;
    }
    .details span.expanded {
      transform: rotate(180deg);
    }
    .check,
    input:not([type='checkbox']),
    textarea,
    select {
      min-height: 44px;
      font-size: 16px;
    }
  }
</style>
