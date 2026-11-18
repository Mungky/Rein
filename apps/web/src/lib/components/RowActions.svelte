<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    label,
    actions,
  }: {
    label: string;
    actions: Array<{ label: string; run: () => void; disabled?: boolean; mobileOnly?: boolean }>;
  } = $props();
  const id = `row-actions-${crypto.randomUUID()}`;
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;

  function position() {
    const rect = trigger.getBoundingClientRect();
    const above = rect.bottom + 160 > window.innerHeight && rect.top > 160;
    panel.style.left = `${Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200))}px`;
    panel.style.top = above ? 'auto' : `${rect.bottom + 4}px`;
    panel.style.bottom = above ? `${window.innerHeight - rect.top + 4}px` : 'auto';
  }
</script>

<button
  type="button"
  class="trigger"
  aria-label={label}
  title={label}
  popovertarget={id}
  bind:this={trigger}
  onclick={position}
>
  <Icon name="more" size={16} />
</button>
<div {id} popover="auto" class="panel" bind:this={panel}>
  {#each actions as action (action.label)}
    <button
      type="button"
      class:mobile-only={action.mobileOnly}
      disabled={action.disabled}
      onclick={() => {
        panel.hidePopover();
        trigger.focus();
        action.run();
      }}>{action.label}</button
    >
  {/each}
</div>

<style>
  .trigger {
    display: grid;
    place-items: center;
    width: 32px;
    min-height: 28px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
  .trigger:hover,
  .panel button:hover:enabled {
    background: var(--color-bg-hover);
  }
  .panel {
    position: fixed;
    inset: auto;
    margin: 0;
    width: min(192px, calc(100vw - 16px));
    padding: 4px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-2);
  }
  .panel button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    min-height: 30px;
    text-align: start;
    border-radius: var(--radius-sm);
  }
  .panel button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .panel .mobile-only {
    display: none;
  }
  @media (max-width: 767px) {
    .trigger {
      width: 44px;
      min-height: 44px;
    }
    .panel button {
      min-height: 44px;
    }
    .panel .mobile-only {
      display: block;
    }
  }
</style>
