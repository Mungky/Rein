<script lang="ts">
  import { ICONS, type IconName } from '$lib/icons';

  interface Props {
    name: IconName;
    size?: number;
    /** Jika diisi, ikon diumumkan ke pembaca layar; jika tidak, dekoratif. */
    label?: string;
    class?: string;
  }
  let { name, size = 16, label, class: cls = '' }: Props = $props();
</script>

<svg
  class="i {cls}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- path konstan dari icons.ts -->
  {@html ICONS[name]}
</svg>

<style>
  .i {
    flex: none;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
