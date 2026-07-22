"use client";

/** Historian table panel — latest value + min/avg/max per tag over the
 *  configured range. The classic SCADA overview widget.
 *
 *  Isi & urutan kolomnya diatur user lewat editor kolom di inspector
 *  (config.columns) — kolom yang tak dipilih tidak dirender sama sekali. */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "../store";
import type { SummaryItem, Tag, TableColumn, TablePanelConfig } from "../types";
import { RANGE_LABELS, RANGE_MS } from "./chart-panel";
import { usePanelRefresh } from "./use-panel-refresh";

/** Kolom yang tersedia + label headernya. Urutan di sini = urutan bawaan
 *  saat user menambahkan kolom lewat editor. */
export const TABLE_COLUMNS: { key: TableColumn; label: string }[] = [
  { key: "tag", label: "Tag" },
  { key: "device", label: "Perangkat" },
  { key: "unit", label: "Satuan" },
  { key: "value", label: "Terkini" },
  { key: "min", label: "Min" },
  { key: "avg", label: "Rata²" },
  { key: "max", label: "Maks" },
];

export const TABLE_COLUMNS_DEFAULT: TableColumn[] = [
  "tag",
  "value",
  "min",
  "avg",
  "max",
];

/** Kolom teks rata kiri; sisanya angka rata kanan. */
const TEXT_COLUMNS = new Set<TableColumn>(["tag", "device", "unit"]);

function fmt(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("id");
}

export function TablePanel({ config, tags }: { config: TablePanelConfig; tags: Tag[] }) {
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

  // Live overlay: "Terkini" ticks in realtime from the store; min/rata/maks
  // stay on the summary snapshot (they're range aggregates).
  const liveValues = useScadaStore((s) => s.liveValues);

  const tagOf = useMemo(() => {
    const map = new Map(tags.map((t) => [t.id, t]));
    return (item: SummaryItem) => map.get(item.tag_id);
  }, [tags]);

  const lastOf = (item: SummaryItem): number | null => {
    const live = liveValues[item.tag_id];
    if (
      live &&
      (!item.last_ts || new Date(live.ts).getTime() > new Date(item.last_ts).getTime())
    ) {
      return live.value;
    }
    return item.last;
  };

  if (config.tag_ids.length === 0) {
    return <Center icon>Belum ada tag dipilih untuk tabel ini.</Center>;
  }
  if (error && !items) {
    return <Center>Gagal memuat ringkasan — mencoba lagi…</Center>;
  }
  if (items === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }
  if (items.length === 0) {
    return <Center>Tag tidak ditemukan (mungkin dinonaktifkan).</Center>;
  }

  const columns = (config.columns ?? TABLE_COLUMNS_DEFAULT).filter((c) =>
    TABLE_COLUMNS.some((t) => t.key === c)
  );
  if (columns.length === 0) {
    return <Center icon>Semua kolom disembunyikan — pilih minimal satu.</Center>;
  }
  const showAggregate = columns.some((c) => c === "min" || c === "avg" || c === "max");

  const cell = (col: TableColumn, item: SummaryItem) => {
    const tag = tagOf(item);
    const unit = item.unit || tag?.unit || "";
    switch (col) {
      case "tag":
        return (
          <>
            {item.label}
            {/* Satuan menempel di nama HANYA kalau tak ada kolom Satuan sendiri */}
            {unit && !columns.includes("unit") && (
              <span className="ml-1 text-[10.5px] font-normal text-text-light">
                {unit}
              </span>
            )}
          </>
        );
      case "device":
        return (
          <span className="font-mono text-[11px] text-text-muted">
            {tag?.device_key ?? "—"}
          </span>
        );
      case "unit":
        return <span className="text-text-muted">{unit || "—"}</span>;
      case "value":
        return fmt(lastOf(item));
      default:
        return fmt(item[col]);
    }
  };

  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <table className="w-full border-collapse text-[12px]">
        {config.show_header !== false && (
          <thead className="sticky top-0 bg-bg-sidebar">
            <tr className="text-[10.5px] uppercase tracking-wide text-text-light">
              {columns.map((col) => (
                <th
                  key={col}
                  className={cn(
                    "px-2 py-1.5 font-semibold",
                    TEXT_COLUMNS.has(col) ? "text-left" : "text-right"
                  )}
                >
                  {TABLE_COLUMNS.find((t) => t.key === col)?.label ?? col}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {items.map((item) => (
            <tr key={item.tag_id} className="border-t border-border-soft">
              {columns.map((col) => (
                <td
                  key={col}
                  className={cn(
                    "px-2 py-1.5",
                    col === "tag" && "max-w-0 truncate font-medium text-text",
                    col === "value" && "font-semibold tabular-nums text-text",
                    (col === "min" || col === "avg" || col === "max") &&
                      "tabular-nums text-text-muted",
                    TEXT_COLUMNS.has(col) ? "text-left" : "text-right"
                  )}
                >
                  {cell(col, item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {config.show_footer !== false && showAggregate && (
        <div className="px-3 py-1 text-[10px] text-text-light">
          Min/Rata²/Maks dihitung dari {RANGE_LABELS[config.range]} terakhir
        </div>
      )}
    </div>
  );
}

function Center({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <Table2 className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
