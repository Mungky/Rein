<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * PIN 6 digit (Figma `Digit / PIN Dots`, `Keypad`; D/01c–d, M/01c–d). Bisa diketik dengan
   * keyboard fisik atau keypad layar. `oncomplete` dipanggil saat digit ke-6 masuk.
   */
  interface Props {
    value?: string;
    length?: number;
    error?: string | null;
    disabled?: boolean;
    oncomplete?: (pin: string) => void;
  }
  let {
    value = $bindable(''),
    length = 6,
    error = null,
    disabled = false,
    oncomplete,
  }: Props = $props();

  let shake = $state(false);
  $effect(() => {
    if (error) {
      shake = true;
      const t = setTimeout(() => (shake = false), 450);
      return () => clearTimeout(t);
    }
  });

  function press(d: string) {
    if (disabled || value.length >= length) return;
    value += d;
    if (value.length === length) oncomplete?.(value);
  }
  function back() {
    if (!disabled) value = value.slice(0, -1);
  }
  function onkeydown(e: KeyboardEvent) {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') back();
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

<svelte:window {onkeydown} />

<div class="pin">
  <div
    class="dots"
    class:shake
    class:err={!!error}
    role="img"
    aria-label={`${value.length} dari ${length} digit`}
  >
    {#each Array.from({ length }, (_, i) => i) as i (i)}
      <span class:on={i < value.length}></span>
    {/each}
  </div>
  <p class="msg" role="alert">{error ?? ''}</p>
  <div class="pad">
    {#each keys as k (k)}
      <button type="button" onclick={() => press(k)} {disabled}>{k}</button>
    {/each}
    <span></span>
    <button type="button" onclick={() => press('0')} {disabled}>0</button>
    <button type="button" class="bk" onclick={back} {disabled} aria-label="Hapus digit">
      <Icon name="chevron-left" size={20} />
    </button>
  </div>
</div>

<style>
  .pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .dots {
    display: flex;
    gap: 14px;
    padding: 8px 0;
  }
  .dots span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--color-border-strong);
    transition:
      background var(--dur) var(--ease),
      transform var(--dur) var(--ease),
      border-color var(--dur);
  }
  .dots span.on {
    background: var(--color-text-primary);
    border-color: var(--color-text-primary);
    transform: scale(1.1);
  }
  .dots.err span {
    border-color: var(--color-danger-default);
  }
  .dots.err span.on {
    background: var(--color-danger-default);
  }
  .shake {
    animation: shake 0.4s var(--ease);
  }
  @keyframes shake {
    20%,
    60% {
      transform: translateX(-6px);
    }
    40%,
    80% {
      transform: translateX(6px);
    }
  }
  .msg {
    min-height: 16px;
    font: var(--text-caption);
    color: var(--color-danger-default);
    text-align: center;
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 64px);
    gap: 12px 20px;
  }
  .pad button {
    width: 64px;
    height: 56px;
    border-radius: var(--radius-xl);
    font-size: 22px;
    font-weight: 500;
    color: var(--color-text-primary);
    transition: background var(--dur-fast);
  }
  .pad button:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }
  .pad button:active:not(:disabled) {
    background: var(--color-bg-selected);
  }
  .pad .bk {
    display: grid;
    place-items: center;
    color: var(--color-text-secondary);
  }
</style>
