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
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "../store";
import type { BarMetric, BarPanelConfig, SummaryItem, Tag } from "../types";
import { RANGE_LABELS, RANGE_MS } from "./chart-panel";
import { usePanelRefresh } from "./use-panel-refresh";
import { LayoutItem, LayoutSurface } from "./layout-box";
import { layoutMap } from "./elements";

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
      const end = new Date();
      const start = new Date(end.getTime() - RANGE_MS[config.range]);
      const res = await scadaApi.getSummary(config.tag_ids, start, end);
      setItems(res.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, [config.tag_ids, config.range]);

  usePanelRefresh(load);

  // "Terkini" harus benar-benar terkini: nilai realtime dari store menimpa
  // snapshot ringkasan (yang hanya disegarkan tiap satu putaran refresh).
  // Min/rata²/maks tetap dari snapshot — itu memang agregat rentang.
  const liveValues = useScadaStore((s) => s.liveValues);

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
        return {
          label: item.label,
          unit: item.unit || tags.find((t) => t.id === item.tag_id)?.unit || "",
          value: liveNewer ? live!.value : item[config.metric],
        };
      })
      .filter((r): r is Row => r.value !== null)
      .sort((a, b) => b.value - a.value);
  }, [items, tags, config.metric, liveValues]);

  if (unconfigured) {
    return (
      <Center icon>
        Bar belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
        untuk memilih sensor.
      </Center>
    );
  }
  if (error && !items) {
    return <Center>Gagal memuat perbandingan — mencoba lagi…</Center>;
  }
  if (items === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <Center icon>Belum ada data pada rentang {RANGE_LABELS[config.range]}.</Center>;
  }

  const top = rows[0].value;
  const mean = rows.reduce((s, r) => s + r.value, 0) / rows.length;
  // "vertical" = batang tegak (recharts layout "horizontal"); bawaan mendatar
  const upright = config.orientation === "vertical";
  const barFill = config.color ?? "var(--rnet-chart-1)";
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
              tickFormatter={
                upright ? undefined : (v: number) => v.toLocaleString("id")
              }
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
              tickFormatter={
                upright ? (v: number) => v.toLocaleString("id") : undefined
              }
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
                  `${v.toLocaleString("id")}${row?.unit ? ` ${row.unit}` : ""}`,
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
                  typeof v === "number" ? v.toLocaleString("id") : String(v ?? "")
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

function Center({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <BarChart3 className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
