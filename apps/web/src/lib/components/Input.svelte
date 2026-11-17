<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label: string;
    value?: string;
    error?: string | null;
    hint?: string;
    id?: string;
  }
  let {
    label,
    value = $bindable(''),
    error = null,
    hint,
    id = `in-${Math.random().toString(36).slice(2, 8)}`,
    ...rest
  }: Props = $props();
</script>

<div class="field" class:err={!!error}>
  <label for={id}>{label}</label>
  <input
    {id}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error || hint ? `${id}-msg` : undefined}
    {...rest}
  />
  {#if error}
    <span class="msg error" id="{id}-msg" role="alert">{error}</span>
  {:else if hint}
    <span class="msg" id="{id}-msg">{hint}</span>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  label {
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  input {
    height: 32px;
    width: 100%;
    padding: 0 12px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    outline: none;
    transition:
      border-color var(--dur),
      box-shadow var(--dur);
  }
  input::placeholder {
    color: var(--color-text-tertiary);
  }
  input:focus {
    border-color: var(--color-accent-default);
    box-shadow: 0 0 0 3px var(--color-accent-subtle);
  }
  input:disabled {
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
  }
  .err input {
    border-color: var(--color-danger-default);
  }
  .err input:focus {
    box-shadow: 0 0 0 3px var(--color-danger-subtle);
  }
  .msg {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
  .msg.error {
    color: var(--color-danger-default);
  }
  @media (max-width: 767px) {
    input {
      height: 44px;
      font-size: 16px;
    }
  }
</style>
