<script lang="ts" module>
  export type Period = 'day' | 'week' | 'all';
</script>

<script lang="ts">
  let {
    period,
    date,
    showAll = false,
    onchange,
  }: {
    period: Period;
    date: string;
    showAll?: boolean;
    onchange: (period: Period, date: string) => void;
  } = $props();
</script>

<div class="period">
  <select
    aria-label="Periode"
    value={period}
    onchange={(e) => onchange(e.currentTarget.value as Period, date)}
  >
    <option value="day">Harian</option>
    <option value="week">Mingguan</option>
    {#if showAll}<option value="all">Semua</option>{/if}
  </select>
  {#if period !== 'all'}
    <input
      type="date"
      aria-label={period === 'day' ? 'Tanggal' : 'Tanggal dalam minggu'}
      value={date}
      onchange={(e) => {
        if (e.currentTarget.value) onchange(period, e.currentTarget.value);
      }}
    />
  {/if}
</div>

<style>
  .period {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  select,
  input {
    min-height: 32px;
    padding: 0 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
  }
  @media (max-width: 767px) {
    select,
    input {
      min-height: 44px;
    }
  }
</style>
