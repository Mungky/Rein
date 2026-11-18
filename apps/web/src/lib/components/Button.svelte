<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    icon?: IconName;
    loading?: boolean;
    block?: boolean;
    href?: string;
    children?: Snippet;
  }
  let {
    variant = 'secondary',
    size = 'sm',
    icon,
    loading = false,
    block = false,
    href,
    type = 'button',
    disabled,
    children,
    ...rest
  }: Props = $props();
</script>

{#if href}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href dari prop; pemanggil wajib memakai resolve() -->
  <a class="btn {variant} {size}" class:block {href}>
    {#if icon}<Icon name={icon} size={size === 'md' ? 16 : 14} />{/if}
    {@render children?.()}
  </a>
{:else}
  <button
    class="btn {variant} {size}"
    class:block
    class:loading
    {type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {#if loading}
      <span class="spin" aria-hidden="true"></span>
    {:else if icon}
      <Icon name={icon} size={size === 'md' ? 16 : 14} />
    {/if}
    {@render children?.()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    font: var(--text-label);
    white-space: nowrap;
    text-decoration: none;
    color: var(--color-text-primary);
    transition:
      background var(--dur),
      border-color var(--dur),
      transform var(--dur-fast);
  }
  .btn:hover {
    text-decoration: none;
  }
  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .btn.md {
    height: 32px;
    padding: 0 12px;
    font-size: 13px;
  }
  .btn.block {
    width: 100%;
  }
  .primary {
    background: var(--color-accent-default);
    color: var(--color-text-on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }
  .secondary {
    border: 1px solid var(--color-border-strong);
    background: var(--color-bg-surface);
  }
  .secondary:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }
  .ghost {
    color: var(--color-text-secondary);
  }
  .ghost:hover:not(:disabled) {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .danger {
    background: var(--color-danger-default);
    color: #fff;
  }
  .danger:hover:not(:disabled) {
    filter: brightness(0.94);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.loading:disabled {
    opacity: 0.85;
    cursor: progress;
  }
  .spin {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 767px) {
    .btn {
      min-width: 44px;
      min-height: 44px;
    }
    .btn.md {
      height: 44px;
      font-size: 14px;
    }
  }
</style>
