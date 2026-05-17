"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { getFolderFiles, getFolderTree } from "@/lib/api/library";
import { FileList } from "@/features/library/file-list";
import { FolderTree, INDEX_FOLDER_ID, TEMP_FOLDER_ID } from "@/features/library/folder-tree";
import { ProposeModal } from "@/features/library/propose-modal";
import { PublicIndex } from "@/features/library/public-index";
import { TempPanel } from "@/features/library/temp-panel";
import { UploadZone } from "@/features/library/upload-zone";
import type { FolderNode, LibraryFileMeta } from "@/features/library/types";

interface UploadToast {
  id: string;
  fileName: string;
  status: "done" | "error";
  message?: string;
}

export default function LibraryPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const canCreateFolder = ["admin", "director", "manager", "operational_manager"].includes(profile?.role ?? "");

  const [tree, setTree] = useState<FolderNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [treeKey, setTreeKey] = useState(0);

  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null);
  const [files, setFiles] = useState<LibraryFileMeta[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesTotal, setFilesTotal] = useState(0);

  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [toasts, setToasts] = useState<UploadToast[]>([]);

  const isSpecialFolder = selectedFolder?.id === TEMP_FOLDER_ID || selectedFolder?.id === INDEX_FOLDER_ID;

  const refreshTree = useCallback(() => setTreeKey((k) => k + 1), []);

  // Load folder tree on mount and on refresh
  useEffect(() => {
    setTreeLoading(true);
    getFolderTree()
      .then(({ tree }) => {
        setTree(tree);
        if (tree.length > 0 && !selectedFolder) setSelectedFolder(tree[0]);
      })
      .catch(() => {})
      .finally(() => setTreeLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey]);

  // Load files when a real folder is selected
  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    setFilesLoading(true);
    setFiles([]);
    getFolderFiles(selectedFolder.id)
      .then((result) => {
        if (!result.restricted) {
          setFiles(result.files);
          setFilesTotal(result.total);
        }
      })
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [selectedFolder, isSpecialFolder]);

  const refreshFiles = useCallback(() => {
    if (!selectedFolder || isSpecialFolder) return;
    setFilesLoading(true);
    getFolderFiles(selectedFolder.id)
      .then((result) => {
        if (!result.restricted) {
          setFiles(result.files);
          setFilesTotal(result.total);
        }
      })
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [selectedFolder, isSpecialFolder]);

  const advanceQueue = useCallback(() => {
    setUploadQueue((q) => q.slice(1));
  }, []);

  const handleUploadSuccess = useCallback((fileId: string, fileName: string) => {
    const toast: UploadToast = { id: fileId, fileName, status: "done" };
    setToasts((t) => [...t, toast]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 8000);
    advanceQueue();
  }, [advanceQueue]);

  const handleFileDeleted = useCallback((id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    setFilesTotal((n) => n - 1);
  }, []);

  return (
    <PageGuard permission="dcc:view">
      <div className="flex h-full overflow-hidden">
        {/* ── Sidebar ── */}
        {sidebarOpen && (
          <aside className="w-[220px] min-w-[220px] shrink-0 border-r border-border bg-bg-sidebar flex flex-col overflow-hidden">
            {/* Sidebar header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
              <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12.5px] font-bold flex-1">Perpustakaan</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="btn btn-ghost btn-icon btn-sm text-text-muted"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Upload zone — hidden for special panels */}
            <div className="px-3 py-2.5 border-b border-border shrink-0">
              {selectedFolder && !isSpecialFolder ? (
                <UploadZone compact onFiles={(files) => setUploadQueue((q) => [...q, ...files])} />
              ) : (
                <div className="text-[11px] text-text-muted text-center py-1">
                  {selectedFolder?.id === TEMP_FOLDER_ID ? "Panel admin" :
                   selectedFolder?.id === INDEX_FOLDER_ID ? "Index Publik" :
                   "Pilih folder untuk upload"}
                </div>
              )}
            </div>

            {/* Folder tree */}
            <div className="flex-1 overflow-y-auto py-1">
              {treeLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-text-light" />
                </div>
              ) : tree.length === 0 ? (
                <p className="text-[11.5px] text-text-muted text-center py-4 px-3">
                  Belum ada folder
                </p>
              ) : (
                <FolderTree
                  tree={tree}
                  selectedId={selectedFolder?.id ?? null}
                  onSelect={setSelectedFolder}
                  isAdmin={isAdmin}
                  canCreateFolder={canCreateFolder}
                  onFolderCreated={refreshTree}
                />
              )}
            </div>
          </aside>
        )}

        {/* ── Main content ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Topbar */}
          <div className="flex items-center gap-2 px-4 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="btn btn-ghost btn-icon btn-sm text-text-muted mr-1"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Breadcrumb */}
            {selectedFolder ? (
              <div className="flex items-center gap-1 text-[12.5px] min-w-0">
                <span className="text-text-muted shrink-0">DCC</span>
                {selectedFolder.path.split(" / ").map((part, i, arr) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <ChevronRight className="w-3 h-3 text-text-light shrink-0" />
                    <span className={`truncate ${i === arr.length - 1 ? "font-semibold text-text" : "text-text-muted"}`}>
                      {part}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[12.5px] font-bold text-text">DCC — Perpustakaan Digital</span>
            )}

            <div className="flex-1" />

            {filesTotal > 0 && (
              <span className="text-[11.5px] text-text-muted hidden sm:block tabular-nums">
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

          {/* Main content area */}
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
            ) : (
              <FileList
                files={files}
                isAdmin={isAdmin}
                onDeleted={handleFileDeleted}
              />
            )}
          </div>

          {/* Drop zone at bottom for empty real folders */}
          {selectedFolder && !isSpecialFolder && !filesLoading && files.length === 0 && (
            <div className="px-6 pb-6">
              <UploadZone onFiles={(files) => setUploadQueue((q) => [...q, ...files])} />
            </div>
          )}
        </div>

        {/* ── Propose modal — only for real folders ── */}
        {uploadQueue.length > 0 && selectedFolder && !isSpecialFolder && (
          <ProposeModal
            file={uploadQueue[0]}
            folder={selectedFolder}
            onClose={() => setUploadQueue([])}
            onSuccess={handleUploadSuccess}
            onSkip={advanceQueue}
            queueIndex={0}
            queueTotal={uploadQueue.length}
          />
        )}

        {/* ── Upload toasts ── */}
        {toasts.length > 0 && (
          <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 max-w-[340px]">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`flex items-start gap-2.5 px-3.5 py-3 rounded-lg border shadow-lg
                  ${t.status === "done" ? "bg-green-bg border-green/20" : "bg-red-bg border-red/20"}`}
              >
                {t.status === "done" ? (
                  <CheckCircle className="w-4 h-4 text-green shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className={`text-[12.5px] font-semibold truncate ${t.status === "done" ? "text-green" : "text-red"}`}>
                    {t.fileName}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {t.status === "done"
                      ? "File diterima — sedang melewati 4-layer audit di background"
                      : t.message ?? "Upload gagal"}
                  </div>
                </div>
                <button
                  onClick={() => setToasts((x) => x.filter((i) => i.id !== t.id))}
                  className="text-text-light hover:text-text text-[14px] leading-none shrink-0 ml-auto"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageGuard>
  );
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
          Semua anggota dapat melihat daftar file. Akses isi file memerlukan persetujuan Pustakawan.
        </p>
      </div>
    </div>
  );
}
