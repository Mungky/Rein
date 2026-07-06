"use client";

/** Riwayat drawer — the TDengine-Explorer-style data browser for one tag:
 *  24h mini chart + raw recent samples + retention info + Excel export. */

import { useCallback, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { scadaApi } from "@/lib/api/scada";
import type { RecentSample, Tag } from "../types";
import { ChartPanel } from "../panels/chart-panel";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { exportTagToExcel } from "./export-excel";

export function HistoryDrawer({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const [samples, setSamples] = useState<RecentSample[] | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await scadaApi.getRecentSamples(tag.id, 100);
      setSamples(res.items);
    } catch {
      // keep previous; polling retries
    }
  }, [tag.id]);

  usePanelRefresh(load);

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
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-bg shadow-[var(--shadow-lg)]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border-soft px-5 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold text-text">
              {tag.label}
              {tag.unit && (
                <span className="ml-1 font-normal text-text-muted">({tag.unit})</span>
              )}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-text-muted">
              {tag.device_key} · {tag.source} · data disimpan 90 hari, resolusi 1 menit
            </p>
          </div>
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

        {/* 24h mini chart — reuse the panel renderer */}
        <div className="h-48 shrink-0 border-b border-border-soft">
          <ChartPanel
            config={{ tag_ids: [tag.id], range: "24h", show_minmax: true }}
            tags={[tag]}
          />
        </div>

        {/* Raw samples */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {samples === null ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-text-light" />
            </div>
          ) : samples.length === 0 ? (
            <p className="px-5 py-6 text-center text-[12px] text-text-muted">
              Belum ada data untuk tag ini.
            </p>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-bg-sidebar">
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-light">
                  <th className="px-5 py-1.5 font-semibold">Waktu</th>
                  <th className="px-5 py-1.5 text-right font-semibold">
                    Nilai{tag.unit ? ` (${tag.unit})` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.ts} className="border-t border-border-soft">
                    <td className="px-5 py-1 text-text-muted">
                      {format(new Date(s.ts), "d MMM yyyy, HH:mm", { locale: localeId })}
                    </td>
                    <td className="px-5 py-1 text-right font-medium tabular-nums text-text">
                      {s.value.toLocaleString("id")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-border-soft px-5 py-2 text-[10.5px] text-text-light">
          100 sampel mentah terakhir — unduh Excel untuk 500 sampel.
        </div>
      </aside>
    </>
  );
}
