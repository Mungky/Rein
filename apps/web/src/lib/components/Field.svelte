<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Label + pesan error/hint untuk kontrol yang bukan <Input> (select, textarea, dsb.). */
  interface Props {
    label: string;
    id: string;
    error?: string | null;
    hint?: string;
    children: Snippet;
  }
  let { label, id, error = null, hint, children }: Props = $props();
</script>

<div class="f" class:err={!!error}>
  <label for={id}>{label}</label>
  {@render children()}
  {#if error}<p class="msg" role="alert">{error}</p>{:else if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  label {
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .f :global(select),
  .f :global(textarea) {
    width: 100%;
    min-height: 36px;
    padding: 7px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: var(--text-body-14);
    outline: none;
    transition:
      border-color var(--dur),
      box-shadow var(--dur);
  }
  .f :global(textarea) {
    resize: vertical;
    min-height: 88px;
  }
  .f :global(select:focus),
  .f :global(textarea:focus) {
    border-color: var(--color-accent-default);
    box-shadow: 0 0 0 3px var(--color-accent-subtle);
  }
  .err :global(select),
  .err :global(textarea) {
    border-color: var(--color-danger-default);
  }
  .msg {
    font: var(--text-caption);
    color: var(--color-danger-default);
  }
  .hint {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
</style>
