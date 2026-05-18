"use client";

import { BookOpen, Check, ChevronDown, ChevronRight, Clock, Folder, FolderOpen, HardDrive, Link2, Link2Off, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { createFolder, deleteFolder, linkFolderToDrive, renameFolder } from "@/lib/api/library";
import type { FolderNode } from "./types";

export const TEMP_FOLDER_ID = "__temp__";
export const INDEX_FOLDER_ID = "__index__";

export const TEMP_FOLDER_NODE: FolderNode = {
  id: TEMP_FOLDER_ID,
  name: "Riwayat & Sementara",
  department: TEMP_FOLDER_ID,
  dept_label: "Temporary",
  folder_type: "department",
  path: "Riwayat & Sementara",
  gdrive_folder_id: null,
  file_count: 0,
  last_updated: null,
  children: [],
};

export const INDEX_FOLDER_NODE: FolderNode = {
  id: INDEX_FOLDER_ID,
  name: "Index Publik",
  department: INDEX_FOLDER_ID,
  dept_label: "Index Publik",
  folder_type: "department",
  path: "Index Publik",
  gdrive_folder_id: null,
  file_count: 0,
  last_updated: null,
  children: [],
};

interface FolderTreeProps {
  tree: FolderNode[];
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
  isAdmin?: boolean;
  canCreateFolder?: boolean;
  onFolderCreated?: () => void;
}

const DEPT_COLORS: Record<string, string> = {
  finance: "text-green",
  engineering: "text-blue",
  hr: "text-amber",
  purchasing: "text-amber",
  management: "text-primary",
};

export function FolderTree({ tree, selectedId, onSelect, isAdmin, canCreateFolder, onFolderCreated }: FolderTreeProps) {
  const isTemp = selectedId === TEMP_FOLDER_ID;
  const isIndex = selectedId === INDEX_FOLDER_ID;

  return (
    <nav className="flex flex-col gap-0.5 py-1">
      {tree.map((node) => (
        <FolderItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
          isAdmin={isAdmin}
          canCreateFolder={canCreateFolder}
          onFolderCreated={onFolderCreated}
        />
      ))}

      <div className="mx-3 my-1 border-t border-border-soft" />
      <button
        onClick={() => onSelect(INDEX_FOLDER_NODE)}
        className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left transition-colors duration-100 font-semibold
          ${isIndex ? "bg-primary-bg text-primary" : "hover:bg-bg-hover text-text-muted"}`}
      >
        <span className="w-3 shrink-0" />
        <BookOpen className={`w-3.5 h-3.5 shrink-0 ${isIndex ? "text-primary" : "text-text-light"}`} />
        <span className="flex-1 text-[12.5px] truncate">Index Publik</span>
      </button>

      {isAdmin && (
        <button
          onClick={() => onSelect(TEMP_FOLDER_NODE)}
          className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left transition-colors duration-100 font-semibold
            ${isTemp ? "bg-primary-bg text-primary" : "hover:bg-bg-hover text-text-muted"}`}
        >
          <span className="w-3 shrink-0" />
          <Clock className={`w-3.5 h-3.5 shrink-0 ${isTemp ? "text-primary" : "text-text-light"}`} />
          <span className="flex-1 text-[12.5px] truncate">Riwayat &amp; Sementara</span>
        </button>
      )}
    </nav>
  );
}

function FolderItem({
  node,
  selectedId,
  onSelect,
  depth,
  isAdmin,
  canCreateFolder,
  onFolderCreated,
}: {
  node: FolderNode;
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
  depth: number;
  isAdmin?: boolean;
  canCreateFolder?: boolean;
  onFolderCreated?: () => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [linking, setLinking] = useState(false);
  const [linkValue, setLinkValue] = useState(node.gdrive_folder_id ?? "");
  const [linkSaving, setLinkSaving] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSelected = selectedId === node.id;
  const deptColor = DEPT_COLORS[node.department] ?? "text-text-muted";
  const isDept = node.folder_type === "department";
  const isEditing = renaming || linking || deleteConfirm;

  const pl = `${8 + depth * 16}px`;

  // ── handlers ────────────────────────────────────────────────────────────────

  const startCreating = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    setCreating(true);
    setNewName("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await createFolder({ name, department: node.department, folder_type: "custom", parent_id: node.id });
      setCreating(false);
      setNewName("");
      onFolderCreated?.();
    } catch { /* keep open */ } finally { setSaving(false); }
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name || name === node.name) { setRenaming(false); return; }
    setRenameSaving(true);
    try {
      await renameFolder(node.id, name);
      setRenaming(false);
      onFolderCreated?.();
    } catch { /* keep open */ } finally { setRenameSaving(false); }
  };

  const handleLink = async () => {
    const raw = linkValue.trim();
    const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    const driveId = match ? match[1] : raw;
    setLinkSaving(true);
    try {
      await linkFolderToDrive(node.id, driveId || null);
      setLinking(false);
      onFolderCreated?.();
    } catch { /* keep open */ } finally { setLinkSaving(false); }
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteFolder(node.id);
      setDeleteConfirm(false);
      onFolderCreated?.();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Gagal menghapus folder");
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── shared icon row ─────────────────────────────────────────────────────────

  const chevron = node.children.length > 0
    ? (open
        ? <ChevronDown className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />
        : <ChevronRight className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />)
    : <span className="w-3 shrink-0" />;

  const folderIcon = isSelected || open
    ? <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />
    : <Folder className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />;

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="group relative">

        {/* ── EDITING MODE: plain div (no disabled-button issues with child inputs) ── */}
        {isEditing ? (
          <div
            className={`w-full flex items-center gap-1.5 py-[5px] rounded transition-colors duration-100
              ${isDept ? "font-semibold" : "font-normal"}
              ${deleteConfirm ? "bg-red-bg" : "bg-primary-bg/30"}`}
            style={{ paddingLeft: pl, paddingRight: "8px" }}
          >
            {chevron}
            {folderIcon}

            {renaming && (
              <>
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="flex-1 text-[12px] bg-transparent border-b border-primary outline-none text-text min-w-0 py-px"
                  disabled={renameSaving}
                  autoFocus
                />
                <button onClick={handleRename} disabled={renameSaving} className="shrink-0 text-green hover:text-green ml-1">
                  {renameSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button onClick={() => setRenaming(false)} className="shrink-0 text-text-light hover:text-text">
                  <X className="w-3 h-3" />
                </button>
              </>
            )}

            {linking && (
              <>
                <input
                  ref={linkInputRef}
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLink();
                    if (e.key === "Escape") { setLinking(false); setLinkValue(node.gdrive_folder_id ?? ""); }
                  }}
                  placeholder="ID atau URL folder Drive…"
                  className="flex-1 text-[11px] bg-transparent border-b border-primary outline-none text-text min-w-0 py-px"
                  disabled={linkSaving}
                  autoFocus
                />
                <button onClick={handleLink} disabled={linkSaving} className="shrink-0 text-green hover:text-green ml-1">
                  {linkSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button onClick={() => { setLinking(false); setLinkValue(node.gdrive_folder_id ?? ""); }} className="shrink-0 text-text-light hover:text-text">
                  <X className="w-3 h-3" />
                </button>
              </>
            )}

            {deleteConfirm && (
              <>
                <span className="flex-1 text-[11px] text-red font-semibold truncate min-w-0">
                  {deleteError ?? "Hapus folder ini?"}
                </span>
                {!deleteError && (
                  <button onClick={handleDelete} disabled={deleteLoading} className="shrink-0 text-red hover:text-red ml-1">
                    {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </button>
                )}
                <button onClick={() => { setDeleteConfirm(false); setDeleteError(null); }} className="shrink-0 text-text-light hover:text-text">
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        ) : (
          /* ── NORMAL MODE: clickable button ── */
          <button
            className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left transition-colors duration-100
              ${isSelected ? "bg-primary-bg text-primary" : "hover:bg-bg-hover text-text"}
              ${isDept ? "font-semibold" : "font-normal"}`}
            style={{ paddingLeft: pl }}
            onClick={() => {
              onSelect(node);
              if (node.children.length > 0) setOpen((o) => !o);
            }}
          >
            {chevron}
            {folderIcon}
            <span className="flex-1 text-[12.5px] truncate min-w-0 flex items-center gap-1">
              {node.name}
              {isAdmin && (
                <span title={node.gdrive_folder_id ? `Drive: ${node.gdrive_folder_id}` : "Belum terhubung ke Drive"}>
                  <HardDrive className={`w-2.5 h-2.5 shrink-0 ${node.gdrive_folder_id ? "text-green opacity-70" : "text-text-light opacity-30"}`} />
                </span>
              )}
            </span>
            {node.file_count > 0 && (
              <span className="text-[10px] text-text-light shrink-0 tabular-nums">{node.file_count}</span>
            )}
          </button>
        )}

        {/* ── Hover action buttons (only in normal mode) ── */}
        {!isEditing && (
          <>
            {isAdmin && !isDept && (
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteError(null); setDeleteConfirm(true); }}
                title="Hapus folder"
                className="absolute right-[56px] top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-red/20 text-text-light hover:text-red"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={(e) => { e.stopPropagation(); setLinkValue(node.gdrive_folder_id ?? ""); setLinking(true); setTimeout(() => linkInputRef.current?.focus(), 30); }}
                title={node.gdrive_folder_id ? "Ubah link Drive" : "Hubungkan ke Drive"}
                className="absolute right-10 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 text-text-light hover:text-primary"
              >
                {node.gdrive_folder_id ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={(e) => { e.stopPropagation(); setRenameValue(node.name); setRenaming(true); setTimeout(() => renameInputRef.current?.focus(), 30); }}
                title="Ganti nama folder"
                className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 text-text-light hover:text-primary"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {canCreateFolder && (
              <button
                onClick={startCreating}
                title="Tambah sub-folder"
                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 text-text-light hover:text-primary"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </>
        )}
      </div>

      {open && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
              isAdmin={isAdmin}
              canCreateFolder={canCreateFolder}
              onFolderCreated={onFolderCreated}
            />
          ))}

          {creating && (
            <div
              className="flex items-center gap-1 py-[3px]"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px`, paddingRight: "8px" }}
            >
              <span className="w-3 shrink-0" />
              <Folder className="w-3.5 h-3.5 shrink-0 text-text-light" />
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Nama folder…"
                className="flex-1 text-[12px] bg-transparent border-b border-primary outline-none text-text min-w-0 py-px"
                disabled={saving}
                autoFocus
              />
              {saving ? (
                <Loader2 className="w-3 h-3 shrink-0 text-primary animate-spin" />
              ) : (
                <button onClick={() => { setCreating(false); setNewName(""); }} className="shrink-0 text-text-light hover:text-text">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
