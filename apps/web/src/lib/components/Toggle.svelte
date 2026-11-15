<script lang="ts">
  interface Props {
    checked?: boolean;
    label: string;
    disabled?: boolean;
    /** Tampilkan label di samping toggle (default: hanya untuk pembaca layar). */
    showLabel?: boolean;
  }
  let { checked = $bindable(false), label, disabled = false, showLabel = false }: Props = $props();
</script>

<button
  type="button"
  class="tgw"
  role="switch"
  aria-checked={checked}
  aria-label={showLabel ? undefined : label}
  {disabled}
  onclick={() => (checked = !checked)}
>
  <span class="tg" class:on={checked} aria-hidden="true"></span>
  {#if showLabel}<span>{label}</span>{/if}
</button>

<style>
  .tgw {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 20px;
  }
  .tgw:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .tg {
    position: relative;
    display: inline-block;
    flex: none;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    background: var(--color-border-strong);
    transition: background 0.2s;
  }
  .tg::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s var(--ease);
  }
  .tg.on {
    background: var(--color-accent-default);
  }
  .tg.on::after {
    transform: translateX(12px);
  }
  @media (max-width: 767px) {
    .tgw {
      min-height: 44px;
    }
  }
</style>
