"use client";

import { Check, ExternalLink, FileText, FolderInput, FolderOpen, Loader2, Lock, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteFile, moveFile, pollViewLink, renameFile, requestViewAccess } from "@/lib/api/library";
import type { FolderMyPerms } from "@/lib/api/library";
import type { FolderNode, LibraryFileMeta, ViewRequestResponse } from "./types";

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
  tree?: FolderNode[];
  perms?: FolderMyPerms | null;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, newName: string) => void;
  onMoved?: (id: string) => void;
  processingFiles?: ProcessingFile[];
}

export function FileList({ files, isAdmin, currentUserId, tree, perms, onDeleted, onRenamed, onMoved, processingFiles }: FileListProps) {
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
      {processingFiles?.map((pf) => <ProcessingRow key={pf.id} fileName={pf.fileName} />)}
      {files.map((f) => (
        <FileRow
          key={f.id}
          file={f}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          tree={tree}
          perms={perms}
          onDeleted={onDeleted}
          onRenamed={onRenamed}
          onMoved={onMoved}
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
  tree,
  perms,
  onDeleted,
  onRenamed,
  onMoved,
}: {
  file: LibraryFileMeta;
  isAdmin?: boolean;
  currentUserId?: string;
  tree?: FolderNode[];
  perms?: FolderMyPerms | null;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, newName: string) => void;
  onMoved?: (id: string) => void;
}) {
  const [accessState, setAccessState] = useState<ViewRequestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.file_name);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isUploader = file.uploader_id === currentUserId;
  const canEdit = isAdmin || isUploader || Boolean(perms?.can_rename);
  const canDelete = isAdmin || isUploader || Boolean(perms?.can_delete);
  const canMove = (isAdmin || Boolean(perms?.can_move)) && Boolean(tree);

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
    if (!confirm(`Hapus "${file.file_name}"? File akan dipindahkan ke Trash Google Drive (dapat dipulihkan 30 hari).`)) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      await deleteFile(file.id);
      onDeleted?.(file.id);
    } catch (e) {
      setDeleting(false);
      alert(e instanceof Error ? e.message : "Gagal menghapus file");
    }
  };

  const startRename = () => {
    setMenuOpen(false);
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

  const handleMove = async (targetFolderId: string) => {
    setShowMoveModal(false);
    setMenuOpen(false);
    try {
      await moveFile(file.id, targetFolderId);
      onMoved?.(file.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal memindahkan file");
    }
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
        {!renaming && (canEdit || canDelete || canMove) && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="opacity-0 group-hover:opacity-100 btn btn-ghost btn-icon btn-sm text-text-light hover:text-text transition-opacity"
              title="Aksi file"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-7 z-20 min-w-[160px] bg-bg border border-border rounded-lg shadow-xl overflow-hidden">
                  {canEdit && (
                    <button onClick={startRename} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text hover:bg-bg-hover text-left">
                      <Pencil className="w-3 h-3 text-text-muted" /> Ganti nama
                    </button>
                  )}
                  {canMove && tree && (
                    <button onClick={() => setShowMoveModal(true)} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text hover:bg-bg-hover text-left">
                      <FolderInput className="w-3 h-3 text-text-muted" /> Pindahkan
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={handleDelete} disabled={deleting} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red hover:bg-red-bg text-left">
                      {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Hapus
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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

      {showMoveModal && tree && (
        <MoveModal
          tree={tree}
          currentFolderId={null}
          onClose={() => setShowMoveModal(false)}
          onMove={handleMove}
          fileName={file.file_name}
        />
      )}
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

function MoveModal({
  tree, currentFolderId, onClose, onMove, fileName,
}: {
  tree: FolderNode[];
  currentFolderId: string | null;
  onClose: () => void;
  onMove: (folderId: string) => void;
  fileName: string;
}) {
  const [target, setTarget] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: "80vh" }}>
        <div className="px-4 py-3 border-b border-border bg-bg-ctrl">
          <div className="text-[13px] font-semibold truncate">Pindahkan File</div>
          <div className="text-[11px] text-text-muted font-mono truncate">{fileName}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <FolderPicker
            tree={tree}
            depth={0}
            currentFolderId={currentFolderId}
            target={target}
            onSelect={setTarget}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="btn btn-default">Batal</button>
          <button
            onClick={() => target && onMove(target)}
            disabled={!target}
            className="btn btn-primary gap-1.5"
          >
            <FolderInput className="w-3.5 h-3.5" />
            Pindahkan
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderPicker({
  tree, depth, currentFolderId, target, onSelect,
}: {
  tree: FolderNode[];
  depth: number;
  currentFolderId: string | null;
  target: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {tree.map((node) => (
        <div key={node.id}>
          <button
            type="button"
            disabled={node.id === currentFolderId}
            onClick={() => onSelect(node.id)}
            className={`w-full flex items-center gap-1.5 py-1.5 rounded text-left text-[12px]
              ${target === node.id ? "bg-primary-bg text-primary font-semibold" : "hover:bg-bg-hover text-text"}
              ${node.id === currentFolderId ? "opacity-40 cursor-not-allowed" : ""}`}
            style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
          >
            <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="flex-1 truncate">{node.name}</span>
            {node.file_count > 0 && (
              <span className="text-[10px] text-text-light tabular-nums">{node.file_count}</span>
            )}
          </button>
          {node.children.length > 0 && (
            <FolderPicker
              tree={node.children}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              target={target}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </>
  );
}
