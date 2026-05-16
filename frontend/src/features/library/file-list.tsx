"use client";

import { FileText, Lock, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pollViewLink, requestViewAccess, deleteFile } from "@/lib/api/library";
import type { LibraryFileMeta, ViewRequestResponse } from "./types";

const DOC_TYPE_COLORS: Record<string, string> = {
  DRW: "text-blue bg-blue-bg",
  INV: "text-green bg-green-bg",
  PO: "text-amber bg-amber-bg",
  SPK: "text-primary bg-primary-bg",
  RFP: "text-primary bg-primary-bg",
  RPT: "text-text-muted bg-bg-hover",
  SPEC: "text-text-muted bg-bg-hover",
  OTHER: "text-text-muted bg-bg-hover",
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id", { day: "numeric", month: "short", year: "2-digit" });
}

interface FileListProps {
  files: LibraryFileMeta[];
  isAdmin?: boolean;
  onDeleted?: (id: string) => void;
}

export function FileList({ files, isAdmin, onDeleted }: FileListProps) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <FileText className="w-8 h-8 text-text-light opacity-30" />
        <p className="text-[13px] text-text-muted">Belum ada file di folder ini</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {files.map((f) => (
        <FileRow key={f.id} file={f} isAdmin={isAdmin} onDeleted={onDeleted} />
      ))}
    </div>
  );
}

function FileRow({
  file,
  isAdmin,
  onDeleted,
}: {
  file: LibraryFileMeta;
  isAdmin?: boolean;
  onDeleted?: (id: string) => void;
}) {
  const [accessState, setAccessState] = useState<ViewRequestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for approval while pending
  useEffect(() => {
    if (accessState?.status !== "pending") return;
    pollRef.current = setInterval(async () => {
      try {
        const result = await pollViewLink(file.id);
        if (result.status !== "pending") {
          setAccessState(result);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [accessState?.status, file.id]);

  const handleAccess = async () => {
    if (accessState?.status === "approved" && accessState.temp_link) {
      window.open(accessState.temp_link, "_blank");
      return;
    }
    setLoading(true);
    try {
      const result = await requestViewAccess(file.id);
      setAccessState(result);
      if (result.status === "approved" && result.temp_link) {
        window.open(result.temp_link, "_blank");
      }
    } catch (e) {
      // silently fail — user sees no change
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus "${file.file_name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    setDeleting(true);
    try {
      await deleteFile(file.id);
      onDeleted?.(file.id);
    } catch {
      setDeleting(false);
    }
  };

  const typeColor = DOC_TYPE_COLORS[file.doc_type ?? ""] ?? "text-text-muted bg-bg-hover";

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors duration-100 group">
      {/* Icon + type badge */}
      <div className="w-8 h-8 rounded-md bg-bg-ctrl border border-border flex items-center justify-center shrink-0">
        <FileText className="w-3.5 h-3.5 text-text-muted" />
      </div>

      {/* Metadata */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          {file.doc_type && (
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded shrink-0 ${typeColor}`}>
              {file.doc_type}
            </span>
          )}
          <span className="text-[13px] font-semibold font-mono truncate">{file.file_name}</span>
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {[file.client_code, file.project_code, formatBytes(file.file_size), relTime(file.created_at)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isAdmin && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-icon btn-sm text-red transition-opacity"
            title="Hapus file"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
        <AccessButton
          status={accessState?.status ?? "none"}
          loading={loading}
          tempLink={accessState?.temp_link ?? null}
          onAccess={handleAccess}
        />
      </div>
    </div>
  );
}

function AccessButton({
  status,
  loading,
  tempLink,
  onAccess,
}: {
  status: string;
  loading: boolean;
  tempLink: string | null;
  onAccess: () => void;
}) {
  if (status === "approved" && tempLink) {
    return (
      <button
        onClick={() => window.open(tempLink, "_blank")}
        className="btn btn-sm btn-default gap-1.5 text-green border-green/30 hover:bg-green-bg"
      >
        <ExternalLink className="w-3 h-3" />
        Buka
      </button>
    );
  }

  if (status === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-amber font-semibold px-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Menunggu…
      </span>
    );
  }

  if (status === "denied" || status === "expired") {
    return (
      <span className="text-[11.5px] text-red/70 px-2">Ditolak</span>
    );
  }

  return (
    <button
      onClick={onAccess}
      disabled={loading}
      className="btn btn-sm btn-default gap-1.5 text-text-muted hover:text-primary hover:border-primary hover:bg-primary-bg"
    >
      {loading ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Lock className="w-3 h-3" />
      )}
      Minta Akses
    </button>
  );
}
