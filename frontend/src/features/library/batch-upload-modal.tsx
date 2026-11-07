"use client";

import { AlertTriangle, Check, FileText, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { proposeFile } from "@/lib/api/library";
import type { DuplicateMatch, FolderNode, UploadFormValues } from "./types";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stripExt(name: string): string {
  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApprovedItem {
  file: File;
  form: UploadFormValues;
}

interface BatchItem {
  key: string;
  file: File;
  phase: "detecting" | "ready";
  form: UploadFormValues;
  duplicate: DuplicateMatch | null;
}

interface BatchUploadModalProps {
  files: File[];
  folder: FolderNode;
  onClose: () => void;
  onApproveAll: (items: ApprovedItem[]) => void;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BatchUploadModal({ files, folder, onClose, onApproveAll }: BatchUploadModalProps) {
  const [items, setItems] = useState<BatchItem[]>(() =>
    files.map((file, i) => ({
      key: `${i}-${file.name}-${file.size}`,
      file,
      phase: "detecting" as const,
      form: {
        folder_id: folder.id,
        doc_type: "",
        doc_number: "",
        title: stripExt(file.name),
        note: "",
        use_original_name: true,
      },
      duplicate: null,
    }))
  );

  const detectStarted = useRef(false);

  // Check duplicate hash for each file in parallel
  useEffect(() => {
    if (detectStarted.current) return;
    detectStarted.current = true;

    files.forEach((file, index) => {
      sha256Hex(file)
        .catch(() => undefined)
        .then((hash) => proposeFile(file.name, file.size, folder.id, hash))
        .then((prop) => {
          setItems((prev) =>
            prev.map((it, i) =>
              i !== index
                ? it
                : {
                    ...it,
                    phase: "ready" as const,
                    duplicate: prop.duplicate ?? null,
                  }
            )
          );
        })
        .catch(() => {
          setItems((prev) =>
            prev.map((it, i) => (i !== index ? it : { ...it, phase: "ready" as const }))
          );
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleStart = () => {
    if (items.length === 0) return;
    onApproveAll(items.map((it) => ({ file: it.file, form: it.form })));
    onClose();
  };

  const detectingCount = items.filter((it) => it.phase === "detecting").length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(15,23,42,0.45)] backdrop-blur-[4px] p-0 sm:p-4 animate-[fadeIn_180ms_ease]">
      <div
        className="bg-bg border border-border rounded-t-[var(--r-2xl)] sm:rounded-[var(--r-2xl)] shadow-[var(--shadow-lg)] w-full max-w-[600px] flex flex-col overflow-hidden animate-[scaleIn_200ms_cubic-bezier(0.22,1,0.36,1)]"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-border-soft shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-text truncate leading-tight">
              Upload Dokumen
            </div>
            <div className="text-[11.5px] text-text-muted truncate mt-0.5">
              {items.length} file ke <span className="font-mono">{folder.path}</span>
              {detectingCount > 0 && ` · memeriksa ${detectingCount} file…`}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm text-text-muted shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable file list */}
        <div className="flex-1 overflow-y-auto divide-y divide-border-soft">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-text-muted">
              Semua file dihapus dari antrian
            </div>
          ) : (
            items.map((item, index) => (
              <FileCard
                key={item.key}
                item={item}
                index={index}
                onRemove={removeItem}
              />
            ))
          )}
        </div>

        {/* Duplicate summary banner */}
        {items.some((it) => it.duplicate) && (
          <div className="px-3 sm:px-4 py-2 bg-amber-bg border-t border-amber/40 shrink-0 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber shrink-0 mt-0.5" />
            <div className="text-[11px] text-text leading-snug">
              <span className="font-semibold">
                {items.filter((it) => it.duplicate).length} file
              </span>{" "}
              terdeteksi sudah pernah diupload sebelumnya.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-t border-border-soft bg-bg-ctrl shrink-0">
          <button onClick={onClose} className="btn btn-default shrink-0">Batal</button>
          <div className="flex-1" />
          <button
            onClick={handleStart}
            disabled={items.length === 0}
            className="btn btn-primary gap-1.5 shrink-0"
          >
            {detectingCount > 0 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span className="hidden sm:inline">Mulai Upload {items.length} File →</span>
            <span className="sm:hidden">Upload {items.length} →</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── File card ─────────────────────────────────────────────────────────────────

function FileCard({
  item,
  index,
  onRemove,
}: {
  item: BatchItem;
  index: number;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded bg-bg-ctrl border border-border flex items-center justify-center shrink-0">
          {item.phase === "detecting" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          ) : item.duplicate ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber" />
          ) : (
            <Check className="w-3.5 h-3.5 text-green" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-mono font-medium truncate text-text">{item.file.name}</div>
          <div className="text-[10.5px] text-text-muted">{formatBytes(item.file.size)}</div>
        </div>
        <button
          onClick={() => onRemove(index)}
          className="btn btn-ghost btn-icon btn-sm text-text-muted hover:text-red shrink-0"
          title="Hapus dari antrian"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {item.duplicate && (
        <div className="ml-0 sm:ml-9 mt-2 px-2.5 py-1.5 rounded border border-amber/40 bg-amber-bg text-[11px] leading-relaxed">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-text font-semibold">File ini sudah pernah diupload</div>
              <div className="text-text-muted break-words">
                Sebagai{" "}
                <span className="font-mono text-text break-all">{item.duplicate.file_name}</span>{" "}
                oleh {item.duplicate.uploader_name},{" "}
                {new Date(item.duplicate.uploaded_at).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                . Anda tetap bisa lanjut upload atau hapus dari antrian.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
