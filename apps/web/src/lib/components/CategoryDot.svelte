<script lang="ts">
  import { WO_CATEGORY_META, type WoCategory } from '@rein/shared';

  /** Titik 8 px warna kategori (Figma `Category Dot`). */
  let { category }: { category: WoCategory } = $props();
</script>

<span
  class="cdot"
  style:--c="var({WO_CATEGORY_META[category].token})"
  title={WO_CATEGORY_META[category].label}
  aria-hidden="true"
></span>

<style>
  .cdot {
    display: inline-block;
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
</style>
