"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { getFolderFiles, getFolderTree } from "@/lib/api/library";
import { FileList } from "@/features/library/file-list";
import { FolderTree, INDEX_FOLDER_ID, TEMP_FOLDER_ID } from "@/features/library/folder-tree";
import { BatchUploadModal } from "@/features/library/batch-upload-modal";
import type { ApprovedItem } from "@/features/library/batch-upload-modal";
import { PublicIndex } from "@/features/library/public-index";
import { TempPanel } from "@/features/library/temp-panel";
import { UploadZone } from "@/features/library/upload-zone";
import { useUploadQueue } from "@/features/library/use-upload-queue";
import { UploadQueuePanel } from "@/features/library/upload-queue-panel";
import { extractFilesFromDrop } from "@/features/library/file-system-utils";
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
  const canCreateFolder = isAdmin || profile?.role === "director" || profile?.role === "manager" || profile?.role === "operational_manager";

  const [tree, setTree] = useState<FolderNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [treeKey, setTreeKey] = useState(0);

  // Navigation history (back/forward stack)
  const [history, setHistory] = useState<FolderNode[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const selectedFolder = historyIndex >= 0 ? history[historyIndex] : null;

  const [files, setFiles] = useState<import("@/features/library/types").LibraryFileMeta[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const queue = useUploadQueue();

  const [dragOver, setDragOver] = useState(false);
  const mainAreaRef = useRef<HTMLDivElement>(null);

  const isSpecialFolder = selectedFolder?.id === TEMP_FOLDER_ID || selectedFolder?.id === INDEX_FOLDER_ID;

  const subFolders = useMemo(() => {
    if (!selectedFolder) return [];
    return findNode(tree, selectedFolder.id)?.children ?? [];
  }, [tree, selectedFolder]);

  const refreshTree = useCallback(() => setTreeKey((k) => k + 1), []);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const navigateTo = useCallback((folder: FolderNode) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIndex + 1);
      // Skip pushing if already current
      if (truncated[truncated.length - 1]?.id === folder.id) return prev;
      const next = [...truncated, folder];
      // Cap history at 50 entries
      if (next.length > 50) next.splice(0, next.length - 50);
      return next;
    });
    setHistoryIndex((idx) => {
      const truncated = history.slice(0, idx + 1);
      if (truncated[truncated.length - 1]?.id === folder.id) return idx;
      return Math.min(truncated.length, 49);
    });
  }, [history, historyIndex]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const goBack = useCallback(() => {
    if (canGoBack) setHistoryIndex((i) => i - 1);
  }, [canGoBack]);
  const goForward = useCallback(() => {
    if (canGoForward) setHistoryIndex((i) => i + 1);
  }, [canGoForward]);

  // Breadcrumb segments → click to navigate to that level
  const breadcrumbs = useMemo(() => {
    if (!selectedFolder) return [];
    const parts = selectedFolder.path.split(" / ");
    // Resolve each segment to a folder by walking the tree
    const resolved: { name: string; folder: FolderNode | null }[] = [];
    let currentLevel = tree;
    let cumulativePath = "";
    for (const part of parts) {
      cumulativePath = cumulativePath ? `${cumulativePath} / ${part}` : part;
      const match = currentLevel.find((n) => n.name === part) ?? null;
      resolved.push({ name: part, folder: match });
      currentLevel = match?.children ?? [];
    }
    return resolved;
  }, [tree, selectedFolder]);

  // ── Tree loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    setTreeLoading(true);
    getFolderTree()
      .then(({ tree }) => {
        setTree(tree);
        if (tree.length > 0 && historyIndex === -1) {
          setHistory([tree[0]]);
          setHistoryIndex(0);
        }
      })
      .catch(() => {})
      .finally(() => setTreeLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey]);

  // ── File loading ───────────────────────────────────────────────────────────
  const loadFiles = useCallback((folder: FolderNode) => {
    setFilesLoading(true);
    setFiles([]);
    setFilesError(null);
    getFolderFiles(folder.id)
      .then((result) => {
        setFiles(result.files);
        setFilesTotal(result.total);
      })
      .catch((err) => {
        setFilesError(err instanceof Error ? err.message : "Gagal memuat file");
      })
      .finally(() => setFilesLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    loadFiles(selectedFolder);
  }, [selectedFolder, isSpecialFolder, loadFiles]);

  const refreshFiles = useCallback(() => {
    if (!selectedFolder || isSpecialFolder) return;
    loadFiles(selectedFolder);
  }, [selectedFolder, isSpecialFolder, loadFiles]);

  // Auto-refresh after a successful batch
  const handleUploadDone = useCallback(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Auto-refresh every 30 s
  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    const id = setInterval(refreshFiles, 30000);
    return () => clearInterval(id);
  }, [selectedFolder, isSpecialFolder, refreshFiles]);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!selectedFolder || isSpecialFolder) return;
    e.preventDefault();
    setDragOver(true);
  }, [selectedFolder, isSpecialFolder]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!selectedFolder || isSpecialFolder) return;
    const allFiles = await extractFilesFromDrop(e.nativeEvent);
    const valid = filterValidFiles(allFiles);
    if (valid.length > 0) setPendingFiles((q) => [...q, ...valid]);
  }, [selectedFolder, isSpecialFolder]);

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

  return (
    <PageGuard permission="dcc:view">
      <div className="flex h-full overflow-hidden">
        {/* ── Sidebar ── */}
        {sidebarOpen && (
          <aside className="w-[220px] min-w-[220px] shrink-0 border-r border-border bg-bg-sidebar flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
              <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12.5px] font-bold flex-1">Perpustakaan</span>
              <button onClick={() => setSidebarOpen(false)} className="btn btn-ghost btn-icon btn-sm text-text-muted">
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="px-3 py-2.5 border-b border-border shrink-0">
              {selectedFolder && !isSpecialFolder ? (
                <UploadZone compact onFiles={(files) => setPendingFiles((q) => [...q, ...files])} />
              ) : (
                <div className="text-[11px] text-text-muted text-center py-1">
                  {selectedFolder?.id === TEMP_FOLDER_ID ? "Panel admin"
                    : selectedFolder?.id === INDEX_FOLDER_ID ? "Index Publik"
                    : "Pilih folder untuk upload"}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {treeLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-text-light" />
                </div>
              ) : tree.length === 0 ? (
                <p className="text-[11.5px] text-text-muted text-center py-4 px-3">
                  Belum ada folder yang dapat diakses
                </p>
              ) : (
                <FolderTree
                  tree={tree}
                  selectedId={selectedFolder?.id ?? null}
                  onSelect={navigateTo}
                  isAdmin={isAdmin}
                  canCreateFolder={canCreateFolder}
                  onFolderCreated={refreshTree}
                />
              )}
            </div>
          </aside>
        )}

        {/* ── Main content ── */}
        <div
          ref={mainAreaRef}
          className="flex flex-col flex-1 min-w-0 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="absolute inset-0 z-20 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex flex-col items-center justify-center gap-2 pointer-events-none">
              <Upload className="w-8 h-8 text-primary" />
              <p className="text-primary font-semibold text-[14px]">Lepas file atau folder di sini</p>
            </div>
          )}

          {/* Topbar with back/forward + clickable breadcrumb */}
          <div className="flex items-center gap-1 px-4 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost btn-icon btn-sm text-text-muted mr-1">
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={goBack}
              disabled={!canGoBack}
              className="btn btn-ghost btn-icon btn-sm text-text-muted disabled:opacity-30"
              title="Kembali"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={goForward}
              disabled={!canGoForward}
              className="btn btn-ghost btn-icon btn-sm text-text-muted disabled:opacity-30"
              title="Maju"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-border mx-1" />

            {selectedFolder ? (
              <div className="flex items-center gap-0.5 text-[12.5px] min-w-0 flex-1 overflow-x-auto scrollbar-none">
                <span className="text-text-muted shrink-0">DCC</span>
                {breadcrumbs.map((bc, i) => (
                  <span key={i} className="flex items-center gap-0.5 min-w-0">
                    <ChevronRight className="w-3 h-3 text-text-light shrink-0" />
                    {bc.folder ? (
                      <button
                        onClick={() => navigateTo(bc.folder!)}
                        className={`truncate px-1 py-0.5 rounded hover:bg-bg-hover transition-colors ${
                          i === breadcrumbs.length - 1
                            ? "font-semibold text-text"
                            : "text-text-muted hover:text-text"
                        }`}
                      >
                        {bc.name}
                      </button>
                    ) : (
                      <span className="truncate px-1 text-text-muted">{bc.name}</span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[12.5px] font-bold text-text flex-1">DCC — Perpustakaan Digital</span>
            )}

            {filesTotal > 0 && (
              <span className="text-[11.5px] text-text-muted hidden sm:block tabular-nums shrink-0">
                {filesTotal.toLocaleString("id")} file
              </span>
            )}
            <button
              onClick={refreshFiles}
              disabled={filesLoading || !selectedFolder}
              className="btn btn-ghost btn-icon btn-sm text-text-muted"
              title="Segarkan"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? "animate-spin" : ""}`} />
            </button>
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
                {subFolders.length > 0 && (
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-text-light mb-2">Sub-folder</p>
                    <div className="flex flex-wrap gap-2">
                      {subFolders.map((sf) => (
                        <button
                          key={sf.id}
                          onClick={() => navigateTo(sf)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-ctrl hover:bg-bg-hover text-[12px] font-medium text-text transition-colors"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span>{sf.name}</span>
                          {sf.file_count > 0 && (
                            <span className="text-[10.5px] text-text-muted tabular-nums ml-1">({sf.file_count})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <FileList
                  files={files}
                  isAdmin={isAdmin}
                  currentUserId={profile?.id}
                  tree={tree}
                  onDeleted={handleFileDeleted}
                  onRenamed={handleFileRenamed}
                  onMoved={handleFileMoved}
                />
              </>
            )}
          </div>

          {selectedFolder && !isSpecialFolder && !filesLoading && files.length === 0 && (
            <div className="px-6 pb-6">
              <UploadZone onFiles={(files) => setPendingFiles((q) => [...q, ...files])} />
            </div>
          )}
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

        {/* ── Collapsible upload queue (always at bottom-right) ── */}
        <UploadQueuePanel queue={queue} onUploadDone={handleUploadDone} />
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
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-bg-ctrl border border-border flex items-center justify-center">
        <FolderOpen className="w-6 h-6 text-text-light" />
      </div>
      <div>
        <p className="text-[14px] font-semibold text-text">Pilih folder di sebelah kiri</p>
        <p className="text-[12px] text-text-muted mt-1">
          Permission folder diatur dari Admin Dashboard. Hanya folder yang diberikan
          izin <span className="font-mono">View</span> yang akan tampil.
        </p>
      </div>
    </div>
  );
}
