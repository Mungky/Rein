"use client";

import {
  Check, ExternalLink, FileArchive, FileBox, FileCode2, FileSpreadsheet,
  FileText, FolderInput, Loader2, MoreVertical, Pencil, Presentation, Trash2, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { deleteFile, moveFile, pollViewLink, renameFile, requestViewAccess } from "@/lib/api/library";
import type { FolderMyPerms } from "@/lib/api/library";
import { DropdownMenu, DropdownItem } from "./dropdown-menu";
import { MoveModal } from "./move-modal";
import type { FolderNode, LibraryFileMeta, ViewRequestResponse } from "./types";

/** Colored icon + tinted background per file extension — kills the all-gray monotony. */
function fileVisual(fileName: string): { Icon: ComponentType<{ className?: string }>; cls: string } {
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "pdf":
      return { Icon: FileText, cls: "text-red bg-red-bg" };
    case "xlsx": case "xls": case "csv":
      return { Icon: FileSpreadsheet, cls: "text-green bg-green-bg" };
    case "docx": case "doc":
      return { Icon: FileText, cls: "text-blue bg-blue-bg" };
    case "pptx": case "ppt":
      return { Icon: Presentation, cls: "text-amber bg-amber-bg" };
    case "zip": case "rar": case "7z":
      return { Icon: FileArchive, cls: "text-amber bg-amber-bg" };
    case "dwg": case "dxf": case "step": case "stp":
      return { Icon: FileBox, cls: "text-primary bg-primary-bg" };
    default:
      return { Icon: FileCode2, cls: "text-text-muted bg-bg-ctrl" };
  }
}

/** True when a file was created within the last 24h — used for the "Baru" pulse. */
function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 86_400_000;
}

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
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: () => void;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, newName: string) => void;
  onMoved?: (id: string) => void;
  processingFiles?: ProcessingFile[];
}

export function FileList({
  files, isAdmin, currentUserId, tree, perms,
  selectedIds, onToggleSelect, onToggleAll,
  onDeleted, onRenamed, onMoved, processingFiles,
}: FileListProps) {
  const hasContent = files.length > 0 || (processingFiles && processingFiles.length > 0);

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 px-4">
        <div className="size-14 rounded-full bg-bg-ctrl border border-border flex items-center justify-center">
          <FileText className="w-6 h-6 text-text-light" />
        </div>
        <div className="text-center">
          <p className="text-[13.5px] font-semibold text-text">Belum ada file</p>
          <p className="text-[12px] text-text-muted mt-0.5">Upload file pertama untuk folder ini</p>
        </div>
      </div>
    );
  }

  const selectionEnabled = Boolean(selectedIds && onToggleSelect && onToggleAll);
  const allChecked = selectionEnabled && files.length > 0 && files.every((f) => selectedIds!.has(f.id));
  const someChecked = selectionEnabled && files.some((f) => selectedIds!.has(f.id));

  return (
    <div>
      {selectionEnabled && files.length > 0 && (
        <div className="flex items-center gap-3 px-4 md:px-5 py-2.5 border-b border-border-soft bg-bg-ctrl/50">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked && !allChecked;
            }}
            onChange={onToggleAll}
            className="w-3.5 h-3.5 cursor-pointer accent-primary"
          />
          <span className="text-[11.5px] text-text-muted font-medium">
            {someChecked
              ? `${[...selectedIds!].filter((id) => files.find((f) => f.id === id)).length} dari ${files.length} dipilih`
              : `Pilih semua (${files.length})`}
          </span>
        </div>
      )}
      <div className="divide-y divide-border-soft">
        {processingFiles?.map((pf) => <ProcessingRow key={pf.id} fileName={pf.fileName} />)}
        {files.map((f, i) => (
          <FileRow
            key={f.id}
            file={f}
            index={i}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            tree={tree}
            perms={perms}
            selected={selectedIds?.has(f.id) ?? false}
            onToggleSelect={onToggleSelect}
            onDeleted={onDeleted}
            onRenamed={onRenamed}
            onMoved={onMoved}
          />
        ))}
      </div>
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
  index = 0,
  isAdmin,
  currentUserId,
  tree,
  perms,
  selected,
  onToggleSelect,
  onDeleted,
  onRenamed,
  onMoved,
}: {
  file: LibraryFileMeta;
  index?: number;
  isAdmin?: boolean;
  currentUserId?: string;
  tree?: FolderNode[];
  perms?: FolderMyPerms | null;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
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
      if (document.visibilityState !== "visible") return;
      try {
        const result = await pollViewLink(file.id);
        if (result.status !== "pending") {
          setAccessState(result);
          clearInterval(pollRef.current!);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(pollRef.current!);
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
    try {
      await deleteFile(file.id);
      onDeleted?.(file.id);
    } catch (e) {
      setDeleting(false);
      alert(e instanceof Error ? e.message : "Gagal menghapus file");
    }
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

  const handleMove = async (targetFolderId: string) => {
    setShowMoveModal(false);
    try {
      await moveFile(file.id, targetFolderId);
      onMoved?.(file.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal memindahkan file");
    }
  };

  const { Icon: FileIcon, cls: iconCls } = fileVisual(file.file_name);
  const recent = isRecent(file.created_at);

  // The whole row is the access affordance — clicking it opens (if approved)
  // or requests access (if none). No explicit "Minta Akses" button anymore.
  const status = accessState?.status ?? "none";
  const rowClickable = !renaming && (status === "none" || (status === "approved" && Boolean(accessState?.temp_link)));

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
      className={`relative flex items-center gap-2.5 sm:gap-3 px-3 sm:px-5 py-2 sm:py-2.5 transition-colors duration-100 group animate-[rowIn_.26s_ease_both] ${selected ? "bg-primary-soft" : "hover:bg-bg-hover"}`}
    >
      {/* Left accent bar — grows in on hover / when selected */}
      <span
        className={`absolute left-0 inset-y-1.5 w-[3px] rounded-r-[2px] bg-primary origin-center transition-transform duration-200 ${
          selected ? "scale-y-100" : "scale-y-0 group-hover:scale-y-100"
        }`}
      />

      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect(file.id)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 sm:w-3.5 sm:h-3.5 cursor-pointer accent-primary shrink-0"
        />
      )}

      {renaming ? (
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          <div className={`w-9 h-9 rounded-[var(--r)] flex items-center justify-center shrink-0 ${iconCls}`}>
            <FileIcon className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              className="flex-1 text-[13px] font-mono bg-bg border border-primary rounded-[var(--r-sm)] px-2.5 py-1.5 outline-none min-w-0 shadow-[0_0_0_3px_var(--rein-primary-bg)]"
              disabled={saving}
            />
            <button onClick={commitRename} disabled={saving} className="btn btn-ghost btn-icon btn-sm text-green">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button onClick={cancelRename} disabled={saving} className="btn btn-ghost btn-icon btn-sm text-text-muted">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={rowClickable ? handleAccess : undefined}
          disabled={!rowClickable || loading}
          title="Buka file"
          className={`flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 text-left ${rowClickable ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className={`w-9 h-9 rounded-[var(--r)] flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-[1.06] ${selected ? "bg-primary text-white" : iconCls}`}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileIcon className="w-4 h-4" />}
          </div>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[12.5px] sm:text-[13px] font-semibold font-mono truncate text-text">{file.file_name}</span>
            {recent && (
              <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-[10px] font-semibold text-green">
                <span className="size-1.5 rounded-full bg-green animate-pulse" /> Baru
              </span>
            )}
          </div>
        </button>
      )}

      {/* Right cluster — metadata (now fills the empty right space) + status + actions */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {file.workspace_project_id&&<a href={`/workspace?project=${encodeURIComponent(file.workspace_project_id)}${file.workspace_task_id?`&wo=${encodeURIComponent(file.workspace_task_id)}`:""}`} title={`Buka ${file.project_name||"Project"}`} className="inline-flex min-h-11 items-center rounded px-2 text-xs font-medium text-primary hover:bg-primary/10 sm:min-h-7">{file.workspace_task_id?"WO":"Project"}</a>}
        {!renaming && (
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-text-muted tabular-nums whitespace-nowrap">
            <span>{formatBytes(file.file_size)}</span>
            <span className="text-text-light">·</span>
            <span>{relTime(file.created_at)}</span>
          </span>
        )}
        <AccessStatus status={status} tempLink={accessState?.temp_link ?? null} />
        {!renaming && (canEdit || canDelete || canMove) && (
          <DropdownMenu
            button={<MoreVertical className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
            buttonClassName="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 aria-expanded:opacity-100 btn btn-ghost btn-icon btn-sm text-text-light hover:text-text transition-opacity"
            buttonTitle="Aksi file"
            menuWidthClass="min-w-[160px]"
          >
            {(close) => (
              <>
                {canEdit && (
                  <DropdownItem icon={<Pencil className="w-3.5 h-3.5 text-text-muted" />} label="Ganti nama" onClick={() => { close(); startRename(); }} />
                )}
                {canMove && tree && (
                  <DropdownItem icon={<FolderInput className="w-3.5 h-3.5 text-text-muted" />} label="Pindahkan" onClick={() => { close(); setShowMoveModal(true); }} />
                )}
                {canDelete && (
                  <DropdownItem icon={deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} label="Hapus" danger disabled={deleting} onClick={() => { close(); handleDelete(); }} />
                )}
              </>
            )}
          </DropdownMenu>
        )}
      </div>

      {showMoveModal && tree && (
        <MoveModal
          tree={tree}
          currentFolderId={null}
          onClose={() => setShowMoveModal(false)}
          onMove={handleMove}
          title="Pindahkan File"
          subtitle={file.file_name}
        />
      )}
    </div>
  );
}

/** Compact status indicator shown to the right of a file row.
 *  Access is requested by clicking the row itself — there is no button here. */
function AccessStatus({ status, tempLink }: { status: string; tempLink: string | null }) {
  if (status === "approved" && tempLink) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1 text-[11.5px] text-green font-semibold px-1.5">
        <ExternalLink className="w-3 h-3" /> Siap dibuka
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber font-semibold px-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> <span className="hidden sm:inline">Menunggu…</span>
      </span>
    );
  }
  if (status === "denied" || status === "expired") {
    return <span className="text-[11px] text-red/70 px-1.5">Ditolak</span>;
  }
  return null;
}

