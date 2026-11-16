<script lang="ts">
  import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_ENTRY } from '@rein/shared';
  import { stageFile, type Staged } from '$lib/attach';
  import { formatBytes } from '$lib/format';
  import { ApiError } from '$lib/api';
  import Icon from './Icon.svelte';

  /**
   * Lampiran form (FR-030 AC0, FR-040): pilih/seret file → foto dikompres di klien → diunggah
   * sebagai staging milik user. Parent membaca `items` (id terisi = siap dikirim).
   */
  interface Props {
    userId: string;
    items?: Staged[];
    max?: number;
    camera?: boolean;
    compact?: boolean;
  }
  let {
    userId,
    items = $bindable([]),
    max = MAX_FILES_PER_ENTRY,
    camera = false,
    compact = false,
  }: Props = $props();

  let input: HTMLInputElement;
  let cam: HTMLInputElement | undefined = $state();
  let over = $state(false);

  function add(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (items.length >= max) break;
      const it: Staged = {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        preview: null,
        progress: 0,
        id: null,
        error: file.size > MAX_ATTACHMENT_BYTES ? 'Melebihi 50 MB' : null,
      };
      items = [...items, it];
      if (it.error) continue;
      const set = (patch: Partial<Staged>) => {
        items = items.map((x) => (x.key === it.key ? { ...x, ...patch } : x));
      };
      stageFile(file, userId, (f) => set({ progress: f }))
        .then((r) => set({ id: r.id, preview: r.preview, progress: 1 }))
        .catch((err: unknown) =>
          set({ error: err instanceof ApiError ? err.message : 'Gagal mengunggah' }),
        );
    }
  }

  function remove(key: string) {
    const it = items.find((x) => x.key === key);
    if (it?.preview) URL.revokeObjectURL(it.preview);
    items = items.filter((x) => x.key !== key);
  }

  function ondrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (e.dataTransfer?.files.length) add(e.dataTransfer.files);
  }
</script>

<div class="sf" class:compact>
  {#if !compact}
    <div
      class="drop"
      class:over
      role="button"
      tabindex="0"
      ondragover={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      {ondrop}
      onclick={() => input.click()}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
    >
      <Icon name="upload" />
      <span><b>Pilih file</b> atau seret ke sini · foto dikompres otomatis · maks 50 MB/file</span>
    </div>
  {/if}
  <input
    bind:this={input}
    type="file"
    multiple
    hidden
    onchange={(e) => {
      const t = e.currentTarget;
      if (t.files) add(t.files);
      t.value = '';
    }}
  />
  {#if camera}
    <input
      bind:this={cam}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      onchange={(e) => {
        const t = e.currentTarget;
        if (t.files) add(t.files);
        t.value = '';
      }}
    />
  {/if}
  {#if compact}
    <div class="acts">
      <button type="button" class="ib" onclick={() => input.click()} aria-label="Lampirkan file">
        <Icon name="paperclip" />
      </button>
      {#if camera}
        <button type="button" class="ib" onclick={() => cam?.click()} aria-label="Ambil foto">
          <Icon name="camera" />
        </button>
      {/if}
      <span class="faint">Maks. 50 MB/file</span>
    </div>
  {/if}
  {#if items.length}
    <ul>
      {#each items as it (it.key)}
        <li class:err={!!it.error}>
          {#if it.preview}<img src={it.preview} alt="" width="36" height="36" />{:else}<span
              class="fi"><Icon name="file" /></span
            >{/if}
          <span class="nm">
            <b>{it.name}</b>
            <small>
              {#if it.error}{it.error}{:else if !it.id}Mengunggah {Math.round(
                  it.progress * 100,
                )}%{:else}{formatBytes(it.size)}{/if}
            </small>
          </span>
          <button
            type="button"
            class="ib"
            onclick={() => remove(it.key)}
            aria-label="Hapus lampiran"
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sf {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sf.compact {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .drop {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text-secondary);
    font: var(--text-caption);
    cursor: pointer;
    transition:
      background var(--dur),
      border-color var(--dur);
  }
  .drop b {
    color: var(--color-accent-default);
    font-weight: 500;
  }
  .drop.over,
  .drop:hover {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent-default);
  }
  .acts {
    display: flex;
    gap: 2px;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    width: 100%;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    animation: fade 0.2s var(--ease);
  }
  li img,
  .fi {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--color-bg-subtle);
    display: grid;
    place-items: center;
    color: var(--color-icon-default);
  }
  .nm {
    flex: 1;
    min-width: 0;
  }
  .nm b {
    display: block;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nm small {
    color: var(--color-text-tertiary);
    font-size: 11px;
  }
  li.err small {
    color: var(--color-danger-default);
  }
  .ib {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    color: var(--color-icon-default);
  }
  .ib:hover {
    background: var(--color-bg-hover);
  }
</style>
