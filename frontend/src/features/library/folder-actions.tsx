"use client";

import {
  Check, FilePlus2, FolderInput, FolderPlus, FolderUp, Loader2,
  MoreVertical, Pencil, Plus, Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "@/lib/api/library";
import { MoveModal, ROOT_TARGET } from "./move-modal";
import { DropdownMenu, DropdownItem } from "./dropdown-menu";
import { collectDescendantIds } from "./folder-tree";
import type { FolderNode } from "./types";

const ACCEPT = ".docx,.xlsx,.pptx,.pdf,.zip,.rar,.dwg,.step,.stp";

// =====================================================================
// "+ Baru" dropdown — Upload File / Upload Folder / Tambah Folder
// =====================================================================

export function NewMenu({
  folder, canUpload, canCreateFolder, onPickFiles, onFolderCreated,
}: {
  folder: FolderNode;
  canUpload: boolean;
  canCreateFolder: boolean;
  onPickFiles: (files: File[]) => void;
  onFolderCreated: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) onPickFiles(files);
    e.target.value = "";
  };

  if (!canUpload && !canCreateFolder) return null;

  return (
    <>
      <DropdownMenu
        button={<><Plus className="w-3.5 h-3.5" /><span className="hidden sm:inline">Baru</span></>}
        buttonClassName="btn btn-primary btn-sm gap-1.5 shrink-0"
        menuWidthClass="min-w-[190px]"
      >
        {(close) => (
          <>
            {canUpload && (
              <>
                <DropdownItem icon={<FilePlus2 className="w-4 h-4 text-text-muted" />} label="Upload file" onClick={() => { close(); fileRef.current?.click(); }} />
                <DropdownItem icon={<FolderUp className="w-4 h-4 text-text-muted" />} label="Upload folder" onClick={() => { close(); folderRef.current?.click(); }} />
              </>
            )}
            {canCreateFolder && (
              <DropdownItem icon={<FolderPlus className="w-4 h-4 text-text-muted" />} label="Tambah folder" onClick={() => { close(); setCreating(true); }} />
            )}
          </>
        )}
      </DropdownMenu>

      <input ref={fileRef} type="file" multiple className="hidden" accept={ACCEPT} onChange={handleInput} />
      <input
        ref={(el) => {
          folderRef.current = el;
          if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={handleInput}
      />

      {creating && (
        <CreateFolderDialog
          parent={folder}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); onFolderCreated(); }}
        />
      )}
    </>
  );
}

function CreateFolderDialog({ parent, onClose, onCreated }: {
  parent: FolderNode;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await createFolder({ name: trimmed, department: parent.department, folder_type: "custom", parent_id: parent.id });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat folder");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-[13px] font-semibold mb-1">Tambah folder</div>
        <div className="text-[11.5px] text-text-muted mb-3 truncate">di dalam: {parent.name}</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          placeholder="Nama folder…"
          className="field-input w-full text-[13px]"
          disabled={saving}
        />
        {error && <p className="text-[11.5px] text-red mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="btn btn-default btn-sm" disabled={saving}>Batal</button>
          <button onClick={submit} disabled={saving || !name.trim()} className="btn btn-primary btn-sm gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Buat
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Folder 3-dot actions menu (current folder, main view) — Edit / Move / Delete
// =====================================================================

export function FolderActionsMenu({
  folder, tree, canRename, canDelete, canMove, onChanged,
}: {
  folder: FolderNode;
  tree: FolderNode[];
  canRename: boolean;
  canDelete: boolean;
  canMove: boolean;
  onChanged: () => void;
}) {
  const [showRename, setShowRename] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDept = folder.folder_type === "department";
  // Department root folders cannot be renamed/deleted/moved.
  const allowRename = canRename;
  const allowDelete = canDelete && !isDept;
  const allowMove = canMove && !isDept;
  if (!allowRename && !allowDelete && !allowMove) return null;

  const doRename = async () => {
    const name = renameValue.trim();
    if (!name || name === folder.name) { setShowRename(false); return; }
    setBusy(true); setError(null);
    try {
      await renameFolder(folder.id, name);
      setShowRename(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal ganti nama");
    } finally { setBusy(false); }
  };

  const doMove = async (target: string) => {
    setShowMove(false);
    try {
      await moveFolder(folder.id, target === ROOT_TARGET ? null : target);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal memindahkan folder");
    }
  };

  const doDelete = async () => {
    if (!confirm(`Hapus folder "${folder.name}"?\nFolder & isinya akan dipindahkan ke Trash Google Drive (dapat dipulihkan 30 hari).`)) return;
    try {
      await deleteFolder(folder.id, true);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal menghapus folder");
    }
  };

  return (
    <>
      <DropdownMenu
        button={<MoreVertical className="w-3.5 h-3.5" />}
        buttonClassName="btn btn-ghost btn-icon btn-sm text-text-muted"
        buttonTitle="Aksi folder"
      >
        {(close) => (
          <>
            {allowRename && (
              <DropdownItem icon={<Pencil className="w-3.5 h-3.5 text-text-muted" />} label="Edit nama folder" onClick={() => { close(); setRenameValue(folder.name); setError(null); setShowRename(true); }} />
            )}
            {allowMove && (
              <DropdownItem icon={<FolderInput className="w-3.5 h-3.5 text-text-muted" />} label="Pindahkan folder" onClick={() => { close(); setShowMove(true); }} />
            )}
            {allowDelete && (
              <DropdownItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Hapus folder" danger onClick={() => { close(); doDelete(); }} />
            )}
          </>
        )}
      </DropdownMenu>

      {showRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowRename(false)}>
          <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-semibold mb-3">Edit nama folder</div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setShowRename(false); }}
              className="field-input w-full text-[13px]"
              disabled={busy}
            />
            {error && <p className="text-[11.5px] text-red mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowRename(false)} className="btn btn-default btn-sm" disabled={busy}>Batal</button>
              <button onClick={doRename} disabled={busy || !renameValue.trim()} className="btn btn-primary btn-sm gap-1.5">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {showMove && (
        <MoveModal
          tree={tree}
          currentFolderId={folder.id}
          disabledIds={collectDescendantIds(folder)}
          onClose={() => setShowMove(false)}
          onMove={doMove}
          title="Pindahkan Folder"
          subtitle={`Pilih folder tujuan untuk "${folder.name}"`}
        />
      )}
    </>
  );
}
