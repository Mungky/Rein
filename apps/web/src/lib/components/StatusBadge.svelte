<script lang="ts">
  import { WO_STATUS_LABEL, type WoStatus } from '@rein/shared';
  import StatusIcon from './StatusIcon.svelte';

  let { status }: { status: WoStatus } = $props();
</script>

<span class="sb" class:canceled={status === 'canceled'}>
  <StatusIcon {status} />
  <span>{WO_STATUS_LABEL[status]}</span>
</span>

<style>
  .sb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font: var(--text-label);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .canceled span {
    text-decoration: line-through;
    color: var(--color-text-tertiary);
  }
</style>
