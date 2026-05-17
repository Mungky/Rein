"use client";

import { BookOpen, Check, ChevronDown, ChevronRight, Clock, Folder, FolderOpen, Loader2, Pencil, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { createFolder, renameFolder } from "@/lib/api/library";
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

      {/* Index Publik — visible to all roles */}
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

      {/* Riwayat & Sementara — admin only */}
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

  const isSelected = selectedId === node.id;
  const deptColor = DEPT_COLORS[node.department] ?? "text-text-muted";
  const isDept = node.folder_type === "department";

  const startCreating = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    setCreating(true);
    setNewName("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelCreating = () => {
    setCreating(false);
    setNewName("");
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
    } catch {
      // keep input open so user can retry
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name || name === node.name) { setRenaming(false); return; }
    setRenameSaving(true);
    try {
      await renameFolder(node.id, name);
      setRenaming(false);
      onFolderCreated?.(); // refreshes tree
    } catch { /* keep input open */ } finally { setRenameSaving(false); }
  };

  return (
    <div>
      <div className="group relative">
        <button
          className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left transition-colors duration-100
            ${isSelected ? "bg-primary-bg text-primary" : "hover:bg-bg-hover text-text"}
            ${isDept ? "font-semibold" : "font-normal"}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          disabled={renaming}
          onClick={() => {
            onSelect(node);
            if (node.children.length > 0) setOpen((o) => !o);
          }}
        >
          {node.children.length > 0 ? (
            open ? (
              <ChevronDown className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />
            ) : (
              <ChevronRight className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isSelected || open ? (
            <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />
          ) : (
            <Folder className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />
          )}
          {renaming ? (
            <div className="flex items-center gap-0.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setRenaming(false); }
                }}
                className="flex-1 text-[12px] bg-transparent border-b border-primary outline-none text-text min-w-0 py-px"
                disabled={renameSaving}
              />
              <button onClick={handleRename} disabled={renameSaving} className="shrink-0 text-green hover:text-green">
                {renameSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
              <button onClick={() => setRenaming(false)} className="shrink-0 text-text-light hover:text-text">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span className="flex-1 text-[12.5px] truncate min-w-0">{node.name}</span>
          )}
          {node.file_count > 0 && !renaming && (
            <span className="text-[10px] text-text-light shrink-0 tabular-nums">
              {node.file_count}
            </span>
          )}
        </button>

        {isAdmin && !renaming && (
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
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity
              w-4 h-4 flex items-center justify-center rounded hover:bg-primary/20 text-text-light hover:text-primary"
          >
            <Plus className="w-3 h-3" />
          </button>
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
              className="flex items-center gap-1 px-2 py-[3px]"
              style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
            >
              <span className="w-3 shrink-0" />
              <Folder className="w-3.5 h-3.5 shrink-0 text-text-light" />
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") cancelCreating();
                }}
                placeholder="Nama folder…"
                className="flex-1 text-[12px] bg-transparent border-b border-primary outline-none text-text min-w-0 py-px"
                disabled={saving}
              />
              {saving ? (
                <Loader2 className="w-3 h-3 shrink-0 text-primary animate-spin" />
              ) : (
                <button onClick={cancelCreating} className="shrink-0 text-text-light hover:text-text">
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
