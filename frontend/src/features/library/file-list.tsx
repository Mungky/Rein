"use client";

import { Check, ExternalLink, FileText, Loader2, Lock, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteFile, pollViewLink, renameFile, requestViewAccess } from "@/lib/api/library";
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

export interface ProcessingFile {
  id: string;
  fileName: string;
}

interface FileListProps {
  files: LibraryFileMeta[];
  isAdmin?: boolean;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, newName: string) => void;
  processingFiles?: ProcessingFile[];
}

export function FileList({ files, isAdmin, currentUserId, onDeleted, onRenamed, processingFiles }: FileListProps) {
  const hasContent = files.length > 0 || (processingFiles && processingFiles.length > 0);

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <FileText className="w-8 h-8 text-text-light opacity-30" />
        <p className="text-[13px] text-text-muted">Belum ada file di folder ini</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {/* Processing / in-audit files at top */}
      {processingFiles?.map((pf) => (
        <ProcessingRow key={pf.id} fileName={pf.fileName} />
      ))}
      {files.map((f) => (
        <FileRow
          key={f.id}
          file={f}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onDeleted={onDeleted}
          onRenamed={onRenamed}
        />
      ))}
    </div>
  );
}

function ProcessingRow({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-bg/30">
      <div className="w-8 h-8 rounded-md bg-amber-bg border border-amber/20 flex items-center justify-center shrink-0">
        <Loader2 className="w-3.5 h-3.5 text-amber animate-spin" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold font-mono truncate text-text">{fileName}</div>
        <div className="text-[11px] text-amber">Sedang diaudit…</div>
      </div>
    </div>
  );
}

function FileRow({
  file,
  isAdmin,
  currentUserId,
  onDeleted,
  onRenamed,
}: {
  file: LibraryFileMeta;
  isAdmin?: boolean;
  currentUserId?: string;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, newName: string) => void;
}) {
  const [accessState, setAccessState] = useState<ViewRequestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.file_name);
  const [saving, setSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canEdit = isAdmin || file.uploader_id === currentUserId;

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
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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
    } catch { /* silently fail */ } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus "${file.file_name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    setDeleting(true);
    try {
      await deleteFile(file.id);
      onDeleted?.(file.id);
    } catch { setDeleting(false); }
  };

  const startRename = () => {
    setRenameValue(file.file_name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 30);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameValue(file.file_name);
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    if (!name || name === file.file_name) { cancelRename(); return; }
    setSaving(true);
    try {
      await renameFile(file.id, name);
      onRenamed?.(file.id, name);
      setRenaming(false);
    } catch { /* keep input open */ } finally { setSaving(false); }
  };

  const typeColor = DOC_TYPE_COLORS[file.doc_type ?? ""] ?? "text-text-muted bg-bg-hover";

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors duration-100 group">
      <div className="w-8 h-8 rounded-md bg-bg-ctrl border border-border flex items-center justify-center shrink-0">
        <FileText className="w-3.5 h-3.5 text-text-muted" />
      </div>

      <div className="flex-1 min-w-0">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              className="flex-1 text-[13px] font-mono bg-bg-ctrl border border-primary rounded px-2 py-0.5 outline-none min-w-0"
              disabled={saving}
            />
            <button onClick={commitRename} disabled={saving} className="btn btn-ghost btn-icon btn-sm text-green">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button onClick={cancelRename} disabled={saving} className="btn btn-ghost btn-icon btn-sm text-text-muted">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
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
                .filter(Boolean).join(" · ")}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {canEdit && !renaming && (
          <button
            onClick={startRename}
            className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-icon btn-sm text-text-light hover:text-primary transition-opacity"
            title="Ganti nama"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {isAdmin && !renaming && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-icon btn-sm text-red transition-opacity"
            title="Hapus file"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
        {!renaming && (
          <AccessButton
            status={accessState?.status ?? "none"}
            loading={loading}
            tempLink={accessState?.temp_link ?? null}
            onAccess={handleAccess}
          />
        )}
      </div>
    </div>
  );
}

function AccessButton({
  status, loading, tempLink, onAccess,
}: {
  status: string; loading: boolean; tempLink: string | null; onAccess: () => void;
}) {
  if (status === "approved" && tempLink) {
    return (
      <button
        onClick={() => window.open(tempLink, "_blank")}
        className="btn btn-sm btn-default gap-1.5 text-green border-green/30 hover:bg-green-bg"
      >
        <ExternalLink className="w-3 h-3" /> Buka
      </button>
    );
  }
  if (status === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-amber font-semibold px-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Menunggu…
      </span>
    );
  }
  if (status === "denied" || status === "expired") {
    return <span className="text-[11.5px] text-red/70 px-2">Ditolak</span>;
  }
  return (
    <button
      onClick={onAccess}
      disabled={loading}
      className="btn btn-sm btn-default gap-1.5 text-text-muted hover:text-primary hover:border-primary hover:bg-primary-bg"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
      Minta Akses
    </button>
  );
}
