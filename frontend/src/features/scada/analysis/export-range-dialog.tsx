"use client";

/** "Export Data" — download the selected sensors' history as Excel over a
 *  chosen range. "Semua" covers the DB's 90-day window; anything older has
 *  already been archived to Google Drive (R-Net Arsip) by the archiver. */

import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { Tag } from "../types";
import {
  EXPORT_RANGE_LABELS,
  exportRangeToExcel,
  type ExportRangeKey,
} from "./export-excel";

interface ArchiveItem {
  month: string;
  file_name: string;
  web_link: string | null;
  row_count: number;
}

export function ExportRangeDialog({
  tags,
  sheetName,
  onClose,
}: {
  tags: Tag[];
  sheetName: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<ExportRangeKey>("today");
  const [busy, setBusy] = useState(false);
  const [archives, setArchives] = useState<ArchiveItem[]>([]);

  useEffect(() => {
    scadaApi
      .listArchives()
      .then((res) => setArchives(res.items))
      .catch(() => undefined);
  }, []);

  async function doExport() {
    setBusy(true);
    try {
      await exportRangeToExcel({ tags, sheetName, range });
      toast.success("File Excel diunduh");
      onClose();
    } catch {
      toast.error("Gagal membuat file Excel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-panel flex max-w-sm flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border-soft px-6 pb-4 pt-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white">
            <Download className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold leading-tight text-text">
              Export Data
            </h2>
            <p className="mt-0.5 text-[12px] text-text-muted">
              {tags.length} sensor terpilih → file Excel
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

        <div className="flex flex-col gap-1.5 px-6 py-5">
          {(Object.keys(EXPORT_RANGE_LABELS) as ExportRangeKey[]).map((key) => (
            <label
              key={key}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[var(--r-lg)] border px-3 py-2.5",
                range === key
                  ? "border-primary bg-primary/5"
                  : "border-border-soft hover:border-border"
              )}
            >
              <input
                type="radio"
                name="export-range"
                checked={range === key}
                onChange={() => setRange(key)}
                className="accent-[var(--rein-primary)]"
              />
              <span className="text-[13px] font-medium text-text">
                {EXPORT_RANGE_LABELS[key]}
              </span>
            </label>
          ))}
          <p className="mt-1 text-[11px] leading-snug text-text-light">
            Data lebih tua dari 90 hari sudah diarsip otomatis ke Google Drive
            (folder <span className="font-semibold">R-Net Arsip</span>).
          </p>
          {archives.length > 0 && (
            <div className="mt-1 max-h-28 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-2">
              {archives.map((a) => (
                <a
                  key={a.month}
                  href={a.web_link ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-[var(--r-sm)] px-1.5 py-1 text-[11.5px] text-text-muted hover:bg-bg-hover hover:text-text"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{a.file_name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-text-light">
                    {a.row_count.toLocaleString("id")} baris
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 pb-6">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={busy || tags.length === 0}
            className="btn btn-primary btn-sm gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
