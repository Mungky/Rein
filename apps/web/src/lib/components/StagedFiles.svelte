<script lang="ts">
  import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_ENTRY } from '@rein/shared';
  import { uploadPreparedFile, type Staged } from '$lib/attach';
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
    disabled?: boolean;
    offline?: boolean;
  }
  let {
    userId,
    items = $bindable([]),
    max = MAX_FILES_PER_ENTRY,
    camera = false,
    compact = false,
    disabled = false,
    offline = false,
  }: Props = $props();

  let input: HTMLInputElement;
  let cam: HTMLInputElement | undefined = $state();
  let over = $state(false);
  let skipped = $state<string[]>([]);

  function add(files: FileList | File[]) {
    if (disabled) return;
    const selected = Array.from(files);
    const slots = Math.max(0, max - items.length);
    skipped = selected.slice(slots).map((f) => f.name);
    for (const file of selected.slice(0, slots)) {
      const it: Staged = {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        preview: null,
        progress: 0,
        id: null,
        error: file.size > MAX_ATTACHMENT_BYTES ? 'Melebihi 50 MiB' : null,
      };
      items = [...items, it];
      if (it.error) continue;
      const set = (patch: Partial<Staged>) => {
        items = items.map((x) => (x.key === it.key ? { ...x, ...patch } : x));
      };
      if (offline && !navigator.onLine) {
        set({ offlineFile: file });
        continue;
      }
      uploadPreparedFile(file, { ownerType: 'user', ownerId: userId }, (f) => set({ progress: f }))
        .then((r) => set({ id: r.id, preview: r.preview, progress: 1 }))
        .catch((err: unknown) =>
          set(
            offline && err instanceof ApiError && err.code === 'NETWORK'
              ? { offlineFile: file }
              : { error: err instanceof ApiError ? err.message : 'Gagal mengunggah' },
          ),
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
      aria-disabled={disabled}
      role="button"
      tabindex="0"
      ondragover={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      {ondrop}
      onclick={() => !disabled && input.click()}
      onkeydown={(e) => !disabled && (e.key === 'Enter' || e.key === ' ') && input.click()}
    >
      <Icon name="upload" />
      <span><b>Pilih file</b> atau seret ke sini · foto dikompres otomatis · maks 50 MB/file</span>
    </div>
  {/if}
  <input
    bind:this={input}
    type="file"
    multiple
    {disabled}
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
      {disabled}
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
      <button
        type="button"
        class="ib"
        onclick={() => input.click()}
        aria-label="Lampirkan file"
        {disabled}
      >
        <Icon name="paperclip" />
      </button>
      {#if camera}
        <button
          type="button"
          class="ib"
          onclick={() => cam?.click()}
          aria-label="Ambil foto"
          {disabled}
        >
          <Icon name="camera" />
        </button>
      {/if}
      <span class="faint">Maks. {max} file · 50 MiB/file</span>
    </div>
  {/if}
  {#if skipped.length}
    <p class="file-message" role="alert">
      Batas {max} lampiran. Dilewati ({skipped.length}): {skipped.join(', ')}.
    </p>
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
              {#if it.error}Gagal · {it.error}{:else if it.offlineFile}Siap diantrekan · {formatBytes(
                  it.size,
                )}{:else if !it.id}Mengunggah {Math.round(it.progress * 100)}%{:else}Siap dikirim · {formatBytes(
                  it.size,
                )}{/if}
            </small>
          </span>
          <button
            type="button"
            class="ib"
            onclick={() => remove(it.key)}
            {disabled}
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
  .file-message {
    width: 100%;
    overflow-wrap: anywhere;
    font: var(--text-caption);
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
  @media (max-width: 767px) {
    .ib {
      width: 44px;
      height: 44px;
    }
  }
</style>
