<script lang="ts">
  import { WO_STATUS_LABEL, type WoStatus } from '@rein/shared';

  /** Ikon status WO animasi (prototype `stIcon`): cincin, pie progres, centang tergambar. */
  interface Props {
    status: WoStatus;
    size?: number;
  }
  let { status, size = 14 }: Props = $props();

  const FILL: Record<WoStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 50,
    review: 75,
    done: 100,
    canceled: 0,
  };
</script>

<svg
  class="st {status}"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  role="img"
  aria-label={WO_STATUS_LABEL[status]}
>
  <circle class="ring" cx="8" cy="8" r="6.25" />
  <circle
    class="pie"
    cx="8"
    cy="8"
    r="3"
    pathLength="100"
    style:stroke-dashoffset={100 - FILL[status]}
  />
  <path class="chk" d="M5.3 8.2l1.8 1.8 3.6-3.8" pathLength="12" />
  <path class="x" d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
</svg>

<style>
  .st {
    flex: none;
    overflow: visible;
  }
  .ring {
    fill: none;
    stroke: var(--color-text-tertiary);
    stroke-width: 1.5;
    transition:
      stroke 0.25s,
      stroke-dasharray 0.25s,
      fill 0.25s;
  }
  .pie {
    fill: none;
    stroke: var(--color-accent-default);
    stroke-width: 6;
    stroke-dasharray: 100;
    transform: rotate(-90deg);
    transform-origin: 8px 8px;
    transition:
      stroke-dashoffset 0.45s var(--ease),
      stroke 0.25s;
  }
  .chk {
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 12;
    stroke-dashoffset: 12;
    transition: stroke-dashoffset 0.3s 0.2s var(--ease);
  }
  .x {
    fill: none;
    stroke: var(--color-text-tertiary);
    stroke-width: 1.5;
    stroke-linecap: round;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .backlog .ring {
    stroke-dasharray: 2.4 2.4;
  }
  .in_progress .ring,
  .review .ring {
    stroke: var(--color-accent-default);
  }
  .done .ring {
    stroke: var(--color-success-default);
  }
  .done .pie {
    stroke: var(--color-success-default);
  }
  .done .chk {
    stroke-dashoffset: 0;
  }
  .canceled .x {
    opacity: 1;
  }
</style>
