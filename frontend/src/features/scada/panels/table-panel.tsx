"use client";

/** Historian table panel — latest value + min/avg/max per tag over the
 *  configured range. The classic SCADA overview widget. */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Table2 } from "lucide-react";
import { scadaApi } from "@/lib/api/scada";
import type { SummaryItem, Tag, TablePanelConfig } from "../types";
import { RANGE_LABELS, RANGE_MS } from "./chart-panel";
import { usePanelRefresh } from "./use-panel-refresh";

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

  const unitOf = useMemo(() => {
    const map = new Map(tags.map((t) => [t.id, t.unit]));
    return (item: SummaryItem) => item.unit || map.get(item.tag_id) || "";
  }, [tags]);

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

  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-bg-sidebar">
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-light">
            <th className="px-3 py-1.5 font-semibold">Tag</th>
            <th className="px-2 py-1.5 text-right font-semibold">Terkini</th>
            <th className="px-2 py-1.5 text-right font-semibold">Min</th>
            <th className="px-2 py-1.5 text-right font-semibold">Rata²</th>
            <th className="px-3 py-1.5 text-right font-semibold">Maks</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.tag_id} className="border-t border-border-soft">
              <td className="max-w-0 truncate px-3 py-1.5 font-medium text-text">
                {item.label}
                {unitOf(item) && (
                  <span className="ml-1 text-[10.5px] font-normal text-text-light">
                    {unitOf(item)}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-text">
                {fmt(item.last)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                {fmt(item.min)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                {fmt(item.avg)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                {fmt(item.max)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1 text-[10px] text-text-light">
        Min/Rata²/Maks dihitung dari {RANGE_LABELS[config.range]} terakhir
      </div>
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
