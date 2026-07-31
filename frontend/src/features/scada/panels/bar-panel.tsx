"use client";

/** Bar panel — comparison across tags ("plant 1 vs plant 2").
 *  Sorted descending, one hue (one measure = one color; identity lives in the
 *  row labels), value labels on the bars, tooltip shows % vs the leader and
 *  vs the average — the honest replacement for a pie chart. */

import { useCallback, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTagLiveValues } from "../store";
import type { BarMetric, BarPanelConfig, SummaryItem, Tag } from "../types";
import { RANGE_LABELS, RANGE_MS } from "./chart-panel";
import { getSummaryItems } from "./summary-batch";
import { usePanelRefresh } from "./use-panel-refresh";
import { LayoutItem, LayoutSurface } from "./layout-box";
import {
  PanelPlaceholder,
  formatValue,
  layoutMap,
  resolveDecimals,
} from "./elements";

export const METRIC_LABELS: Record<BarMetric, string> = {
  avg: "Rata-rata",
  last: "Terkini",
  min: "Minimum",
  max: "Maksimum",
};

interface Row {
  label: string;
  unit: string;
  value: number;
  /** Angka di belakang koma sensor ini — tiap batang boleh beda presisi. */
  decimals: number | null;
}

export function BarPanel({
  config,
  tags,
  title,
}: {
  config: BarPanelConfig;
  tags: Tag[];
  /** Judul panel/channel — isi elemen "Judul" di kanvas komponen. */
  title?: string;
}) {
  const [items, setItems] = useState<SummaryItem[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (config.tag_ids.length === 0) return;
    try {
      setItems(await getSummaryItems(config.tag_ids, RANGE_MS[config.range]));
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_ids, config.range]);

  usePanelRefresh(load);

  // "Terkini" harus benar-benar terkini: nilai realtime dari store menimpa
  // snapshot ringkasan (yang hanya disegarkan tiap satu putaran refresh).
  // Min/rata²/maks tetap dari snapshot — itu memang agregat rentang.
  const liveValues = useTagLiveValues(config.tag_ids);

  const unconfigured = config.tag_ids.length === 0;

  const rows: Row[] = useMemo(() => {
    if (!items) return [];
    return items
      .map((item) => {
        const live = liveValues[item.tag_id];
        const liveNewer =
          config.metric === "last" &&
          live &&
          (!item.last_ts ||
            new Date(live.ts).getTime() > new Date(item.last_ts).getTime());
        const tag = tags.find((t) => t.id === item.tag_id);
        return {
          label: item.label,
          unit: item.unit || tag?.unit || "",
          value: liveNewer ? live!.value : item[config.metric],
          decimals: resolveDecimals(config.decimals, tag?.config),
        };
      })
      .filter((r): r is Row => r.value !== null)
      .sort((a, b) => b.value - a.value);
  }, [items, tags, config.metric, config.decimals, liveValues]);

  if (unconfigured) {
    return (
      <PanelPlaceholder icon={BarChart3}>
        Bar belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
        untuk memilih sensor.
      </PanelPlaceholder>
    );
  }
  if (error && !items) {
    return <PanelPlaceholder>Gagal memuat perbandingan — mencoba lagi…</PanelPlaceholder>;
  }
  if (items === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <PanelPlaceholder icon={BarChart3}>Belum ada data pada rentang {RANGE_LABELS[config.range]}.</PanelPlaceholder>;
  }

  const top = rows[0].value;
  const mean = rows.reduce((s, r) => s + r.value, 0) / rows.length;
  // "vertical" = batang tegak (recharts layout "horizontal"); bawaan mendatar
  const upright = config.orientation === "vertical";
  const barFill = config.color ?? "var(--rnet-chart-1)";
  // Sumbu dan label batang berbagi satu skala, jadi satu presisi: setelan panel
  // dulu, kalau kosong ikut sensor teratas.
  const axisDec = resolveDecimals(config.decimals, undefined) ?? rows[0].decimals;
  const el = layoutMap("bar", config.elements, config.layout);

  return (
    <LayoutSurface>
      {el.title?.visible && title && (
        <LayoutItem box={el.title.box} className="font-semibold text-text-muted">
          {title}
        </LayoutItem>
      )}

      {el.footer?.visible && (
        <LayoutItem box={el.footer.box} className="px-[0.6em] text-text-muted">
          {METRIC_LABELS[config.metric]} · {RANGE_LABELS[config.range]} terakhir
        </LayoutItem>
      )}

      {el.graphic?.visible && (
        <LayoutItem box={el.graphic.box} text={false}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout={upright ? "horizontal" : "vertical"}
            margin={
              upright
                ? { top: 20, right: 12, bottom: 0, left: 0 }
                : { top: 4, right: 48, bottom: 0, left: 8 }
            }
          >
            <CartesianGrid
              horizontal={upright}
              vertical={!upright}
              stroke="var(--rein-border-soft)"
            />
            <XAxis
              type={upright ? "category" : "number"}
              dataKey={upright ? "label" : undefined}
              tick={{
                fontSize: upright ? 11 : 10,
                fill: upright ? "var(--rein-text-muted)" : "var(--rein-text-light)",
              }}
              tickLine={false}
              axisLine={{ stroke: "var(--rein-border)" }}
              tickFormatter={upright ? undefined : (v: number) => formatValue(v, axisDec)}
              interval={upright ? 0 : undefined}
            />
            <YAxis
              type={upright ? "number" : "category"}
              dataKey={upright ? undefined : "label"}
              width={upright ? 42 : 110}
              tick={{
                fontSize: upright ? 10 : 11,
                fill: upright ? "var(--rein-text-light)" : "var(--rein-text-muted)",
              }}
              tickLine={false}
              axisLine={false}
              tickFormatter={upright ? (v: number) => formatValue(v, axisDec) : undefined}
            />
            <Tooltip
              cursor={{ fill: "var(--rein-bg-hover)" }}
              contentStyle={{
                background: "var(--rein-bg)",
                border: "1px solid var(--rein-border)",
                borderRadius: "var(--r)",
                fontSize: 11,
                color: "var(--rein-text)",
              }}
              formatter={(value, _name, entry) => {
                const v = typeof value === "number" ? value : Number(value);
                const row = entry?.payload as Row | undefined;
                const parts = [
                  `${formatValue(v, row?.decimals ?? axisDec)}${row?.unit ? ` ${row.unit}` : ""}`,
                ];
                if (top > 0 && v !== top)
                  parts.push(`${(((v - top) / top) * 100).toFixed(1)}% vs teratas`);
                if (mean !== 0)
                  parts.push(
                    `${v >= mean ? "+" : ""}${(((v - mean) / Math.abs(mean)) * 100).toFixed(1)}% vs rata²`
                  );
                return [parts.join(" · "), METRIC_LABELS[config.metric]];
              }}
            />
            <Bar
              dataKey="value"
              fill={barFill}
              barSize={upright ? 28 : 18}
              radius={upright ? [4, 4, 0, 0] : [0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position={upright ? "top" : "right"}
                formatter={(v) =>
                  typeof v === "number" ? formatValue(v, axisDec) : String(v ?? "")
                }
                style={{ fontSize: 10.5, fill: "var(--rein-text-muted)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </LayoutItem>
      )}
    </LayoutSurface>
  );
}

