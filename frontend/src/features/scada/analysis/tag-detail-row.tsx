"use client";

/** Expanded detail under one tag row (the "dropdown"). Top: a large glowing
 *  chart of the last ≤100 points (ticks in realtime — the series already
 *  includes session-buffered live values). Below, three zones:
 *   1. Penyimpanan — the store-or-not decision + interval + Aktif switch.
 *   2. Info Sensor — topic, alarm bounds, quick actions (Atur Sumber,
 *      Riwayat penuh, Export sensor ini).
 *   3. Data — Min/Rata²/Maks stat tiles + the paginated raw list
 *      (5/10/20/50/100 per page, newest first).
 *
 *  Storage model. Since scada_rollup_1m (ARSITEKTUR-DATA §2.5) every tag gets a
 *  per-minute summary regardless of this toggle, so the toggle no longer decides
 *  "history or no history" — it decides how much RAW detail is kept and whether
 *  the tag is archived to Drive:
 *   - OFF → ring mode: raw values kept 24 h. Summary still kept, so long-range
 *     charts work. Any sampling level allowed.
 *   - ON  → historian: raw values accumulate ~1 month, then auto-archive to
 *     Google Drive and reset from 0. Fast levels are blocked while storing.
 *  Both lanes sample at the tag's chosen level (admin sets the seconds).
 *  The label must keep saying this honestly: before the summary existed, OFF
 *  really did mean "old data is deleted", and that wording is now false. */

import { useCallback, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Loader2,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { ChartRange, RecentSample, SamplingLevel, SummaryItem, Tag } from "../types";
import { TagSparkline, type SparkStatus } from "./tag-sparkline";
import { RANGE_LABELS, RANGE_MS, RANGE_POINTS } from "../panels/chart-panel";
import { usePanelRefresh } from "../panels/use-panel-refresh";

/** Sambung ekor live (titik lebih baru dari data historis terakhir) ke deret
 *  jendela waktu, supaya ujung kurva bergerak tiap detik tanpa menunggu fetch
 *  berikutnya — pola sama dengan ChartPanel di Monitor. */
function withLiveTail(base: RecentSample[], live: RecentSample[]): RecentSample[] {
  if (base.length === 0) return live;
  const lastT = new Date(base[base.length - 1].ts).getTime();
  const tail = live.filter((s) => new Date(s.ts).getTime() > lastT);
  return tail.length ? base.concat(tail) : base;
}

/** The 4 sampling levels. Fast levels are ring-only (blocked when storing) so
 *  the 1-month historian never explodes; their seconds are admin-tunable. */
const LEVEL_OPTIONS: {
  value: SamplingLevel;
  label: string;
  ringOnly: boolean;
}[] = [
  { value: "fastest", label: "Fastest", ringOnly: true },
  { value: "fast", label: "Fast", ringOnly: true },
  { value: "slow", label: "Slow", ringOnly: false },
  { value: "slowest", label: "Slowest", ringOnly: false },
];

const PAGE_SIZES = [5, 10, 20, 50, 100];

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString("id", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TagDetailRow({
  tag,
  range,
  samples,
  sparkStatus,
  online,
  loading,
  canManage,
  colSpan,
  onChanged,
  onOpenSource,
  onOpenHistory,
  onExport,
}: {
  tag: Tag;
  /** Jendela waktu bersama (selektor "Rentang" di toolbar) — dipakai grafik
   *  besar + statistik Min/Rata/Maks supaya seragam dengan sparkline. */
  range: ChartRange;
  /** Newest first — stored samples + session live points, already merged. */
  samples: RecentSample[];
  sparkStatus: SparkStatus;
  online: boolean;
  loading: boolean;
  canManage: boolean;
  colSpan: number;
  onChanged: () => Promise<void>;
  onOpenSource?: () => void;
  onOpenHistory: () => void;
  /** Buka drawer Export (kalender Dari/Sampai) untuk sensor ini. */
  onExport: () => void;
}) {
  const cfg = tag.config as Record<string, unknown>;
  const storeEnabled = Boolean(cfg.store_enabled);
  const level = (cfg.sampling_level as SamplingLevel) || "fast";
  const topic = String(cfg.mqtt_topic ?? "");
  // Diisi hanya saat topik di atas membawa banyak nilai sekaligus.
  const field = String(cfg.mqtt_field ?? "");
  const alarmMin = cfg.alarm_min ?? null;
  const alarmMax = cfg.alarm_max ?? null;
  const warnMin = cfg.warn_min ?? null;
  const warnMax = cfg.warn_max ?? null;

  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // `samples` (dari analysis-view) sudah = data tersimpan + titik live sesi ini.
  const ascending = useMemo(() => [...samples].reverse(), [samples]);

  // Grafik besar = jendela "Rentang" terpilih (bucketed dari server), dan
  // statistik Min/Rata/Maks = agregat SUNGGUHAN atas jendela yang sama
  // (getSummary, bukan cuma 100 titik terakhir) — jadi grafik, sparkline, dan
  // statistik semuanya bercerita hal yang sama. Di-fetch ulang pada irama panel
  // (60 dtk); di antara fetch, ekor live ditempel supaya ujung kurva bergerak.
  const [chartPts, setChartPts] = useState<RecentSample[] | null>(null);
  const [summary, setSummary] = useState<SummaryItem | null>(null);
  // Jendela mana yang sedang ada di chartPts. Selama belum cocok dengan yang
  // diminta (baru dibuka, atau Rentang baru saja diganti), grafik menggambar
  // placeholder diam — bukan ~100 titik mentah terakhir yang jendelanya jauh
  // lebih sempit dan tampil sebagai kurva liar sebelum data asli tiba.
  const chartWindow = `${tag.id}|${range}`;
  const [chartLoadedFor, setChartLoadedFor] = useState<string | null>(null);
  const chartPending = chartLoadedFor !== chartWindow;

  const loadRange = useCallback(async () => {
    const end = new Date();
    const start = new Date(end.getTime() - RANGE_MS[range]);
    const window = `${tag.id}|${range}`;
    try {
      const [hist, sum] = await Promise.all([
        scadaApi.getHistory([tag.id], start, end, RANGE_POINTS[range]),
        scadaApi.getSummary([tag.id], start, end),
      ]);
      const pts = hist.series[0]?.points ?? [];
      setChartPts(pts.map((p) => ({ ts: p.t, value: p.avg })));
      setSummary(sum.items[0] ?? null);
      setChartLoadedFor(window);
    } catch {
      /* biarkan tampilan lama; usePanelRefresh coba lagi */
    }
  }, [tag.id, range]);
  usePanelRefresh(loadRange);

  // Grafik rentang + ekor live bila datanya cukup; sensor baru (< 2 titik dalam
  // rentang) pakai data live sesi ini supaya langsung tergambar & bergerak.
  const chartSamples = useMemo(
    () =>
      chartPts && chartPts.length >= 2
        ? withLiveTail(chartPts, ascending)
        : ascending,
    [chartPts, ascending]
  );

  // Statistik: agregat server atas rentang bila tersedia; selagi memuat,
  // fallback ke data terkini supaya tile tidak kosong.
  const stats = useMemo(() => {
    if (
      summary &&
      summary.min !== null &&
      summary.max !== null &&
      summary.avg !== null
    ) {
      return { min: summary.min, max: summary.max, avg: summary.avg };
    }
    if (samples.length === 0) return null;
    const values = samples.map((s) => s.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }, [summary, samples]);

  const pageCount = Math.max(1, Math.ceil(samples.length / pageSize));
  const pageItems = samples.slice((page - 1) * pageSize, page * pageSize);

  async function patchConfig(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const config = { ...cfg, ...patch };
      // Keep config clean: drop keys explicitly set to undefined
      for (const k of Object.keys(config)) {
        if (config[k] === undefined) delete config[k];
      }
      await scadaApi.updateTag(tag.id, { config });
      await onChanged();
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    setSaving(true);
    try {
      await scadaApi.updateTag(tag.id, { enabled: !tag.enabled });
      await onChanged();
    } catch {
      toast.error("Gagal mengubah status tag");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-border-soft bg-bg-sidebar/60">
      <td colSpan={colSpan} className="px-4 py-3">
        {/* Grafik besar — versi penuh dari grafik mini, ikut berdetak live */}
        <div className="mb-3 rounded-[var(--r-lg)] border border-border-soft bg-bg p-2">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-light">
              {RANGE_LABELS[range]} terakhir
            </span>
            {online ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-green">
                <span className="inline-block size-1.5 rounded-full bg-green" /> live
              </span>
            ) : (
              <span className="text-[10.5px] text-text-light">offline</span>
            )}
            {(loading || chartPending) && (
              <Loader2 className="size-3 animate-spin text-text-light" />
            )}
            <div className="flex-1" />
            {/* Rentang waktu hanya ditampilkan kalau yang tergambar memang
                jendela yang diminta — kalau tidak, angkanya menyesatkan. */}
            {!chartPending && chartSamples.length > 0 && (
              <span className="text-[10.5px] tabular-nums text-text-light">
                {fmtTs(chartSamples[0].ts)} —{" "}
                {fmtTs(chartSamples[chartSamples.length - 1].ts)}
              </span>
            )}
          </div>
          <TagSparkline
            pending={chartPending}
            samples={chartSamples}
            status={sparkStatus}
            width={720}
            height={110}
            className="h-auto w-full"
          />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          {/* ── 1. Penyimpanan ── */}
          <div className="flex w-full flex-col gap-2.5 lg:w-72 lg:shrink-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Penyimpanan
            </div>
            <label
              className={cn(
                "flex items-start gap-2",
                canManage ? "cursor-pointer" : "cursor-default"
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--rein-primary)]"
                checked={storeEnabled}
                disabled={!canManage || saving}
                onChange={(e) => {
                  const on = e.target.checked;
                  const patch: Record<string, unknown> = {
                    store_enabled: on ? true : undefined,
                  };
                  // Store hanya boleh Slow/Slowest — naikkan otomatis bila perlu.
                  if (on && (level === "fastest" || level === "fast")) {
                    patch.sampling_level = "slow";
                  }
                  void patchConfig(patch);
                }}
              />
              <span className="text-[12.5px] text-text">
                <span className="font-semibold">Simpan detail mentah &amp; arsipkan ke Drive</span>
                <span className="block text-[11px] leading-snug text-text-light">
                  {storeEnabled
                    ? "Tiap nilai mentah disimpan ±1 bulan, lalu diekspor ke Google Drive dan direset dari 0. Kecepatan sampling terbatas Slow/Slowest."
                    : "Nilai mentah disimpan 24 jam terakhir saja. Ringkasan per menit (rata-rata, min, maks) tetap disimpan untuk semua sensor — jadi grafik jangka panjang tetap ada."}
                </span>
              </span>
            </label>

            <div className="pl-6">
              <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                Kecepatan Sampling
              </label>
              <select
                className="field-select h-8 cursor-pointer text-[12px]"
                value={level}
                disabled={!canManage || saving}
                onChange={(e) =>
                  void patchConfig({ sampling_level: e.target.value })
                }
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    disabled={storeEnabled && o.ringOnly}
                  >
                    {o.label}
                    {storeEnabled && o.ringOnly ? " (mode 24 jam saja)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] leading-snug text-text-light">
                Fastest &amp; Fast hanya untuk mode 24 jam. Durasi tiap level
                diatur admin di Panel Administrasi → R-Net.
              </p>
            </div>

            <label
              className={cn(
                "flex items-center gap-2",
                canManage ? "cursor-pointer" : "cursor-default"
              )}
            >
              <span
                className={cn(
                  "inline-block size-3.5 rounded-full border-2",
                  tag.enabled
                    ? "border-green bg-green"
                    : "border-border bg-transparent"
                )}
              />
              <button
                type="button"
                onClick={() => canManage && void toggleEnabled()}
                disabled={!canManage || saving}
                className={cn(
                  "text-[12px] font-medium text-text",
                  canManage && "cursor-pointer hover:underline"
                )}
              >
                {tag.enabled ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"}
              </button>
              {saving && <Loader2 className="size-3 animate-spin text-text-light" />}
            </label>
          </div>

          {/* ── 2. Info sensor + aksi ── */}
          <div className="flex w-full flex-col gap-2 lg:w-64 lg:shrink-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Info Sensor
            </div>
            <dl className="flex flex-col gap-1 text-[11.5px]">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-text-light">Topik</dt>
                <dd className="min-w-0 truncate font-mono text-[10.5px] text-text-muted" title={topic}>
                  {topic || "—"}
                </dd>
              </div>
              {/* Hanya muncul kalau topiknya membawa banyak nilai. Kalau
                  disembunyikan, tidak ada yang bisa membedakan dua sensor yang
                  topiknya sama persis. */}
              {field && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-text-light">Field</dt>
                  <dd
                    className="min-w-0 truncate font-mono text-[10.5px] text-text-muted"
                    title={field}
                  >
                    {field}
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-text-light">Batas alarm</dt>
                <dd className="tabular-nums text-text-muted">
                  {alarmMin === null && alarmMax === null
                    ? "belum diatur"
                    : `${alarmMin ?? "−∞"} s.d. ${alarmMax ?? "∞"}${tag.unit ? ` ${tag.unit}` : ""}`}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-text-light">Batas waspada</dt>
                <dd className="tabular-nums text-text-muted">
                  {warnMin === null && warnMax === null
                    ? "belum diatur"
                    : `${warnMin ?? "−∞"} s.d. ${warnMax ?? "∞"}${tag.unit ? ` ${tag.unit}` : ""}`}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-text-light">Sensor bisu</dt>
                <dd className="text-text-muted">otomatis (tanpa data &gt; {storeEnabled ? "3× interval" : "1 menit"})</dd>
              </div>
            </dl>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {onOpenSource && (
                <button
                  type="button"
                  onClick={onOpenSource}
                  className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                >
                  <Radio className="size-3" /> Atur Sumber
                </button>
              )}
              <button
                type="button"
                onClick={onOpenHistory}
                className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                title="Riwayat lengkap + grafik 24 jam"
              >
                <History className="size-3" /> Riwayat
              </button>
              <button
                type="button"
                onClick={onExport}
                className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                title="Export data sensor ini (pilih rentang Dari/Sampai)"
              >
                <Download className="size-3" />
                Export
              </button>
            </div>

            {/* Statistik atas rentang terpilih (Min/Rata/Maks) */}
            {stats && (
              <div className="mt-1 grid grid-cols-3 gap-2">
                {(
                  [
                    ["Min", stats.min],
                    ["Rata²", stats.avg],
                    ["Maks", stats.max],
                  ] as const
                ).map(([label, v]) => (
                  <div
                    key={label}
                    className="rounded-[var(--r)] border border-border-soft bg-bg px-2 py-1.5"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-light">
                      {label}
                    </div>
                    <div className="text-[13px] font-bold tabular-nums text-text">
                      {v.toLocaleString("id", { maximumFractionDigits: 2 })}
                      {tag.unit && (
                        <span className="ml-0.5 text-[10px] font-normal text-text-light">
                          {tag.unit}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 3. Daftar data ── */}
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
                Data ({samples.length})
              </span>
              <div className="flex-1" />
              <select
                className="field-select h-7 w-auto cursor-pointer text-[11.5px]"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} / halaman
                  </option>
                ))}
              </select>
            </div>
            {samples.length === 0 ? (
              <p className="py-4 text-[12px] text-text-muted">
                Belum ada data untuk sensor ini.
              </p>
            ) : (
              <>
                <table className="w-full max-w-md border-collapse text-[12px]">
                  <thead>
                    <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
                      <th className="py-1 pr-3">Waktu</th>
                      <th className="py-1 text-right">
                        Nilai{tag.unit ? ` (${tag.unit})` : ""}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((s) => (
                      <tr key={s.ts} className="border-t border-border-soft">
                        <td className="py-1 pr-3 font-mono text-[11px] text-text-muted">
                          {fmtTs(s.ts)}
                        </td>
                        <td className="py-1 text-right font-semibold tabular-nums text-text">
                          {s.value.toLocaleString("id")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pageCount > 1 && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="btn btn-ghost btn-icon btn-sm"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <span className="text-[11px] text-text-muted">
                      {page} / {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={page >= pageCount}
                      className="btn btn-ghost btn-icon btn-sm"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
