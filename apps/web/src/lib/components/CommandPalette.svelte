<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import type { PaletteItem } from '$lib/nav';
  import { dur, easeOut } from '$lib/motion';
  import Icon from './Icon.svelte';
  import Kbd from './Kbd.svelte';

  /**
   * Shell command palette (FR-073 — pencarian server menyusul di M2).
   * M0: daftar aksi statis, filter teks, navigasi ↑↓ / Enter / Esc, highlight bergeser.
   */
  interface Props {
    open?: boolean;
    items: PaletteItem[];
  }
  let { open = $bindable(false), items }: Props = $props();

  let query = $state('');
  let index = $state(0);
  let input = $state<HTMLInputElement>();

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((i) => `${i.label} ${i.hint ?? ''} ${i.group}`.toLowerCase().includes(q))
      : items;
  });
  const groups = $derived.by(() => {
    const out: Array<[string, Array<PaletteItem & { n: number }>]> = [];
    filtered.forEach((it, n) => {
      let g = out.find(([name]) => name === it.group);
      if (!g) {
        g = [it.group, []];
        out.push(g);
      }
      g[1].push({ ...it, n });
    });
    return out;
  });

  $effect(() => {
    if (open) {
      const trigger = document.activeElement as HTMLElement | null;
      query = '';
      index = 0;
      return () => trigger?.focus();
    }
  });
  $effect(() => {
    if (index >= filtered.length) index = Math.max(0, filtered.length - 1);
  });
  $effect(() => {
    if (open && input) input.focus();
  });

  function run(it: PaletteItem | undefined) {
    if (!it) return;
    open = false;
    it.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      input?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = filtered.length ? (index + 1) % filtered.length : 0;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = filtered.length ? (index - 1 + filtered.length) % filtered.length : 0;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
    }
  }

  function trapFocus(e: FocusEvent) {
    if (open && input && e.target instanceof Node && !input.closest('.pal')?.contains(e.target))
      input.focus();
  }

  let listEl = $state<HTMLElement>();
  let hlTop = $state(0);
  $effect(() => {
    const el = listEl?.querySelector<HTMLElement>(`[data-n="${index}"]`);
    if (el) {
      hlTop = el.offsetTop;
      el.scrollIntoView({ block: 'nearest' });
    }
  });
</script>

<svelte:window {onkeydown} onfocusin={trapFocus} />

{#if open}
  <div
    class="scrim"
    role="presentation"
    transition:fade={{ duration: dur(140) }}
    onclick={(e) => e.target === e.currentTarget && (open = false)}
  >
    <div
      class="pal"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
      transition:scale={{ start: 0.98, duration: dur(140), easing: easeOut }}
    >
      <div class="pal-in">
        <Icon name="search" />
        <input
          bind:this={input}
          bind:value={query}
          aria-label="Cari atau ketik perintah"
          placeholder="Cari atau ketik perintah…"
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={filtered[index] ? `pal-${filtered[index]?.id}` : undefined}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div class="pal-list" id="pal-list" role="listbox" bind:this={listEl}>
        {#if filtered.length}
          <span class="pal-hl" style:top="{hlTop}px" aria-hidden="true"></span>
        {/if}
        {#each groups as [group, list] (group)}
          <div class="pal-g">{group}</div>
          {#each list as it (it.id)}
            <button
              class="pal-i"
              id="pal-{it.id}"
              role="option"
              tabindex="-1"
              aria-selected={it.n === index}
              data-n={it.n}
              onmousemove={() => (index = it.n)}
              onclick={() => run(it)}
            >
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {#if it.hint}<small>{it.hint}</small>{/if}
              {#if it.kbd}<Kbd>{it.kbd}</Kbd>{/if}
            </button>
          {/each}
        {:else}
          <div class="pal-empty">Tidak ada hasil untuk “{query}”</div>
        {/each}
      </div>
      <div class="pal-f">
        <span><Kbd>↑↓</Kbd> pilih</span><span><Kbd>Enter</Kbd> jalankan</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 96px 16px 16px;
    background: var(--color-scrim);
  }
  .pal {
    width: min(620px, 100%);
    overflow: hidden;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-2);
  }
  .pal-in {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border-default);
    color: var(--color-icon-default);
  }
  .pal-in input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .pal-list {
    position: relative;
    max-height: min(380px, 55vh);
    overflow: auto;
    padding: 6px;
  }
  .pal-g {
    padding: 8px 10px 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-tertiary);
  }
  .pal-i {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    text-align: left;
  }
  .pal-i span {
    flex: none;
    max-width: 60%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pal-i small {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pal-i :global(kbd) {
    margin-left: auto;
  }
  .pal-hl {
    position: absolute;
    left: 6px;
    right: 6px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--color-bg-hover);
    transition: top 0.12s var(--ease);
  }
  .pal-empty {
    padding: 24px;
    text-align: center;
    color: var(--color-text-tertiary);
  }
  .pal-f {
    display: flex;
    gap: 16px;
    padding: 8px 16px;
    border-top: 1px solid var(--color-border-default);
    background: var(--color-bg-subtle);
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .pal-f span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  @media (max-width: 767px) {
    .scrim {
      align-items: flex-end;
      padding: 0 12px calc(12px + env(safe-area-inset-bottom, 0px));
    }
    .pal-f {
      display: none;
    }
  }
</style>
