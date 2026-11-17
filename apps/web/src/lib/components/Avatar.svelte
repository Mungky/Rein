<script lang="ts">
  /** Avatar 20/24/32/64 (Figma `Avatar`). Tanpa foto → inisial. */
  interface Props {
    name: string;
    src?: string | null;
    size?: 20 | 24 | 32 | 64;
  }
  let { name, src = null, size = 24 }: Props = $props();

  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join(''),
  );
  let failed = $state(false);
</script>

<span class="av s{size}" title={name}>
  {#if src && !failed}
    <img
      {src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onerror={() => (failed = true)}
    />
  {:else}
    <span aria-hidden="true">{initials}</span>
  {/if}
  <span class="sr-only">{name}</span>
</span>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    background: var(--color-bg-hover);
    border: 1.5px solid var(--color-bg-surface);
    color: var(--color-text-secondary);
    font-weight: 600;
  }
  .s20 {
    width: 20px;
    height: 20px;
    font-size: 9px;
  }
  .s24 {
    width: 24px;
    height: 24px;
    font-size: 10px;
  }
  .s32 {
    width: 32px;
    height: 32px;
    font-size: 12px;
  }
  .s64 {
    width: 64px;
    height: 64px;
    font-size: 20px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
