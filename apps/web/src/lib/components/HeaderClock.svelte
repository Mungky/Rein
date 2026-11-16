<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  let { compact = false }: { compact?: boolean } = $props();
  let now = $state(new Date());
  const wib = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  const today = $derived(wib(now));
  let month = $state(new Date(`${wib(new Date()).slice(0, 7)}-01T00:00:00Z`));
  const title = $derived(
    new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      month,
    ),
  );
  const days = $derived(
    new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate(),
  );
  const offset = $derived((month.getUTCDay() + 6) % 7);
  const weeks = $derived(
    Array.from({ length: Math.ceil((days + offset) / 7) }, (_, week) =>
      Array.from({ length: 7 }, (_, col) => week * 7 + col - offset + 1),
    ),
  );
  const id = $props.id();
  onMount(() => {
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(timer);
  });
  function move(delta: number) {
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));
  }
</script>

<button
  class="clock"
  class:compact
  popovertarget={id}
  aria-label="Buka kalender"
  title="Kalender dan waktu WIB"
>
  <Icon name="calendar" size={14} />
  {#if !compact}<span
      >{new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      }).format(now)}</span
    >{/if}
  <time datetime={now.toISOString()}
    >{new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: compact ? undefined : '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta',
    }).format(now)} WIB</time
  >
</button>
<div {id} popover="auto" class="calendar">
  <header>
    <button aria-label="Bulan sebelumnya" onclick={() => move(-1)}
      ><Icon name="chevron-left" /></button
    ><b>{title}</b><button aria-label="Bulan berikutnya" onclick={() => move(1)}
      ><Icon name="chevron-right" /></button
    >
  </header>
  <table aria-label={title}>
    <thead
      ><tr
        >{#each ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as day (day)}<th scope="col"
            >{day}</th
          >{/each}</tr
      ></thead
    >
    <tbody
      >{#each weeks as week, index (index)}<tr
          >{#each week as day (day)}<td
              aria-current={day > 0 &&
              day <= days &&
              `${month.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}` === today
                ? 'date'
                : undefined}>{day > 0 && day <= days ? day : ''}</td
            >{/each}</tr
        >{/each}</tbody
    >
  </table>
  <button
    class="today"
    onclick={() => {
      month = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    }}>Bulan ini</button
  >
</div>

<style>
  .clock {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font: var(--text-caption);
    white-space: nowrap;
  }
  .clock:hover {
    background: var(--color-bg-hover);
  }
  time {
    font-variant-numeric: tabular-nums;
  }
  .calendar {
    inset: 64px 20px auto auto;
    margin: 0;
    padding: 16px;
    width: 300px;
    color: var(--color-text-primary);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
  }
  .calendar::backdrop {
    background: transparent;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  header button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
  }
  header button:hover {
    background: var(--color-bg-hover);
  }
  table {
    width: 100%;
    text-align: center;
    border-collapse: separate;
    border-spacing: 2px;
  }
  th {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
    padding: 4px;
  }
  td {
    height: 32px;
    border-radius: var(--radius-sm);
  }
  td[aria-current] {
    color: var(--color-text-on-accent);
    background: var(--color-accent-default);
  }
  .today {
    display: block;
    color: var(--color-accent-default);
    margin: 12px auto 0;
    padding: 4px 8px;
  }
  @media (max-width: 767px) {
    .calendar {
      right: 12px;
      top: 60px;
    }
    .compact {
      font-size: 11px;
    }
  }
</style>
