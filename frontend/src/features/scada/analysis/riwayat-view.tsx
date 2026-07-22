"use client";

/** Halaman Riwayat — layar penuh, dua kolom:
 *  KIRI  = tabel mentah panjang (terbaru dulu) dengan scroll tanpa batas:
 *          mentok bawah → potongan data lebih lama dimuat otomatis (keyset,
 *          jutaan baris tetap ringan karena hanya baris terlihat yang
 *          dirender). Drag di atas baris = pilih rentang waktu.
 *  KANAN = grafik rentang terpilih (dari data mentah yang sudah dimuat) +
 *          ringkasan min/rata²/maks. Tanpa pilihan: grafik 24 jam terakhir. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Download, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { HistoryPoint, RecentSample, Tag } from "../types";
import { exportTagToExcel } from "./export-excel";

const ROW_H = 28; // px per baris tabel (virtualisasi butuh tinggi tetap)
const PAGE = 2000; // baris per potongan muat
const OVERSCAN = 10;
const MAX_CHART_POINTS = 1500;

type ChartRow = { t: number; v: number };

export function RiwayatView({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const [samples, setSamples] = useState<RecentSample[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Rentang terpilih: indeks [a..b] pada `samples` (urutan terbaru dulu)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  // Grafik bawaan (tanpa pilihan): 24 jam terakhir, bucketed dari server
  const [defaultPoints, setDefaultPoints] = useState<HistoryPoint[] | null>(null);

  const loadingRef = useRef(false);
  const dragAnchor = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  /* ── data mentah: potongan pertama + muat-lebih-lama ── */

  const loadMore = useCallback(
    async (reset = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const before = reset ? undefined : samples[samples.length - 1]?.ts;
        const res = await scadaApi.getSamplesPage(tag.id, { before, limit: PAGE });
        setSamples((prev) => (reset ? res.items : [...prev, ...res.items]));
        setHasMore(res.has_more);
        if (reset) {
          setSel(null);
          setScrollTop(0);
          scrollerRef.current?.scrollTo({ top: 0 });
        }
      } catch {
        toast.error("Gagal memuat riwayat — coba lagi");
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setInitialLoaded(true);
      }
    },
    [tag.id, samples]
  );

  useEffect(() => {
    // Ditunda satu tick supaya setState muat-awal tidak sinkron di dalam
    // effect (aturan react-hooks/set-state-in-effect).
    const t = setTimeout(() => void loadMore(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali per tag
  }, [tag.id]);

  // Grafik bawaan: 24 jam terakhir (bucketed — murah walau datanya rapat)
  useEffect(() => {
    let cancelled = false;
    const end = new Date();
    const start = new Date(end.getTime() - 86_400_000);
    scadaApi
      .getHistory([tag.id], start, end)
      .then((res) => {
        if (!cancelled) setDefaultPoints(res.series[0]?.points ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tag.id]);

  /* ── virtualisasi ── */

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setViewH(r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (
      hasMore &&
      !loadingRef.current &&
      el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 40
    ) {
      void loadMore();
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(
    samples.length,
    Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN
  );

  /* ── drag memilih rentang waktu ── */

  function rowIndexAt(clientY: number): number {
    const el = scrollerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top + el.scrollTop) / ROW_H);
    return Math.min(Math.max(idx, 0), Math.max(samples.length - 1, 0));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || samples.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    // Sisakan strip kanan untuk scrollbar native
    if (e.clientX > el.getBoundingClientRect().right - 18) return;
    const idx = rowIndexAt(e.clientY);
    dragAnchor.current = idx;
    setSel({ a: idx, b: idx });
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragAnchor.current === null) return;
    setSel({ a: dragAnchor.current, b: rowIndexAt(e.clientY) });
  }

  function onPointerUp() {
    dragAnchor.current = null;
  }

  const selRange = useMemo(() => {
    if (!sel) return null;
    return { lo: Math.min(sel.a, sel.b), hi: Math.max(sel.a, sel.b) };
  }, [sel]);

  /* ── data grafik + ringkasan ── */

  const chart = useMemo((): {
    rows: ChartRow[];
    stats: { n: number; min: number; max: number; avg: number } | null;
    title: string;
  } => {
    if (selRange && samples.length > 0) {
      // slice desc → balik jadi kronologis untuk grafik
      const slice = samples.slice(selRange.lo, selRange.hi + 1);
      const stride = Math.max(1, Math.ceil(slice.length / MAX_CHART_POINTS));
      const rows: ChartRow[] = [];
      for (let i = slice.length - 1; i >= 0; i -= stride) {
        rows.push({ t: new Date(slice[i].ts).getTime(), v: slice[i].value });
      }
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const s of slice) {
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
        sum += s.value;
      }
      const from = slice[slice.length - 1];
      const to = slice[0];
      return {
        rows,
        stats: { n: slice.length, min, max, avg: sum / slice.length },
        title: `${format(new Date(from.ts), "d MMM HH:mm", { locale: localeId })} – ${format(
          new Date(to.ts),
          "d MMM HH:mm",
          { locale: localeId }
        )} (${slice.length.toLocaleString("id")} baris dipilih)`,
      };
    }
    const rows = (defaultPoints ?? []).map((p) => ({
      t: new Date(p.t).getTime(),
      v: p.avg,
    }));
    return { rows, stats: null, title: "24 jam terakhir" };
  }, [selRange, samples, defaultPoints]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportTagToExcel(tag);
    } catch {
      toast.error("Gagal membuat file Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border-soft px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold text-text">
            Riwayat — {tag.label}
            {tag.unit && (
              <span className="ml-1 font-normal text-text-muted">({tag.unit})</span>
            )}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {tag.device_key} · {tag.source} · data disimpan 90 hari — lebih lama
            ada di arsip Google Drive
          </p>
        </div>
        <button
          onClick={() => void loadMore(true)}
          disabled={loading}
          className="btn btn-ghost btn-sm gap-1.5"
          title="Muat ulang dari data terbaru"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Segarkan
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn btn-secondary btn-sm gap-1.5"
        >
          {exporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Excel
        </button>
        <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm">
          <X className="size-4" />
        </button>
      </div>

      {/* ── 2 kolom ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* KIRI: tabel panjang (virtual + scroll tanpa batas) */}
        <section className="flex min-h-0 flex-1 flex-col border-b border-border-soft lg:max-w-[46%] lg:border-b-0 lg:border-r">
          <div className="flex h-8 shrink-0 items-center border-b border-border-soft bg-bg-sidebar px-4 text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
            <span className="flex-1">Waktu</span>
            <span className="text-right">
              Nilai{tag.unit ? ` (${tag.unit})` : ""}
            </span>
          </div>
          {!initialLoaded ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-text-light" />
            </div>
          ) : samples.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12px] text-text-muted">
              Belum ada data tersimpan untuk sensor ini.
            </p>
          ) : (
            <div
              ref={scrollerRef}
              onScroll={onScroll}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="min-h-0 flex-1 select-none overflow-y-auto"
              style={{ cursor: "crosshair" }}
            >
              <div className="relative" style={{ height: samples.length * ROW_H }}>
                {samples.slice(start, end).map((s, i) => {
                  const idx = start + i;
                  const selected =
                    selRange !== null && idx >= selRange.lo && idx <= selRange.hi;
                  return (
                    <div
                      key={s.ts}
                      className={cn(
                        "absolute inset-x-0 flex items-center border-b border-border-soft px-4 text-[12px]",
                        selected ? "bg-primary/10" : idx % 2 === 1 && "bg-bg-sidebar/40"
                      )}
                      style={{ top: idx * ROW_H, height: ROW_H }}
                    >
                      <span className="flex-1 truncate text-text-muted">
                        {format(new Date(s.ts), "d MMM yyyy, HH:mm:ss", {
                          locale: localeId,
                        })}
                      </span>
                      <span className="font-medium tabular-nums text-text">
                        {s.value.toLocaleString("id")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border-soft px-4 text-[10.5px] text-text-light">
            {loading && <Loader2 className="size-3 animate-spin" />}
            <span className="min-w-0 flex-1 truncate">
              {samples.length.toLocaleString("id")} baris dimuat
              {hasMore
                ? " — scroll ke bawah untuk memuat data lebih lama"
                : " — semua data sudah dimuat"}
            </span>
            <span className="hidden shrink-0 sm:block">
              drag di tabel = pilih rentang untuk grafik
            </span>
          </div>
        </section>

        {/* KANAN: grafik rentang terpilih + ringkasan */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-bg-sidebar px-4">
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-text-muted">
              Grafik — {chart.title}
            </span>
            {selRange && (
              <button
                type="button"
                onClick={() => setSel(null)}
                className="btn btn-ghost btn-sm gap-1"
                title="Hapus pilihan — kembali ke 24 jam terakhir"
              >
                <XCircle className="size-3" /> Bersihkan
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 p-3">
            {chart.rows.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                {defaultPoints === null
                  ? "Memuat grafik…"
                  : "Tidak ada data pada rentang ini."}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--rein-border-soft)" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t: number) =>
                      format(new Date(t), "d MMM HH:mm", { locale: localeId })
                    }
                    tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
                    stroke="var(--rein-border)"
                  />
                  <YAxis
                    width={54}
                    tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
                    stroke="var(--rein-border)"
                    tickFormatter={(v: number) => v.toLocaleString("id")}
                  />
                  <Tooltip
                    labelFormatter={(t) =>
                      format(new Date(Number(t)), "d MMM yyyy, HH:mm:ss", {
                        locale: localeId,
                      })
                    }
                    formatter={(v) => [
                      `${Number(v).toLocaleString("id")}${tag.unit ? ` ${tag.unit}` : ""}`,
                      tag.label,
                    ]}
                    contentStyle={{
                      background: "var(--rein-bg)",
                      border: "1px solid var(--rein-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="v"
                    stroke="var(--rnet-chart-1)"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {chart.stats && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border-soft px-4 py-2 text-[11.5px] text-text-muted">
              <span>
                Baris:{" "}
                <span className="font-semibold tabular-nums text-text">
                  {chart.stats.n.toLocaleString("id")}
                </span>
              </span>
              <span>
                Min:{" "}
                <span className="font-semibold tabular-nums text-text">
                  {chart.stats.min.toLocaleString("id")}
                </span>
              </span>
              <span>
                Rata²:{" "}
                <span className="font-semibold tabular-nums text-text">
                  {chart.stats.avg.toLocaleString("id", { maximumFractionDigits: 2 })}
                </span>
              </span>
              <span>
                Maks:{" "}
                <span className="font-semibold tabular-nums text-text">
                  {chart.stats.max.toLocaleString("id")}
                </span>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
