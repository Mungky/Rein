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
 *  Storage model (user's CCTV analogy):
 *   - "Simpan data" OFF → ring mode: the DB keeps only the newest 100 rows
 *     (~1 s apart); row #101 in, oldest out.
 *   - ON → one row per chosen interval, kept 90 days, then auto-archived to
 *     Google Drive before deletion. */

import { useMemo, useState } from "react";
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
import type { RecentSample, Tag } from "../types";
import { exportTagToExcel } from "./export-excel";
import { TagSparkline, type SparkStatus } from "./tag-sparkline";

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: "5 detik" },
  { value: 10, label: "10 detik" },
  { value: 30, label: "30 detik" },
  { value: 60, label: "1 menit" },
  { value: 300, label: "5 menit" },
  { value: 900, label: "15 menit" },
  { value: 3600, label: "1 jam" },
  { value: 21600, label: "6 jam" },
  { value: 86400, label: "24 jam" },
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
  samples,
  sparkStatus,
  online,
  loading,
  canManage,
  colSpan,
  onChanged,
  onOpenSource,
  onOpenHistory,
}: {
  tag: Tag;
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
}) {
  const cfg = tag.config as Record<string, unknown>;
  const storeEnabled = Boolean(cfg.store_enabled);
  const intervalS = Number(cfg.storage_interval_s) || 60;
  const topic = String(cfg.mqtt_topic ?? "");
  const alarmMin = cfg.alarm_min ?? null;
  const alarmMax = cfg.alarm_max ?? null;

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const ascending = useMemo(() => [...samples].reverse(), [samples]);

  const stats = useMemo(() => {
    if (samples.length === 0) return null;
    const values = samples.map((s) => s.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max, avg, n: values.length };
  }, [samples]);

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

  async function exportTag() {
    setExporting(true);
    try {
      await exportTagToExcel(tag);
      toast.success("File Excel diunduh");
    } catch {
      toast.error("Gagal membuat file Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <tr className="border-t border-border-soft bg-bg-sidebar/60">
      <td colSpan={colSpan} className="px-4 py-3">
        {/* Grafik besar — versi penuh dari grafik mini, ikut berdetak live */}
        <div className="mb-3 rounded-[var(--r-lg)] border border-border-soft bg-bg p-2">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-light">
              {samples.length} data terakhir
            </span>
            {online ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-green">
                <span className="inline-block size-1.5 rounded-full bg-green" /> live
              </span>
            ) : (
              <span className="text-[10.5px] text-text-light">offline</span>
            )}
            {loading && <Loader2 className="size-3 animate-spin text-text-light" />}
            <div className="flex-1" />
            {samples.length > 0 && (
              <span className="text-[10.5px] tabular-nums text-text-light">
                {fmtTs(samples[samples.length - 1].ts)} — {fmtTs(samples[0].ts)}
              </span>
            )}
          </div>
          <TagSparkline
            samples={ascending}
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
                onChange={(e) =>
                  void patchConfig({
                    store_enabled: e.target.checked ? true : undefined,
                  })
                }
              />
              <span className="text-[12.5px] text-text">
                <span className="font-semibold">Simpan data ke riwayat</span>
                <span className="block text-[11px] leading-snug text-text-light">
                  {storeEnabled
                    ? "Disimpan sesuai interval, ditahan 90 hari, lalu otomatis diarsip ke Google Drive."
                    : "Hanya 100 data terakhir yang disimpan (seperti SD card CCTV) — data ke-101 masuk, data tertua terhapus."}
                </span>
              </span>
            </label>

            {storeEnabled && (
              <div className="pl-6">
                <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                  Interval Penyimpanan
                </label>
                <select
                  className="field-select h-8 cursor-pointer text-[12px]"
                  value={intervalS}
                  disabled={!canManage || saving}
                  onChange={(e) =>
                    void patchConfig({
                      storage_interval_s:
                        Number(e.target.value) === 60
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                >
                  {INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-text-light">Batas alarm</dt>
                <dd className="tabular-nums text-text-muted">
                  {alarmMin === null && alarmMax === null
                    ? "belum diatur"
                    : `${alarmMin ?? "−∞"} s.d. ${alarmMax ?? "∞"}${tag.unit ? ` ${tag.unit}` : ""}`}
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
                onClick={() => void exportTag()}
                disabled={exporting}
                className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                title="Unduh 500 data terakhir sensor ini sebagai Excel"
              >
                {exporting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                Export
              </button>
            </div>

            {/* Statistik dari data yang tampil */}
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
