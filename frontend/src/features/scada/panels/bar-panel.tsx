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
import type { BarMetric, BarPanelConfig, SummaryItem, Tag } from "../types";
import { RANGE_LABELS, RANGE_MS } from "./chart-panel";
import { usePanelRefresh } from "./use-panel-refresh";

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

export function BarPanel({ config, tags }: { config: BarPanelConfig; tags: Tag[] }) {
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

  const rows: Row[] = useMemo(() => {
    if (!items) return [];
    return items
      .map((item) => ({
        label: item.label,
        unit: item.unit || tags.find((t) => t.id === item.tag_id)?.unit || "",
        value: item[config.metric],
      }))
      .filter((r): r is Row => r.value !== null)
      .sort((a, b) => b.value - a.value);
  }, [items, tags, config.metric]);

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

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="px-3 pt-1.5 text-[10.5px] text-text-muted">
        {METRIC_LABELS[config.metric]} · {RANGE_LABELS[config.range]} terakhir
      </div>
      <div className="min-h-0 flex-1 px-1 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 0, left: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--rein-border-soft)" />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--rein-border)" }}
              tickFormatter={(v: number) => v.toLocaleString("id")}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={110}
              tick={{ fontSize: 11, fill: "var(--rein-text-muted)" }}
              tickLine={false}
              axisLine={false}
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
              fill="var(--rnet-chart-1)"
              barSize={18}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) =>
                  typeof v === "number" ? v.toLocaleString("id") : String(v ?? "")
                }
                style={{ fontSize: 10.5, fill: "var(--rein-text-muted)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
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
