<script lang="ts">
  import type { SCurveData } from '@rein/shared';
  import { api, ApiError } from '$lib/api';
  import { shortDate } from '$lib/format';
  import { resolve } from '$app/paths';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import Button from './Button.svelte';
  type Data = Omit<SCurveData, 'weights'> & {
    weights: Array<SCurveData['weights'][number] & { title: string; numberLabel: string }>;
  };
  let {
    projectId,
    category = '',
    assignee = '',
    urgent = false,
    revision = '',
  }: {
    projectId: string;
    category?: string;
    assignee?: string;
    urgent?: boolean;
    revision?: string;
  } = $props();
  let data = $state<Data | null>(null);
  let error = $state('');
  let loading = $state(true);
  let retry = $state(0);
  $effect(() => {
    const query = new SvelteURLSearchParams();
    if (category) query.set('category', category);
    if (assignee) query.set('assignee', assignee);
    if (urgent) query.set('urgent', 'true');
    const id = projectId;
    void revision;
    void retry;
    let active = true;
    loading = true;
    error = '';
    api<Data>(`/api/projects/${id}/scurve?${query}`)
      .then((result) => {
        if (active) data = result;
      })
      .catch((err) => {
        if (active) error = err instanceof ApiError ? err.message : 'S-Curve gagal dimuat.';
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
  const start = $derived(data ? Date.parse(data.points[0]!.date) : 0);
  const span = $derived(
    data ? Math.max(86_400_000, Date.parse(data.points.at(-1)!.date) - start) : 1,
  );
  const x = (date: string) => 42 + ((Date.parse(date) - start) / span) * 616;
  const y = (value: number) => 242 - (value / 100) * 220;
  const planned = $derived(data?.points.map((p) => `${x(p.date)},${y(p.plan)}`).join(' ') ?? '');
  const actual = $derived(
    data?.points
      .filter((p) => p.actual !== null)
      .map((p) => `${x(p.date)},${y(p.actual!)}`)
      .join(' ') ?? '',
  );
  const labels = $derived.by(() => {
    if (!data) return [];
    const { points } = data;
    const n = Math.min(6, points.length);
    return Array.from(
      { length: n },
      (_, i) => points[n === 1 ? 0 : Math.round((i * (points.length - 1)) / (n - 1))]!,
    );
  });
  const number = (value: number) =>
    new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value);
</script>

{#if error}<p class="error" role="alert">
    {error}
    <Button onclick={() => retry++}>Coba lagi</Button>
  </p>
{:else if loading}<p class="loading" role="status">Menghitung S-Curve…</p>
{:else if data}
  <div class="curve-layout">
    <div class="chart-card">
      <div class="kpis">
        <div><span>Rencana s.d. {shortDate(data.today)}</span><b>{number(data.plan)}%</b></div>
        <div><span>Aktual</span><b class="accent">{number(data.actual)}%</b></div>
        <div>
          <span>Deviasi</span><b>{data.deviation > 0 ? '+' : ''}{number(data.deviation)}%</b>
        </div>
        <div>
          <span>Prediksi selesai</span><b
            >{data.predictedFinish ? shortDate(data.predictedFinish) : 'Belum dapat diprediksi'}</b
          >
        </div>
      </div>
      <svg
        viewBox="0 0 680 280"
        role="img"
        aria-label={`S-Curve rencana ${number(data.plan)} persen dan aktual ${number(data.actual)} persen`}
      >
        {#each [0, 25, 50, 75, 100] as value (value)}<line
            class="grid"
            x1="42"
            x2="658"
            y1={y(value)}
            y2={y(value)}
          /><text x="32" y={y(value) + 4} text-anchor="end">{value}%</text>{/each}
        {#each labels as point (point.date)}<text x={x(point.date)} y="266" text-anchor="middle"
            >{shortDate(point.date)}</text
          >{/each}
        <polyline class="planned" points={planned} /><polyline class="actual" points={actual} />
        <line class="today" x1={x(data.today)} x2={x(data.today)} y1="22" y2="242" />
        {#each data.points.filter((p) => p.actual !== null) as point (point.date)}<circle
            class="point"
            cx={x(point.date)}
            cy={y(point.actual!)}
            r="3"
            ><title
              >{shortDate(point.date)} · Rencana {number(point.plan)}% · Aktual {number(
                point.actual!,
              )}%</title
            ></circle
          >{/each}
      </svg>
      <div class="legend">
        <span><i class="plan-key"></i>Rencana</span><span><i class="actual-key"></i>Aktual</span
        ><span>SPI {data.spi === null ? '—' : number(data.spi)}</span>
      </div>
    </div>
    <div class="weights">
      <table>
        <thead
          ><tr
            ><th scope="col">WO</th><th scope="col">Bobot</th><th scope="col">Progres</th><th
              scope="col">Kontribusi</th
            ></tr
          ></thead
        >
        <tbody
          >{#each data.weights as wo (wo.id)}<tr
              ><th scope="row"
                ><a href={resolve('/(app)/w/[id]', { id: wo.id })} title={wo.title}
                  >{wo.numberLabel} {wo.title}</a
                ></th
              ><td>{number(wo.weight)}%</td><td>{number(wo.progress)}%</td><td
                >{number(wo.contribution)}%</td
              ></tr
            >{/each}</tbody
        >
        <tfoot
          ><tr
            ><th scope="row">Total aktual</th><td>{data.weights.length ? '100%' : '0%'}</td><td
            ></td><td class="accent">{number(data.actual)}%</td></tr
          ></tfoot
        >
      </table>
      <p class="faint">Bobot kosong dibagi rata. Aktual mengikuti histori progres WO.</p>
    </div>
  </div>
{/if}

<style>
  .curve-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
    gap: 16px;
    padding: 16px 24px;
    align-items: start;
  }
  .chart-card,
  .weights {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .chart-card {
    padding: 16px;
  }
  .kpis {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .kpis > div {
    display: grid;
    gap: 4px;
  }
  .kpis span {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
  .kpis b {
    font: var(--text-heading-16);
  }
  .accent {
    color: var(--color-accent-default);
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  svg text {
    fill: var(--color-text-tertiary);
    font: 11px var(--font-sans);
  }
  .grid {
    stroke: var(--color-border-default);
    stroke-width: 1;
  }
  polyline {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .planned {
    stroke: var(--color-text-tertiary);
    stroke-dasharray: 5 4;
  }
  .actual {
    stroke: var(--color-accent-default);
  }
  .today {
    stroke: var(--color-accent-default);
    stroke-width: 1;
    opacity: 0.5;
  }
  .point {
    fill: var(--color-accent-default);
    opacity: 0;
  }
  .point:hover {
    opacity: 1;
    r: 5;
  }
  .legend,
  .legend span {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .legend {
    gap: 20px;
    font: var(--text-caption);
    color: var(--color-text-secondary);
  }
  .legend i {
    width: 20px;
    height: 0;
    border-top: 2px solid;
  }
  .legend .plan-key {
    border-color: var(--color-text-tertiary);
    border-top-style: dashed !important;
  }
  .legend .actual-key {
    border-color: var(--color-accent-default);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font: var(--text-caption);
  }
  th,
  td {
    padding: 10px 8px;
    text-align: right;
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 400;
  }
  th:first-child {
    width: 40%;
    text-align: left;
    padding-left: 16px;
  }
  th a {
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }
  thead {
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
  }
  tfoot th,
  tfoot td {
    font-weight: 500;
  }
  .weights p {
    padding: 12px 16px;
    font: var(--text-caption);
  }
  .loading,
  .error {
    padding: 24px;
  }
  .error {
    color: var(--color-danger-default);
  }
  @media (max-width: 1100px) {
    .curve-layout {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 767px) {
    .curve-layout {
      padding: 16px;
    }
    .kpis {
      gap: 16px;
    }
  }
</style>
