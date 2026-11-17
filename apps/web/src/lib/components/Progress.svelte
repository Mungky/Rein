<script lang="ts">
  import { onMount } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { dur, easeOut } from '$lib/motion';

  /** Bar progres 4 px; isi tumbuh dari 0 saat muncul (prototype .bar, 0,7 s). */
  interface Props {
    value: number;
    showLabel?: boolean;
    width?: number;
  }
  let { value, showLabel = false, width }: Props = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Math.round(value))));
  const shown = new Tween(0, { duration: dur(700), easing: easeOut });
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
  });
  $effect(() => {
    if (mounted) shown.target = clamped;
  });
</script>

<span
  class="prog"
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={clamped}
  aria-label="Progres {clamped}%"
>
  <span class="bar" class:full={clamped >= 100} style:width={width ? `${width}px` : undefined}>
    <i style:width="{shown.current}%"></i>
  </span>
  {#if showLabel}<span class="v tnum">{Math.round(shown.current)}%</span>{/if}
</span>

<style>
  .prog {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  .bar {
    flex: 1;
    min-width: 32px;
    height: 4px;
    border-radius: 2px;
    background: var(--color-bg-hover);
    overflow: hidden;
  }
  .bar[style] {
    flex: none;
  }
  i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--color-accent-default);
  }
  .full i {
    background: var(--color-success-default);
  }
  .v {
    font: var(--text-caption);
    color: var(--color-text-secondary);
    min-width: 32px;
    text-align: right;
  }
</style>
