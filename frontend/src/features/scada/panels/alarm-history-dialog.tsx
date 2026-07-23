"use client";

/** "Riwayat Alarm" — the permanent alarm log (scada_alarm_events), paginated
 *  and filterable by tag/kind. Every alarm that ever fired lives here forever:
 *  when it started, how bad it was, who acknowledged it, when it cleared. */

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { AlarmEvent, Tag } from "../types";

const PAGE_SIZE = 25;

const KIND_LABELS: Record<string, string> = {
  high: "Di atas batas",
  low: "Di bawah batas",
  silent: "Sensor bisu",
  expiring: "Pengingat reset",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlarmHistoryDialog({
  tags,
  onClose,
}: {
  tags: Tag[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<AlarmEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tagId, setTagId] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await scadaApi.listAlarmHistory({
        page,
        pageSize: PAGE_SIZE,
        tagId: tagId || undefined,
        kind: kind || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, tagId, kind]);

  useEffect(() => {
    // Deferred a tick (same pattern as use-panel-refresh) so state lands
    // after the effect commit — keeps the linter's cascading-render rule happy.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-panel flex max-h-[80vh] w-full max-w-3xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border-soft px-6 pb-4 pt-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white">
            <History className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold leading-tight text-text">
              Riwayat Alarm
            </h2>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Semua alarm yang pernah terjadi — {total.toLocaleString("id")} catatan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-soft px-6 py-3">
          <select
            className="field-select h-8 w-auto cursor-pointer text-[12px]"
            value={tagId}
            onChange={(e) => {
              setTagId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua sensor</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className="field-select h-8 w-auto cursor-pointer text-[12px]"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua jenis</option>
            <option value="high">Di atas batas</option>
            <option value="low">Di bawah batas</option>
            <option value="silent">Sensor bisu</option>
            <option value="expiring">Pengingat reset</option>
          </select>
          {loading && <Loader2 className="size-4 animate-spin text-text-light" />}
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto px-6">
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-text-light" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-text-muted">
              Belum ada catatan alarm{tagId || kind ? " untuk filter ini" : ""}.
            </p>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-bg">
                <tr className="text-left text-[11px] font-semibold text-text-muted">
                  <th className="py-2 pr-3">Sensor</th>
                  <th className="py-2 pr-3">Jenis</th>
                  <th className="py-2 pr-3 text-right">Nilai</th>
                  <th className="py-2 pr-3">Mulai</th>
                  <th className="py-2 pr-3">Selesai</th>
                  <th className="py-2">Diakui oleh</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-border-soft">
                    <td className="max-w-[180px] truncate py-2 pr-3 font-medium text-text">
                      {e.tag_label}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                          e.cleared_at === null
                            ? "bg-red/10 text-red"
                            : "bg-bg-sidebar text-text-muted"
                        )}
                      >
                        {KIND_LABELS[e.kind] ?? e.kind}
                        {e.cleared_at === null && " · aktif"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-text">
                      {e.trigger_value === null
                        ? "—"
                        : `${e.trigger_value.toLocaleString("id")}${
                            e.tag_unit ? ` ${e.tag_unit}` : ""
                          }`}
                      {e.threshold !== null && (
                        <span className="ml-1 text-[10px] text-text-light">
                          (batas {e.threshold.toLocaleString("id")})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-text-muted">
                      {fmt(e.triggered_at)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-text-muted">
                      {fmt(e.cleared_at)}
                    </td>
                    <td className="max-w-[140px] truncate py-2 text-text-muted">
                      {e.ack_name ? (
                        <>
                          {e.ack_name}
                          <span className="ml-1 text-[10px] text-text-light">
                            {fmt(e.ack_at)}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4">
          <span className="text-[11.5px] text-text-muted">
            Halaman {page} dari {pageCount}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="btn btn-secondary btn-sm gap-1"
            >
              <ChevronLeft className="size-3.5" /> Sebelumnya
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
              className="btn btn-secondary btn-sm gap-1"
            >
              Berikutnya <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
