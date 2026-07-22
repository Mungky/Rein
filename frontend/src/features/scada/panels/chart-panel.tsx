"use client";

/** Historian chart panel — bucketed avg lines per tag (recharts).
 *
 *  Series colors come from the fixed --rnet-chart-N slots (CVD-validated set
 *  in globals.css; assigned by position in config.tag_ids, never cycled).
 *  Auto-refreshes every 60s (sampler cadence) and re-fetches when the tab
 *  becomes visible again. Min/max band renders only for single-tag charts —
 *  with multiple series it is unreadable clutter. */

import { useCallback, useMemo, useState } from "react";
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
import { useScadaStore } from "../store";
import type { ChartPanelConfig, ChartRange, HistorySeries, Tag } from "../types";
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
const RANGE_POINTS: Record<ChartRange, number> = {
  "1h": 600,
  "6h": 480,
  "24h": 360,
  "7d": 300,
  "30d": 300,
};

const SERIES_COLORS = [1, 2, 3, 4].map((n) => `var(--rnet-chart-${n})`);

/** Warna garis ke-i: pilihan user (config.colors) menang, slot bawaan menyusul. */
export function seriesColor(config: ChartPanelConfig, i: number): string {
  return config.colors?.[i] ?? SERIES_COLORS[i % SERIES_COLORS.length];
}

type Row = Record<string, number | [number, number]> & { t: number };

function buildRows(series: HistorySeries[], showBand: boolean): Row[] {
  const byTime = new Map<number, Row>();
  for (const s of series) {
    for (const p of s.points) {
      const t = new Date(p.t).getTime();
      let row = byTime.get(t);
      if (!row) {
        row = { t } as Row;
        byTime.set(t, row);
      }
      row[s.tag_id] = p.avg;
      if (showBand) row[`${s.tag_id}:band`] = [p.min, p.max];
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function ChartPanel({ config, tags }: { config: ChartPanelConfig; tags: Tag[] }) {
  const [series, setSeries] = useState<HistorySeries[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (config.tag_ids.length === 0) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - RANGE_MS[config.range]);
      const res = await scadaApi.getHistory(
        config.tag_ids,
        start,
        end,
        RANGE_POINTS[config.range]
      );
      // Keep the order the user picked — slot color follows the tag, not rank
      const byId = new Map(res.series.map((s) => [s.tag_id, s]));
      setSeries(config.tag_ids.map((id) => byId.get(id)).filter(Boolean) as HistorySeries[]);
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_ids, config.range]);

  usePanelRefresh(load);

  // Live tail: SEMUA titik realtime sesi ini (liveBuffers) yang lebih baru
  // dari bucket riwayat terakhir ikut digambar. Dulu hanya satu titik terakhir
  // yang ditempel, jadi antara dua pengambilan riwayat garisnya melompat dari
  // bucket lama ke satu titik hidup — terlihat patah, bukan mengalir.
  const liveBuffers = useScadaStore((s) => s.liveBuffers);

  const showBand = config.show_minmax && config.tag_ids.length === 1;
  const rows = useMemo(() => {
    const base = buildRows(series ?? [], showBand);
    if (base.length === 0) return base;
    const lastT = base[base.length - 1].t;
    const extras = new Map<number, Row>();
    for (const tagId of config.tag_ids) {
      for (const point of liveBuffers[tagId] ?? []) {
        const t = new Date(point.ts).getTime();
        if (t <= lastT) continue;
        let row = extras.get(t);
        if (!row) {
          row = { t } as Row;
          extras.set(t, row);
        }
        row[tagId] = point.value;
      }
    }
    return [...base, ...[...extras.values()].sort((a, b) => a.t - b.t)];
  }, [series, showBand, liveBuffers, config.tag_ids]);

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

  if (config.tag_ids.length === 0) {
    return (
      <Empty icon>
        Grafik belum diatur — buka mode Atur Layout lalu klik dua kali panel
        ini untuk memilih sensor.
      </Empty>
    );
  }
  if (error && !series) {
    return <Empty>Gagal memuat riwayat — mencoba lagi…</Empty>;
  }
  if (series === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <Empty>Belum ada data pada rentang {RANGE_LABELS[config.range]}.</Empty>;
  }

  // Bawaan "linear" — persis tampilan lama; smooth/step adalah opsi baru.
  const lineType =
    config.line_style === "smooth"
      ? "monotone"
      : config.line_style === "step"
        ? "stepAfter"
        : "linear";

  return (
    <div className="flex h-full w-full flex-col bg-bg">
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
              tickFormatter={(v: number) => v.toLocaleString("id")}
            />
            <Tooltip
              cursor={{ stroke: "var(--rein-text-light)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--rein-bg)",
                border: "1px solid var(--rein-border)",
                borderRadius: "var(--r)",
                fontSize: 11,
                color: "var(--rein-text)",
              }}
              labelStyle={{ color: "var(--rein-text-muted)", fontSize: 10.5 }}
              labelFormatter={(t) =>
                typeof t === "number"
                  ? format(t, "d MMM yyyy, HH:mm", { locale: localeId })
                  : String(t)
              }
              formatter={(value, name) => [
                typeof value === "number" ? value.toLocaleString("id") : String(value),
                name,
              ]}
            />
            {showBand && (
              <Area
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
    </div>
  );
}

function Empty({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <TrendingUp className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
