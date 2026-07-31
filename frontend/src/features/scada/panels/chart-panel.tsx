"use client";

/** Historian chart panel — bucketed avg lines per tag (recharts).
 *
 *  Series colors come from the fixed --rnet-chart-N slots (CVD-validated set
 *  in globals.css; assigned by position in config.tag_ids, never cycled).
 *  Auto-refreshes every 60s (sampler cadence) and re-fetches when the tab
 *  becomes visible again. Min/max band renders only for single-tag charts —
 *  with multiple series it is unreadable clutter. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Loader2, TrendingUp } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { scadaApi } from "@/lib/api/scada";
import { useTagLiveBuffers } from "../store";
import { withLiveTail } from "../analysis/live-tail";
import type { ChartPanelConfig, ChartRange, HistorySeries, Tag } from "../types";
import {
  PanelPlaceholder,
  formatValue,
  resolveDecimals,
} from "./elements";
import { usePanelRefresh } from "./use-panel-refresh";

export const RANGE_MS: Record<ChartRange, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

export const RANGE_LABELS: Record<ChartRange, string> = {
  "1h": "1 jam",
  "6h": "6 jam",
  "24h": "24 jam",
  "7d": "7 hari",
  "30d": "30 hari",
};

/** Jatah titik per rentang. Rentang pendek diberi jatah besar supaya ukuran
 *  bucket-nya turun ke hitungan detik (1 jam ÷ 600 = 6 detik) — sensor
 *  ber-interval 3 detik jadi tergambar mengalir, bukan tangga per menit.
 *  Rentang panjang tetap hemat: jatahnya kecil, jadi datanya tidak membengkak. */
export const RANGE_POINTS: Record<ChartRange, number> = {
  "1h": 600,
  "6h": 480,
  "24h": 360,
  "7d": 300,
  "30d": 300,
};

/** Jarak antar titik dalam piksel, per Gaya Garis.
 *
 *  Ini akar "Gaya Garis diubah tapi grafiknya tidak berubah". Setelannya SUDAH
 *  sampai ke recharts dengan benar — yang salah adalah kepadatan titiknya:
 *  panel selebar ~760 px diberi jatah mati 360 titik, jadi 2 px per titik.
 *  Pada jarak 2 px tidak ada ruang untuk melengkung maupun menyiku, sehingga
 *  patah, halus, dan tangga menggambar lintasan yang sama persis.
 *
 *  Maka kepadatan sekarang mengikuti lebar panel DAN gaya yang dipilih:
 *  bentuk garis itu keputusan visual, jadi wajar kalau ia yang menentukan
 *  seberapa renggang titiknya perlu berdiri agar bentuknya terbaca.
 *
 *    Patah  — serapat yang masih berguna; 4 px sudah 1 titik per 4 piksel,
 *             lebih dari itu cuma menumpuk titik di belakang titik.
 *    Halus  — kurva perlu jarak; di bawah ~10 px pembulatan sudutnya tak
 *             terlihat dan hasilnya kembali menyerupai garis patah.
 *    Tangga — tapak tangganya harus selebar mata bisa melihatnya sebagai tapak.
 */
const PX_PER_POINT: Record<NonNullable<ChartPanelConfig["line_style"]>, number> = {
  linear: 4,
  smooth: 10,
  step: 10,
};

/** Cukup untuk tetap terbaca sebagai tren di panel paling sempit. */
const MIN_POINTS = 40;

/** Lebar dibulatkan ke kelipatan tetap supaya menyeret gagang ukuran panel
 *  tidak memicu pengambilan riwayat baru di setiap piksel. */
const WIDTH_STEP = 120;

export function pointBudget(
  width: number,
  range: ChartRange,
  lineStyle: ChartPanelConfig["line_style"]
): number {
  const cap = RANGE_POINTS[range];
  // Belum terukur (paint pertama) — pakai jatah penuh, biar tidak ada grafik
  // yang lahir kasar lalu diam-diam diperbaiki.
  if (!Number.isFinite(width) || width <= 0) return cap;
  const px = PX_PER_POINT[lineStyle ?? "linear"] ?? PX_PER_POINT.linear;
  const stepped = Math.max(WIDTH_STEP, Math.round(width / WIDTH_STEP) * WIDTH_STEP);
  return Math.min(cap, Math.max(MIN_POINTS, Math.round(stepped / px)));
}

const SERIES_COLORS = [1, 2, 3, 4].map((n) => `var(--rnet-chart-${n})`);

/** Gaya + pemformatan tooltip grafik, dipakai bersama.
 *
 *  Diekspor supaya grafik di dropdown tab Data (analysis/tag-chart.tsx) terasa
 *  identik dengan yang di Monitor. Menyalinnya ke sana akan bekerja hari ini
 *  lalu perlahan menyimpang — dan dua tooltip yang HAMPIR sama justru lebih
 *  membingungkan daripada dua yang jelas berbeda. */
export const chartTooltipProps = {
  cursor: { stroke: "var(--rein-text-light)", strokeWidth: 1 },
  contentStyle: {
    background: "var(--rein-bg)",
    border: "1px solid var(--rein-border)",
    borderRadius: "var(--r)",
    fontSize: 11,
    color: "var(--rein-text)",
  },
  labelStyle: { color: "var(--rein-text-muted)", fontSize: 10.5 },
  labelFormatter: (t: unknown) =>
    typeof t === "number"
      ? format(t, "d MMM yyyy, HH:mm", { locale: localeId })
      : String(t),
} as const;

/** Warna garis ke-i: pilihan user (config.colors) menang, slot bawaan menyusul. */
export function seriesColor(config: ChartPanelConfig, i: number): string {
  return config.colors?.[i] ?? SERIES_COLORS[i % SERIES_COLORS.length];
}

type Row = Record<string, number | [number, number]> & { t: number };

/** Deret historis + ekor live, digabung per waktu jadi baris recharts.
 *
 *  Ekornya lewat withLiveTail (analysis/live-tail.ts) — versi yang sudah benar,
 *  yang sebelumnya hanya dipakai tab Data. Panel Monitor punya salinan
 *  ketiganya sendiri yang menempelkan titik live APA ADANYA, jadi 23 jam
 *  pertama digambar sebagai rata-rata per bucket dan beberapa menit terakhir
 *  sebagai nilai per detik. Terbaca seperti sensor yang mendadak tidak stabil,
 *  padahal yang berubah cuma penggambarnya — bug yang sudah didokumentasikan di
 *  live-tail.ts sejak awal, tapi tetap hidup di setiap grafik Monitor. */
function buildRows(
  series: HistorySeries[],
  showBand: boolean,
  liveBuffers: Record<string, { ts: string; value: number }[]>
): Row[] {
  const byTime = new Map<number, Row>();
  const put = (t: number, key: string, v: number | [number, number]) => {
    let row = byTime.get(t);
    if (!row) {
      row = { t } as Row;
      byTime.set(t, row);
    }
    row[key] = v;
  };

  for (const s of series) {
    for (const p of s.points) {
      const t = new Date(p.t).getTime();
      put(t, s.tag_id, p.avg);
      if (showBand) put(t, `${s.tag_id}:band`, [p.min, p.max]);
    }
    const hist = s.points.map((p) => ({ ts: p.t, value: p.avg }));
    const tailed = withLiveTail(hist, liveBuffers[s.tag_id] ?? []);
    // withLiveTail mengembalikan histori + ekor yang sudah di-bucket; yang baru
    // hanyalah bagian setelah panjang histori aslinya.
    for (const pt of tailed.slice(hist.length)) {
      put(new Date(pt.ts).getTime(), s.tag_id, pt.value);
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function ChartPanel({ config, tags }: { config: ChartPanelConfig; tags: Tag[] }) {
  const [series, setSeries] = useState<HistorySeries[] | null>(null);
  const [error, setError] = useState(false);

  // Lebar panel menentukan berapa titik yang layak diminta — lihat PX_PER_POINT.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      // Simpan hanya lompatan yang mengubah jatah titik; kalau tidak, setiap
      // piksel gerakan akan memicu render dan pengambilan riwayat baru.
      setWidth((prev) =>
        pointBudget(prev, config.range, config.line_style) ===
        pointBudget(w, config.range, config.line_style)
          ? prev
          : w
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [config.range, config.line_style]);

  const points = pointBudget(width, config.range, config.line_style);

  const load = useCallback(async () => {
    if (config.tag_ids.length === 0) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - RANGE_MS[config.range]);
      const res = await scadaApi.getHistory(config.tag_ids, start, end, points);
      // Keep the order the user picked — slot color follows the tag, not rank
      const byId = new Map(res.series.map((s) => [s.tag_id, s]));
      setSeries(config.tag_ids.map((id) => byId.get(id)).filter(Boolean) as HistorySeries[]);
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_ids, config.range, points]);

  usePanelRefresh(load);

  // Ekor live sesi ini, per tag panel ini saja (bukan seluruh peta buffer).
  const liveBuffers = useTagLiveBuffers(config.tag_ids);

  const showBand = config.show_minmax && config.tag_ids.length === 1;
  const rows = useMemo(
    () => buildRows(series ?? [], showBand, liveBuffers),
    [series, showBand, liveBuffers]
  );

  const tagLabel = (tagId: string, i: number) => {
    const s = series?.find((x) => x.tag_id === tagId);
    const tag = tags.find((t) => t.id === tagId);
    const label = s?.label ?? tag?.label ?? `Tag ${i + 1}`;
    const unit = s?.unit ?? tag?.unit ?? "";
    return unit ? `${label} (${unit})` : label;
  };

  const shortTime = (t: number) =>
    config.range === "7d" || config.range === "30d"
      ? format(t, "d MMM", { locale: localeId })
      : format(t, "HH:mm");

  const decimalsByTag = useMemo(
    () =>
      new Map(
        config.tag_ids.map((id) => [
          id,
          resolveDecimals(config.decimals, tags.find((t) => t.id === id)?.config),
        ])
      ),
    [config.tag_ids, config.decimals, tags]
  );
  // Sumbu Y itu satu skala untuk semua deret, jadi satu presisi: setelan panel
  // dulu, kalau kosong ikut sensor pertama.
  const axisDec =
    resolveDecimals(config.decimals, undefined) ??
    decimalsByTag.get(config.tag_ids[0] ?? "") ??
    null;

  // Bawaan "linear" — persis tampilan lama; smooth/step adalah opsi baru.
  const lineType =
    config.line_style === "smooth"
      ? "monotone"
      : config.line_style === "step"
        ? "stepAfter"
        : "linear";

  const chart = (
    <>
      {/* Legend — identity via swatch + text (text stays in ink tokens) */}
      {config.tag_ids.length > 1 && config.show_legend !== false && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pt-1.5">
          {config.tag_ids.map((tagId, i) => (
            <span key={tagId} className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
              <span
                className="inline-block h-[3px] w-3.5 rounded-full"
                style={{ background: seriesColor(config, i) }}
              />
              {tagLabel(tagId, i)}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 px-1 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {config.show_grid !== false && (
              <CartesianGrid vertical={false} stroke="var(--rein-border-soft)" />
            )}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={shortTime}
              tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--rein-border)" }}
              minTickGap={40}
            />
            <YAxis
              width={42}
              domain={[
                config.y_min ?? "auto",
                config.y_max ?? "auto",
              ]}
              tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatValue(v, axisDec)}
            />
            <Tooltip
              {...chartTooltipProps}
              formatter={(value, name, item) => {
                // dataKey = tag id, jadi tiap deret tampil dengan presisinya
                // sendiri walau berbagi satu sumbu Y.
                const key = String(item?.dataKey ?? "").replace(/:band$/, "");
                return [
                  typeof value === "number"
                    ? formatValue(value, decimalsByTag.get(key) ?? axisDec)
                    : String(value),
                  name,
                ];
              }}
            />
            {showBand && (
              <Area
                // Pita harus melengkung/menyiku sama dengan garisnya. Dulu
                // pita selalu lurus, jadi memilih "Tangga" menghasilkan garis
                // bertangga di atas pita yang miring — terlihat tidak nyambung.
                type={lineType}
                dataKey={`${config.tag_ids[0]}:band`}
                stroke="none"
                fill={seriesColor(config, 0)}
                fillOpacity={0.12}
                isAnimationActive={false}
                name="Min–Maks"
              />
            )}
            {config.tag_ids.map((tagId, i) => (
              <Line
                key={tagId}
                type={lineType}
                dataKey={tagId}
                name={tagLabel(tagId, i)}
                stroke={seriesColor(config, i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );

  // Wadah ber-ref dipasang di SEMUA keadaan, termasuk saat memuat dan saat
  // kosong. Kalau ref-nya hanya ada di jalur sukses, lebar panel baru terukur
  // setelah riwayat pertama tiba — jadi setiap grafik akan mengunduh jatah
  // penuh sekali lalu mengunduh ulang dengan jatah yang benar.
  const body = (() => {
    if (config.tag_ids.length === 0) {
      return (
        <PanelPlaceholder icon={TrendingUp}>
          Grafik belum diatur — buka mode Atur Layout lalu klik dua kali panel
          ini untuk memilih sensor.
        </PanelPlaceholder>
      );
    }
    if (error && !series) {
      return <PanelPlaceholder>Gagal memuat riwayat — mencoba lagi…</PanelPlaceholder>;
    }
    if (series === null) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-text-light" />
        </div>
      );
    }
    if (rows.length === 0) {
      return <PanelPlaceholder>Belum ada data pada rentang {RANGE_LABELS[config.range]}.</PanelPlaceholder>;
    }
    return chart;
  })();

  return (
    <div ref={boxRef} className="flex h-full w-full flex-col bg-bg">
      {body}
    </div>
  );
}

