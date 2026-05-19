"use client";

import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, Loader2, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UploadItem, UploadQueueApi } from "./use-upload-queue";

interface UploadQueuePanelProps {
  queue: UploadQueueApi;
  onUploadDone?: () => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadQueuePanel({ queue, onUploadDone }: UploadQueuePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const previousDoneRef = useRef(true);

  const items = queue.items;
  const total = items.length;
  const success = items.filter((i) => i.status === "success").length;
  const failed = items.filter((i) => i.status === "failed" && i.attempt >= 3).length;
  const uploading = items.filter((i) => i.status === "uploading").length;
  const queued = items.filter((i) => i.status === "queued").length;
  const allDone = total > 0 && uploading === 0 && queued === 0;
  const overallProgress = total > 0 ? Math.round((success / total) * 100) : 0;

  // Notify parent once per batch transition from active → done
  useEffect(() => {
    if (allDone && !previousDoneRef.current) {
      onUploadDone?.();
    }
    previousDoneRef.current = allDone || total === 0;
  }, [allDone, total, onUploadDone]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)]">
      <div className="bg-bg border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Collapsed header — always visible */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-bg-hover border-b border-border"
        >
          {uploading > 0 ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
          ) : failed > 0 ? (
            <AlertCircle className="w-3.5 h-3.5 text-red shrink-0" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 text-green shrink-0" />
          )}
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[12px] font-bold text-text">
              {uploading > 0 || queued > 0
                ? `Mengunggah ${success + 1}/${total}`
                : failed > 0
                  ? `${failed} gagal · ${success} sukses`
                  : `${success}/${total} selesai`}
            </div>
            <div className="h-1 bg-bg-hover rounded-full overflow-hidden mt-1">
              <div
                className={`h-full rounded-full transition-all duration-200 ${failed > 0 && allDone ? "bg-red" : "bg-primary"}`}
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0" />
          )}
        </button>

        {/* Expanded list */}
        {expanded && (
          <div className="max-h-[300px] overflow-y-auto divide-y divide-border-soft">
            {items.map((item) => (
              <UploadRow
                key={item.id}
                item={item}
                onRemove={() => queue.remove(item.id)}
                onRetry={() => queue.retry(item.id)}
              />
            ))}
          </div>
        )}

        {/* Footer actions when done */}
        {allDone && (
          <div className="flex items-center gap-2 px-3.5 py-2 border-t border-border bg-bg-ctrl">
            <span className="text-[10.5px] text-text-muted flex-1">
              {success} berhasil · {failed} gagal
            </span>
            {failed > 0 && (
              <button
                onClick={queue.retryAllFailed}
                className="btn btn-default btn-sm gap-1 text-[11px]"
              >
                <RotateCw className="w-3 h-3" /> Ulang Gagal
              </button>
            )}
            <button
              onClick={queue.clearAll}
              className="btn btn-default btn-sm text-[11px]"
            >
              Tutup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadRow({
  item,
  onRemove,
  onRetry,
}: {
  item: UploadItem;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const isUploading = item.status === "uploading";
  const isSuccess = item.status === "success";
  const isFailed = item.status === "failed";
  const isQueued = item.status === "queued";
  const isRetryPending = isFailed && item.error?.includes("mencoba lagi");

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        {isUploading && <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />}
        {isSuccess && <CheckCircle className="w-3 h-3 text-green shrink-0" />}
        {isFailed && !isRetryPending && <AlertCircle className="w-3 h-3 text-red shrink-0" />}
        {isFailed && isRetryPending && <Loader2 className="w-3 h-3 animate-spin text-amber shrink-0" />}
        {isQueued && <span className="w-3 h-3 rounded-full border-2 border-text-light shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-mono truncate text-text">{item.file.name}</div>
          <div className="text-[10px] text-text-muted">
            {formatBytes(item.file.size)}
            {item.attempt > 1 && ` · percobaan ke-${item.attempt}`}
          </div>
        </div>

        {isFailed && !isRetryPending && (
          <button
            onClick={onRetry}
            className="text-text-light hover:text-primary shrink-0"
            title="Coba lagi"
          >
            <RotateCw className="w-3 h-3" />
          </button>
        )}
        {(isQueued || isSuccess) && (
          <button
            onClick={onRemove}
            className="text-text-light hover:text-red shrink-0"
            title="Hapus dari antrian"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {isUploading && (
        <div className="h-1 bg-bg-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-200"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}

      {isFailed && item.error && (
        <div className={`text-[10px] mt-0.5 ${isRetryPending ? "text-amber" : "text-red"}`}>
          {item.error}
        </div>
      )}
    </div>
  );
}
