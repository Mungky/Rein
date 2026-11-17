<script lang="ts">
  import { WO_CATEGORY_META } from '@rein/shared';
  import type { CategorySummary } from '$lib/types';
  import { onMount } from 'svelte';

  /**
   * Bar kategori di header project (PRD §8.4, §9.9): lebar segmen = porsi bobot kategori,
   * isi = progres kategori. Warna kategori hanya di bar ini (bukan teks/latar besar).
   */
  let { categories }: { categories: CategorySummary[] } = $props();
  let ready = $state(false);
  onMount(() => requestAnimationFrame(() => (ready = true)));
</script>

<div class="cats">
  <div class="bar" role="img" aria-label="Progres per kategori">
    {#each categories as c (c.category)}
      <span
        style:flex-grow={Math.max(c.share, 0.02)}
        style:--c={`var(${WO_CATEGORY_META[c.category].token})`}
      >
        <i style:width={ready ? `${c.progress}%` : '0%'}></i>
      </span>
    {/each}
  </div>
  <ul>
    {#each categories as c (c.category)}
      <li>
        <span class="dot" style:--c={`var(${WO_CATEGORY_META[c.category].token})`}></span>
        {WO_CATEGORY_META[c.category].label}
        <b class="tnum">{Math.round(c.progress)}%</b>
        <span class="faint tnum">{c.done}/{c.total}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .cats {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
  }
  .bar span {
    position: relative;
    flex-basis: 0;
    min-width: 4px;
    background: color-mix(in srgb, var(--c) 22%, var(--color-bg-hover));
  }
  .bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--c);
    transition: width 0.7s var(--ease);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    font: var(--text-caption);
    color: var(--color-text-secondary);
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  li b {
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
</style>
