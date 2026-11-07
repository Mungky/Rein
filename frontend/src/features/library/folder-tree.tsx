"use client";

import { BookOpen, Check, ChevronDown, ChevronRight, Clock, Folder, FolderInput, FolderOpen, FolderPlus, Loader2, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "@/lib/api/library";
import { MoveModal, ROOT_TARGET } from "./move-modal";
import { DropdownMenu, DropdownItem } from "./dropdown-menu";
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

/** Collect the id of a node and all of its descendants (for move-target disabling). */
export function collectDescendantIds(node: FolderNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of collectDescendantIds(child)) ids.add(id);
  }
  return ids;
}

interface FolderTreeProps {
  tree: FolderNode[];
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
  isAdmin?: boolean;
  canCreateFolder?: boolean;
  canRenameFolder?: boolean;
  canDeleteFolder?: boolean;
  onFolderCreated?: () => void;
}

// Per-department folder-icon color. Keyed by the canonical department slugs
// (see db/scripts/seed_library_folders_v2.py). Curated hues that read well on
// both light and dark sidebars. Sub-folders stay neutral — only dept roots get color.
const DEPT_COLORS: Record<string, string> = {
  accounting:              "text-teal-600 dark:text-teal-400", // teal
  directorate:             "text-violet-600 dark:text-violet-400", // violet
  engineering:             "text-blue-600 dark:text-blue-400", // blue
  field_operational:       "text-orange-600 dark:text-orange-400", // orange
  finance:                 "text-emerald-600 dark:text-emerald-400", // green
  hse:                     "text-red-600 dark:text-red-400", // red
  human_resources:         "text-amber-600 dark:text-amber-400", // amber
  management:              "text-indigo-600 dark:text-indigo-400", // indigo
  purchasing_procurement:  "text-pink-600 dark:text-pink-400", // pink
  warehouse:               "text-cyan-600 dark:text-cyan-400", // cyan
  // Legacy slugs (pre-v2) — kept so any lingering old folders still show color.
  hr:                      "text-amber-600 dark:text-amber-400",
  purchasing:              "text-pink-600 dark:text-pink-400",
};

export function FolderTree({ tree, selectedId, onSelect, isAdmin, canCreateFolder, canRenameFolder, canDeleteFolder, onFolderCreated }: FolderTreeProps) {
  const isTemp = selectedId === TEMP_FOLDER_ID;
  const isIndex = selectedId === INDEX_FOLDER_ID;

  return (
    <nav className="flex flex-col gap-0.5 py-1">
      {tree.map((node) => (
        <FolderItem
          key={node.id}
          node={node}
          tree={tree}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
          isAdmin={isAdmin}
          canCreateFolder={canCreateFolder}
          canRenameFolder={canRenameFolder}
          canDeleteFolder={canDeleteFolder}
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
  tree,
  selectedId,
  onSelect,
  depth,
  isAdmin,
  canCreateFolder,
  canRenameFolder,
  canDeleteFolder,
  onFolderCreated,
}: {
  node: FolderNode;
  tree: FolderNode[];
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
  depth: number;
  isAdmin?: boolean;
  canCreateFolder?: boolean;
  canRenameFolder?: boolean;
  canDeleteFolder?: boolean;
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

  const [showMove, setShowMove] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cascadeCount, setCascadeCount] = useState<number | null>(null);

  const isSelected = selectedId === node.id;
  const deptColor = DEPT_COLORS[node.department] ?? "text-text-muted";
  const isDept = node.folder_type === "department";
  const isEditing = renaming || deleteConfirm;

  const showCreate = Boolean(canCreateFolder);
  const showRename = Boolean(isAdmin || canRenameFolder);
  const showDelete = Boolean((isAdmin || canDeleteFolder) && !isDept);
  const showMoveAction = Boolean((isAdmin || canRenameFolder) && !isDept);
  const hasMenu = showCreate || showRename || showDelete || showMoveAction;

  const pl = `${8 + depth * 16}px`;

  // ── handlers ────────────────────────────────────────────────────────────────

  const startCreating = () => {
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

  const startRename = () => {
    setRenameValue(node.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 30);
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

  const handleMove = async (target: string) => {
    setShowMove(false);
    try {
      await moveFolder(node.id, target === ROOT_TARGET ? null : target);
      onFolderCreated?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal memindahkan folder");
    }
  };

  const handleDelete = async (cascade = false) => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteFolder(node.id, cascade);
      setDeleteConfirm(false);
      setCascadeCount(null);
      onFolderCreated?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal menghapus folder";
      const match = msg.match(/memiliki (\d+) file aktif/);
      if (match) {
        setCascadeCount(parseInt(match[1], 10));
        setDeleteError(null);
      } else {
        setDeleteError(msg);
      }
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

            {deleteConfirm && (
              <>
                <span className="flex-1 text-[11px] font-semibold truncate min-w-0 text-red">
                  {deleteError
                    ? deleteError
                    : cascadeCount !== null
                      ? `Folder berisi ${cascadeCount} file. Hapus semua ke Trash Drive?`
                      : "Hapus folder ini?"}
                </span>
                {!deleteError && (
                  <button
                    onClick={() => handleDelete(cascadeCount !== null)}
                    disabled={deleteLoading}
                    className="shrink-0 text-red hover:text-red ml-1"
                    title={cascadeCount !== null ? "Hapus folder + semua isi" : "Hapus folder kosong"}
                  >
                    {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </button>
                )}
                <button
                  onClick={() => { setDeleteConfirm(false); setDeleteError(null); setCascadeCount(null); }}
                  className="shrink-0 text-text-light hover:text-text"
                >
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
            style={{ paddingLeft: pl, paddingRight: hasMenu ? "28px" : "8px" }}
            onClick={() => {
              onSelect(node);
              if (node.children.length > 0) setOpen((o) => !o);
            }}
          >
            {chevron}
            {folderIcon}
            <span className="flex-1 text-[12.5px] truncate min-w-0">{node.name}</span>
          </button>
        )}

        {/* ── 3-dot actions menu (normal mode only) ── */}
        {!isEditing && hasMenu && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2">
            <DropdownMenu
              button={<MoreVertical className="w-3.5 h-3.5" />}
              buttonClassName="w-5 h-5 flex items-center justify-center rounded transition-colors text-text-light hover:text-text hover:bg-bg-hover opacity-0 group-hover:opacity-100 aria-expanded:opacity-100"
              buttonTitle="Aksi folder"
              menuWidthClass="min-w-[168px]"
            >
              {(close) => (
                <>
                  {showCreate && (
                    <DropdownItem icon={<FolderPlus className="w-3.5 h-3.5 text-text-muted" />} label="Tambah sub-folder" onClick={() => { close(); startCreating(); }} />
                  )}
                  {showRename && (
                    <DropdownItem icon={<Pencil className="w-3.5 h-3.5 text-text-muted" />} label="Ganti nama" onClick={() => { close(); startRename(); }} />
                  )}
                  {showMoveAction && (
                    <DropdownItem icon={<FolderInput className="w-3.5 h-3.5 text-text-muted" />} label="Pindahkan" onClick={() => { close(); setShowMove(true); }} />
                  )}
                  {showDelete && (
                    <DropdownItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Hapus" danger onClick={() => { close(); setDeleteError(null); setDeleteConfirm(true); }} />
                  )}
                </>
              )}
            </DropdownMenu>
          </div>
        )}
      </div>

      {showMove && (
        <MoveModal
          tree={tree}
          currentFolderId={node.id}
          disabledIds={collectDescendantIds(node)}
          onClose={() => setShowMove(false)}
          onMove={handleMove}
          title="Pindahkan Folder"
          subtitle={`Pilih folder tujuan untuk "${node.name}"`}
        />
      )}

      {open && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              tree={tree}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
              isAdmin={isAdmin}
              canCreateFolder={canCreateFolder}
              canRenameFolder={canRenameFolder}
              canDeleteFolder={canDeleteFolder}
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
