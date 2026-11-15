<script lang="ts">
  import Icon from './Icon.svelte';

  /** Merah hanya untuk Urgent, terlambat, dan Butuh bantuan (CLAUDE.md, PRD §9.9). */
  interface Props {
    type: 'urgent' | 'help' | 'late';
    pulse?: boolean;
  }
  let { type, pulse = false }: Props = $props();

  const META = {
    urgent: { label: 'Urgent', icon: 'alert' },
    help: { label: 'Butuh bantuan', icon: 'flag' },
    late: { label: 'Terlambat', icon: 'clock' },
  } as const;
</script>

<span class="flag" class:pulse>
  <Icon name={META[type].icon} size={12} />
  {META[type].label}
</span>

<style>
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--color-danger-subtle);
    color: var(--color-danger-default);
    font: var(--text-label);
    white-space: nowrap;
  }
  .pulse {
    animation: pulse 1.2s var(--ease) 2;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px var(--color-danger-subtle);
    }
  }
</style>
