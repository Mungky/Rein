"use client";

import {
  ChevronRight,
  FolderInput,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { deleteFile, getFolderFiles, getFolderTree, moveFile } from "@/lib/api/library";
import type { FolderMyPerms } from "@/lib/api/library";
import { FileList } from "@/features/library/file-list";
import { FolderTree, INDEX_FOLDER_ID, TEMP_FOLDER_ID } from "@/features/library/folder-tree";
import { NewMenu, FolderActionsMenu } from "@/features/library/folder-actions";
import { BatchUploadModal } from "@/features/library/batch-upload-modal";
import type { ApprovedItem } from "@/features/library/batch-upload-modal";
import { PublicIndex } from "@/features/library/public-index";
import { TempPanel } from "@/features/library/temp-panel";
import { useUploadQueue } from "@/features/library/use-upload-queue";
import { UploadQueuePanel } from "@/features/library/upload-queue-panel";
import { MoveModal } from "@/features/library/move-modal";
import { SyncIndicator } from "@/features/library/sync-indicator";
import type { FolderNode } from "@/features/library/types";

const ALLOWED_EXTS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"]);
const MAX_SIZE = 50 * 1024 * 1024;

function filterValidFiles(files: File[]): File[] {
  return files.filter((f) => {
    const idx = f.name.lastIndexOf(".");
    const ext = idx === -1 ? "" : f.name.slice(idx).toLowerCase();
    return ALLOWED_EXTS.has(ext) && f.size > 0 && f.size <= MAX_SIZE;
  });
}

export default function LibraryPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [tree, setTree] = useState<FolderNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  // Start closed on mobile (sidebar becomes an overlay drawer), open on desktop.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768,
  );
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 220;
    const saved = window.localStorage.getItem("library:sidebarWidth");
    const w = saved ? parseInt(saved, 10) : NaN;
    return w >= 160 && w <= 600 ? w : 220;
  });
  const [resizing, setResizing] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  const [selectedFolder, setSelectedFolderState] = useState<FolderNode | null>(null);

  const [files, setFiles] = useState<import("@/features/library/types").LibraryFileMeta[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [myPerms, setMyPerms] = useState<FolderMyPerms | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canUpload = isAdmin || Boolean(myPerms?.can_upload);
  const canCreateFolder = isAdmin || Boolean(myPerms?.can_create_folder);
  const canRenameFolder = isAdmin || Boolean(myPerms?.can_rename_folder);
  const canDeleteFolder = isAdmin || Boolean(myPerms?.can_delete_folder);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const queue = useUploadQueue();

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<{ action: string; done: number; total: number } | null>(null);

  const isSpecialFolder = selectedFolder?.id === TEMP_FOLDER_ID || selectedFolder?.id === INDEX_FOLDER_ID;
  const isRealFolder = Boolean(selectedFolder) && !isSpecialFolder;

  const subFolders = useMemo(() => {
    if (!selectedFolder) return [];
    return findNode(tree, selectedFolder.id)?.children ?? [];
  }, [tree, selectedFolder]);

  const refreshTree = useCallback(() => setTreeKey((k) => k + 1), []);

  // ── Track viewport size — mobile gets an overlay drawer ────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setSidebarOpen(!e.matches);  // auto-close on shrink, auto-open on grow
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ── Resizable sidebar (drag the divider) ──────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(160, Math.min(600, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      setResizing(false);
      window.localStorage.setItem("library:sidebarWidth", String(sidebarWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, sidebarWidth]);

  // ── Debounce search input ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchDraft), 300);
    return () => clearTimeout(id);
  }, [searchDraft]);

  // ── Browser history integration ────────────────────────────────────────────
  // Refs mirror latest tree / selection for use inside stable callbacks
  // (popstate handler, tree-loading effect) without re-subscribing.
  const treeRef = useRef<FolderNode[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  useEffect(() => { selectedIdRef.current = selectedFolder?.id ?? null; }, [selectedFolder?.id]);

  const navigateTo = useCallback((folder: FolderNode, replace = false) => {
    const changed = selectedFolder?.id !== folder.id;
    setSelectedFolderState(folder);
    if (changed) {
      const url = `?f=${encodeURIComponent(folder.id)}`;
      if (replace) {
        window.history.replaceState({ folderId: folder.id }, "", url);
      } else {
        window.history.pushState({ folderId: folder.id }, "", url);
      }
    }
  }, [selectedFolder?.id]);

  // Selecting a folder on mobile closes the overlay drawer.
  const handleSelectFolder = useCallback((folder: FolderNode) => {
    navigateTo(folder);
    if (isMobile) setSidebarOpen(false);
  }, [navigateTo, isMobile]);

  // Listen for browser back/forward — restore folder from URL or state
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const stateId = (e.state as { folderId?: string } | null)?.folderId;
      const urlId = new URLSearchParams(window.location.search).get("f");
      const id = stateId || urlId;
      if (!id) return;
      const folder = findNode(treeRef.current, id);
      if (folder) setSelectedFolderState(folder);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Breadcrumb segments → click to navigate to that level
  const breadcrumbs = useMemo(() => {
    if (!selectedFolder) return [];
    const parts = selectedFolder.path.split(" / ");
    const resolved: { name: string; folder: FolderNode | null }[] = [];
    let currentLevel = tree;
    for (const part of parts) {
      const match = currentLevel.find((n) => n.name === part) ?? null;
      resolved.push({ name: part, folder: match });
      currentLevel = match?.children ?? [];
    }
    return resolved;
  }, [tree, selectedFolder]);

  // ── Tree loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTreeLoading(true);
    getFolderTree()
      .then(({ tree }) => {
        setTree(tree);
        if (tree.length === 0) { setSelectedFolderState(null); return; }
        const urlId = new URLSearchParams(window.location.search).get("f");
        // Re-resolve the currently selected folder against the fresh tree so a
        // rename/move updates its path; if it was deleted, fall back to default.
        const currentId = selectedIdRef.current;
        if (currentId) {
          const fresh = findNode(tree, currentId);
          if (fresh) { setSelectedFolderState(fresh); return; }
        }
        const initial = (urlId && findNode(tree, urlId)) || tree[0];
        navigateTo(initial, true);
      })
      .catch(() => {})
      .finally(() => setTreeLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey]);

  // ── File loading ───────────────────────────────────────────────────────────
  // `silent` = background/auto refresh: no spinner, no list-clear. React
  // reconciles by file.id so unchanged rows keep their DOM (no re-animation,
  // no flicker) — only genuinely new/removed files change. This is what makes
  // the periodic refresh feel seamless instead of a constant reload.
  const loadFiles = useCallback((folder: FolderNode, searchTerm = "", silent = false) => {
    if (!silent) {
      setFilesLoading(true);
      setFiles([]);
      setMyPerms(null);
      setFilesError(null);
    }
    setSyncing(true);
    getFolderFiles(folder.id, { search: searchTerm || undefined })
      .then((result) => {
        setFiles(result.files);
        setFilesTotal(result.total);
        setMyPerms(result.my_perms);
        setFilesError(null);
        setLastSync(new Date());
      })
      .catch((err) => {
        // On silent refresh, keep the existing list — don't clobber with an error.
        if (!silent) setFilesError(err instanceof Error ? err.message : "Gagal memuat file");
      })
      .finally(() => {
        if (!silent) setFilesLoading(false);
        setSyncing(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFiles(selectedFolder, search);
  }, [selectedFolder, isSpecialFolder, search, loadFiles]);

  // Reset search when switching folders
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchDraft("");
    setSearch("");
  }, [selectedFolder?.id]);

  // Silent refresh — used by the 30s auto-sync, post-upload, and the manual
  // sync widget. Never clears the list or shows the full-page spinner.
  const refreshFiles = useCallback(() => {
    if (!selectedFolder || isSpecialFolder) return;
    loadFiles(selectedFolder, search, true);
  }, [selectedFolder, isSpecialFolder, search, loadFiles]);

  const handleUploadDone = useCallback(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Auto-sync every 30 s — silently, in the background.
  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    const id = setInterval(refreshFiles, 30000);
    return () => clearInterval(id);
  }, [selectedFolder, isSpecialFolder, refreshFiles]);

  // ── New-menu file picking (Upload File / Upload Folder) ──────────────────────
  const handlePickFiles = useCallback((raw: File[]) => {
    const valid = filterValidFiles(raw);
    if (valid.length > 0) setPendingFiles((q) => [...q, ...valid]);
    else if (raw.length > 0) alert("Tidak ada file yang didukung (PDF, Word, Excel, PPT, ZIP, RAR, DWG, STEP — maks 50 MB).");
  }, []);

  const handleApproveAll = useCallback((items: ApprovedItem[]) => {
    queue.add(items);
    setPendingFiles([]);
  }, [queue]);

  const handleFileDeleted = useCallback((id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    setFilesTotal((n) => n - 1);
  }, []);

  const handleFileRenamed = useCallback((id: string, newName: string) => {
    setFiles((f) => f.map((x) => (x.id === id ? { ...x, file_name: newName } : x)));
  }, []);

  const handleFileMoved = useCallback((id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    setFilesTotal((n) => n - 1);
  }, []);

  // Folder mutated via the 3-dot menu (rename/move/delete) → reload tree.
  const handleFolderChanged = useCallback(() => {
    refreshTree();
  }, [refreshTree]);

  // Clear selection when switching folders
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(new Set());
  }, [selectedFolder?.id]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = files.length > 0 && files.every((f) => prev.has(f.id));
      return allSelected ? new Set() : new Set(files.map((f) => f.id));
    });
  }, [files]);

  // Run a bulk operation with concurrency 3
  const runBulk = useCallback(async (
    ids: string[],
    label: string,
    op: (id: string) => Promise<unknown>,
  ) => {
    setBulkBusy({ action: label, done: 0, total: ids.length });
    const q = [...ids];
    let done = 0;
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const worker = async () => {
      while (q.length > 0) {
        const id = q.shift();
        if (!id) return;
        try {
          await op(id);
          succeeded.push(id);
        } catch (e) {
          failed.push({ id, error: e instanceof Error ? e.message : "Gagal" });
        }
        done += 1;
        setBulkBusy({ action: label, done, total: ids.length });
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    setBulkBusy(null);
    setSelectedIds(new Set());

    if (failed.length > 0) {
      alert(`${succeeded.length} berhasil, ${failed.length} gagal.\nContoh error: ${failed[0].error}`);
    }
    return { succeeded, failed };
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Hapus ${ids.length} file ke Trash Google Drive? (dapat dipulihkan 30 hari)`)) return;
    const { succeeded } = await runBulk(ids, "Menghapus", (id) => deleteFile(id));
    setFiles((f) => f.filter((x) => !succeeded.includes(x.id)));
    setFilesTotal((n) => n - succeeded.length);
  }, [selectedIds, runBulk]);

  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setShowBulkMove(false);
    const { succeeded } = await runBulk(ids, "Memindahkan", (id) => moveFile(id, targetFolderId));
    setFiles((f) => f.filter((x) => !succeeded.includes(x.id)));
    setFilesTotal((n) => n - succeeded.length);
  }, [selectedIds, runBulk]);

  return (
    <PageGuard permission="dcc:view">
      <div className="flex h-full overflow-hidden relative">
        {/* ── Mobile drawer backdrop ── */}
        {isMobile && sidebarOpen && (
          <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setSidebarOpen(false)} />
        )}

        {/* ── Sidebar (in-flow on desktop, overlay drawer on mobile) ── */}
        {(sidebarOpen || isMobile) && (
          <aside
            className={
              isMobile
                ? `absolute inset-y-0 left-0 z-40 w-[86%] max-w-[320px] border-r border-border bg-bg-sidebar flex flex-col overflow-hidden shadow-2xl transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
                : "shrink-0 border-r border-border bg-bg-sidebar flex flex-col overflow-hidden"
            }
            style={isMobile ? undefined : { width: sidebarWidth, minWidth: sidebarWidth }}
          >
            <div className="flex items-center gap-2 px-3.5 h-[52px] border-b border-border-soft shrink-0">
              <div className="size-7 rounded-[var(--r)] bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-[0_1px_2px_rgba(37,99,235,0.20)]">
                <FolderOpen className="w-4 h-4 text-white" />
              </div>
              <span className="text-[13px] font-bold text-text flex-1 tracking-tight">Perpustakaan</span>
              <button onClick={() => setSidebarOpen(false)} className="btn btn-ghost btn-icon btn-sm text-text-muted" title={isMobile ? "Tutup" : "Sembunyikan"}>
                {isMobile ? <X className="w-4 h-4" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {treeLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                </div>
              ) : tree.length === 0 ? (
                <p className="text-[11.5px] text-text-muted text-center py-4 px-3">
                  Belum ada folder yang dapat diakses
                </p>
              ) : (
                <FolderTree
                  tree={tree}
                  selectedId={selectedFolder?.id ?? null}
                  onSelect={handleSelectFolder}
                  isAdmin={isAdmin}
                  canCreateFolder={canCreateFolder}
                  canRenameFolder={canRenameFolder}
                  canDeleteFolder={canDeleteFolder}
                  onFolderCreated={refreshTree}
                />
              )}
            </div>
          </aside>
        )}

        {/* Resize divider (desktop only) */}
        {!isMobile && sidebarOpen && (
          <div
            onMouseDown={startResize}
            className={`w-1 cursor-col-resize shrink-0 transition-colors ${resizing ? "bg-primary/60" : "bg-transparent hover:bg-primary/30"}`}
            title="Tarik untuk mengubah lebar"
          />
        )}

        {/* ── Main content ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
          {/* Topbar */}
          <div className="flex items-center gap-1.5 px-3 sm:px-4 h-[52px] min-h-[52px] border-b border-border-soft bg-bg shrink-0">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost btn-icon btn-sm text-text-muted mr-0.5 shrink-0" title="Tampilkan folder">
                {isMobile ? <FolderOpen className="w-4 h-4" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
              </button>
            )}

            {selectedFolder && isMobile ? (
              /* Mobile: just the current folder name (full path is cramped on a phone) */
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
              >
                <span className="text-[13.5px] font-bold text-text truncate">
                  {breadcrumbs[breadcrumbs.length - 1]?.name ?? "DCC"}
                </span>
              </button>
            ) : selectedFolder ? (
              <div className="flex items-center gap-0.5 text-[13px] min-w-0 flex-1 overflow-x-auto scrollbar-none">
                <span className="text-text-light shrink-0 font-medium hidden sm:inline">DCC</span>
                {breadcrumbs.map((bc, i) => (
                  <span key={i} className="flex items-center gap-0.5 min-w-0">
                    <ChevronRight className="w-3.5 h-3.5 text-text-light shrink-0" />
                    {bc.folder ? (
                      <button
                        onClick={() => navigateTo(bc.folder!)}
                        className={`truncate px-1.5 py-1 rounded-[var(--r-sm)] hover:bg-bg-hover transition-colors ${
                          i === breadcrumbs.length - 1
                            ? "font-semibold text-text"
                            : "text-text-muted hover:text-primary"
                        }`}
                      >
                        {bc.name}
                      </button>
                    ) : (
                      <span className="truncate px-1.5 text-text-muted">{bc.name}</span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[14px] font-bold text-text flex-1">DCC — Perpustakaan Digital</span>
            )}

            {isRealFolder && (
              <>
                <NewMenu
                  folder={selectedFolder!}
                  canUpload={canUpload}
                  canCreateFolder={canCreateFolder}
                  onPickFiles={handlePickFiles}
                  onFolderCreated={refreshTree}
                />
                <FolderActionsMenu
                  folder={selectedFolder!}
                  tree={tree}
                  canRename={canRenameFolder}
                  canDelete={canDeleteFolder}
                  canMove={canRenameFolder}
                  onChanged={handleFolderChanged}
                />
              </>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {!selectedFolder ? (
              <EmptyState />
            ) : selectedFolder.id === TEMP_FOLDER_ID ? (
              <TempPanel />
            ) : selectedFolder.id === INDEX_FOLDER_ID ? (
              <PublicIndex />
            ) : filesLoading ? (
              <div className="flex justify-center items-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-text-light" />
              </div>
            ) : filesError ? (
              <div className="px-6 py-10 text-center">
                <p className="text-[13px] text-red">{filesError}</p>
              </div>
            ) : (
              <>
                {/* Search bar — at the very top */}
                <div className="px-3 sm:px-5 pt-3 sm:pt-4 pb-2 flex items-center gap-2">
                  <div className="relative flex-1 sm:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-light pointer-events-none" />
                    <input
                      type="text"
                      value={searchDraft}
                      onChange={(e) => setSearchDraft(e.target.value)}
                      placeholder="Cari file di folder ini…"
                      className="field-input pl-9 pr-8 text-[13px] w-full"
                    />
                    {searchDraft && (
                      <button onClick={() => setSearchDraft("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-light hover:text-text p-0.5 rounded transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {search && (
                    <span className="text-[11.5px] text-text-muted tabular-nums px-2.5 py-1 rounded-full bg-bg-ctrl shrink-0">
                      {filesTotal} hasil
                    </span>
                  )}
                </div>

                {/* Sub-folders */}
                {subFolders.length > 0 && (
                  <div className="px-3 sm:px-5 pt-1 pb-2">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-light mb-2">Sub-folder</p>
                    <div className="flex flex-wrap gap-2">
                      {subFolders.map((sf) => (
                        <button
                          key={sf.id}
                          onClick={() => navigateTo(sf)}
                          className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] border border-border bg-bg hover:border-primary hover:bg-primary-soft hover:shadow-[var(--shadow-xs)] text-[12.5px] font-medium text-text transition-all"
                        >
                          <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                          <span>{sf.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bulk action bar */}
                {selectedIds.size > 0 && (
                  <div className="px-3 sm:px-5 py-2.5 bg-primary-soft border-y border-primary/20 flex items-center gap-2.5 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary">
                      <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                      {selectedIds.size} file dipilih
                    </span>
                    <button onClick={() => setSelectedIds(new Set())} className="text-[11.5px] text-text-muted hover:text-text underline-offset-2 hover:underline">
                      Batal pilih
                    </button>
                    <div className="flex-1" />
                    {(isAdmin || myPerms?.can_move) && (
                      <button
                        onClick={() => setShowBulkMove(true)}
                        disabled={Boolean(bulkBusy)}
                        className="btn btn-default btn-sm gap-1.5"
                      >
                        <FolderInput className="w-3.5 h-3.5" /> Pindahkan
                      </button>
                    )}
                    {(isAdmin || myPerms?.can_delete) && (
                      <button
                        onClick={handleBulkDelete}
                        disabled={Boolean(bulkBusy)}
                        className="btn btn-default btn-sm gap-1.5 text-red border-red/30 hover:bg-red-bg hover:text-red hover:border-red"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Hapus
                      </button>
                    )}
                  </div>
                )}

                {/* Bulk busy progress */}
                {bulkBusy && (
                  <div className="px-3 sm:px-5 py-2.5 bg-amber-bg border-y border-amber/30 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber" />
                    <span className="text-[12.5px] text-amber font-medium">
                      {bulkBusy.action} {bulkBusy.done}/{bulkBusy.total}…
                    </span>
                  </div>
                )}

                <FileList
                  files={files}
                  isAdmin={isAdmin}
                  currentUserId={profile?.id}
                  tree={tree}
                  perms={myPerms}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleAll={toggleAll}
                  onDeleted={handleFileDeleted}
                  onRenamed={handleFileRenamed}
                  onMoved={handleFileMoved}
                />
              </>
            )}
          </div>
        </div>

        {/* ── Batch detection modal — only shown while pending ── */}
        {pendingFiles.length > 0 && selectedFolder && !isSpecialFolder && (
          <BatchUploadModal
            files={pendingFiles}
            folder={selectedFolder}
            onClose={() => setPendingFiles([])}
            onApproveAll={handleApproveAll}
          />
        )}

        {/* ── Bulk move modal ── */}
        {showBulkMove && selectedFolder && (
          <MoveModal
            tree={tree}
            currentFolderId={selectedFolder.id}
            onClose={() => setShowBulkMove(false)}
            onMove={handleBulkMove}
            title={`Pindahkan ${selectedIds.size} file`}
            subtitle="Pilih folder tujuan"
          />
        )}

        {/* ── Collapsible upload queue (always at bottom-right) ── */}
        <UploadQueuePanel queue={queue} onUploadDone={handleUploadDone} />

        {/* ── Floating sync widget — seamless background-refresh indicator ── */}
        {isRealFolder && (
          <SyncIndicator lastSync={lastSync} syncing={syncing} onSync={refreshFiles} />
        )}
      </div>
    </PageGuard>
  );
}

function findNode(nodes: FolderNode[], id: string): FolderNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
      <div className="size-16 rounded-[var(--r-xl)] bg-gradient-to-br from-primary-soft to-primary-bg border border-primary/15 flex items-center justify-center shadow-[var(--shadow-xs)]">
        <FolderOpen className="size-7 text-primary" />
      </div>
      <div className="max-w-sm">
        <p className="text-[15px] font-semibold text-text">Pilih folder di sebelah kiri</p>
        <p className="text-[12.5px] text-text-muted mt-1.5 leading-relaxed">
          Permission folder diatur dari Admin Dashboard. Hanya folder yang diberikan
          izin <span className="font-mono font-semibold text-text">View</span> yang akan tampil.
        </p>
      </div>
    </div>
  );
}
