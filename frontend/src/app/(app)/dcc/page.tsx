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
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { getFolderFiles, getFolderTree, getFileStatus, uploadFile } from "@/lib/api/library";
import { FileList } from "@/features/library/file-list";
import type { ProcessingFile } from "@/features/library/file-list";
import { FolderTree, INDEX_FOLDER_ID, TEMP_FOLDER_ID } from "@/features/library/folder-tree";
import { BatchUploadModal } from "@/features/library/batch-upload-modal";
import type { ApprovedItem } from "@/features/library/batch-upload-modal";
import { PublicIndex } from "@/features/library/public-index";
import { TempPanel } from "@/features/library/temp-panel";
import { UploadZone } from "@/features/library/upload-zone";
import type { FolderNode, LibraryFileMeta } from "@/features/library/types";

const ALLOWED_EXTS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"]);
const MAX_SIZE = 50 * 1024 * 1024;

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
  const [approvedQueue, setApprovedQueue] = useState<ApprovedItem[]>([]);
  const [activeUpload, setActiveUpload] = useState<{
    fileName: string;
    progress: number;
    doneCount: number;
    total: number;
  } | null>(null);
  const [toasts, setToasts] = useState<UploadToast[]>([]);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);

  const [dragOver, setDragOver] = useState(false);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const uploadingRef = useRef(false);
  const uploadTotalRef = useRef(0);
  const uploadDoneRef = useRef(0);

  const isSpecialFolder = selectedFolder?.id === TEMP_FOLDER_ID || selectedFolder?.id === INDEX_FOLDER_ID;
  const subFolders = selectedFolder ? (findNode(tree, selectedFolder.id)?.children ?? []) : [];

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

  const loadFiles = useCallback((folder: FolderNode) => {
    setFilesLoading(true);
    setFiles([]);
    getFolderFiles(folder.id)
      .then((result) => {
        if (!result.restricted) {
          setFiles(result.files);
          setFilesTotal(result.total);
        }
      })
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, []);

  // Load files when a real folder is selected
  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    loadFiles(selectedFolder);
  }, [selectedFolder, isSpecialFolder, loadFiles]);

  const refreshFiles = useCallback(() => {
    if (!selectedFolder || isSpecialFolder) return;
    getFolderFiles(selectedFolder.id)
      .then((result) => {
        if (!result.restricted) {
          setFiles(result.files);
          setFilesTotal(result.total);
        }
      })
      .catch(() => {});
  }, [selectedFolder, isSpecialFolder]);

  // Auto-refresh every 15 s
  useEffect(() => {
    if (!selectedFolder || isSpecialFolder) return;
    const id = setInterval(refreshFiles, 15000);
    return () => clearInterval(id);
  }, [selectedFolder, isSpecialFolder, refreshFiles]);

  // Poll processing files until passed/failed
  useEffect(() => {
    if (processingFiles.length === 0) return;
    const id = setInterval(async () => {
      const done: string[] = [];
      for (const pf of processingFiles) {
        try {
          const s = await getFileStatus(pf.id);
          if (s.upload_status === "passed" || s.upload_status === "failed") {
            done.push(pf.id);
            if (s.upload_status === "failed") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const failedLayer = (s.audit_layers as any[])?.find((l: any) => l.status === "failed");
              const reason: string = failedLayer?.result?.reason || failedLayer?.result?.error || "Audit gagal";
              const errId = `audit-${pf.id}`;
              setToasts((t) => [...t, { id: errId, fileName: pf.fileName, status: "error", message: reason }]);
              setTimeout(() => setToasts((t) => t.filter((x) => x.id !== errId)), 15000);
            }
          }
        } catch { /* ignore */ }
      }
      if (done.length > 0) {
        setProcessingFiles((p) => p.filter((f) => !done.includes(f.id)));
        refreshFiles();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [processingFiles, refreshFiles]);

  // Drag & drop handlers for the main content area
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!selectedFolder || isSpecialFolder) return;
    e.preventDefault();
    setDragOver(true);
  }, [selectedFolder, isSpecialFolder]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!selectedFolder || isSpecialFolder) return;
    const valid: File[] = [];
    Array.from(e.dataTransfer.files).forEach((f) => {
      const ext = "." + f.name.split(".").pop()!.toLowerCase();
      if (ALLOWED_EXTS.has(ext) && f.size > 0 && f.size <= MAX_SIZE) valid.push(f);
    });
    if (valid.length > 0) setUploadQueue((q) => [...q, ...valid]);
  }, [selectedFolder, isSpecialFolder]);

  const handleApproveAll = useCallback((items: ApprovedItem[]) => {
    uploadTotalRef.current = items.length;
    uploadDoneRef.current = 0;
    setApprovedQueue(items);
  }, []);

  // Sequential background upload processor
  useEffect(() => {
    if (approvedQueue.length === 0 || uploadingRef.current) return;
    uploadingRef.current = true;
    const item = approvedQueue[0];
    setActiveUpload({
      fileName: item.file.name,
      progress: 0,
      doneCount: uploadDoneRef.current,
      total: uploadTotalRef.current,
    });
    uploadFile(item.file, item.form, (pct) => {
      setActiveUpload((a) => a ? { ...a, progress: pct } : null);
    })
      .then((result) => {
        uploadDoneRef.current += 1;
        uploadingRef.current = false;
        const toast: UploadToast = { id: result.file_id, fileName: result.file_name, status: "done" };
        setToasts((t) => [...t, toast]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 8000);
        setProcessingFiles((p) => [...p, { id: result.file_id, fileName: result.file_name }]);
        setActiveUpload(null);
        setApprovedQueue((q) => q.slice(1));
      })
      .catch(() => {
        uploadDoneRef.current += 1;
        uploadingRef.current = false;
        const errId = `err-${Date.now()}`;
        const toast: UploadToast = { id: errId, fileName: item.file.name, status: "error", message: "Upload gagal" };
        setToasts((t) => [...t, toast]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== errId)), 8000);
        setActiveUpload(null);
        setApprovedQueue((q) => q.slice(1));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedQueue]);

  const handleFileDeleted = useCallback((id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    setFilesTotal((n) => n - 1);
  }, []);

  const handleFileRenamed = useCallback((id: string, newName: string) => {
    setFiles((f) => f.map((x) => x.id === id ? { ...x, file_name: newName } : x));
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
                <UploadZone compact onFiles={(files) => setUploadQueue((q) => [...q, ...files])} />
              ) : (
                <div className="text-[11px] text-text-muted text-center py-1">
                  {selectedFolder?.id === TEMP_FOLDER_ID ? "Panel admin" :
                   selectedFolder?.id === INDEX_FOLDER_ID ? "Index Publik" :
                   "Pilih folder untuk upload"}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {treeLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-text-light" />
                </div>
              ) : tree.length === 0 ? (
                <p className="text-[11.5px] text-text-muted text-center py-4 px-3">Belum ada folder</p>
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
        <div
          ref={mainAreaRef}
          className="flex flex-col flex-1 min-w-0 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-20 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex flex-col items-center justify-center gap-2 pointer-events-none">
              <Upload className="w-8 h-8 text-primary" />
              <p className="text-primary font-semibold text-[14px]">Lepas file di sini</p>
            </div>
          )}

          {/* Topbar */}
          <div className="flex items-center gap-2 px-4 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost btn-icon btn-sm text-text-muted mr-1">
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}
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
              <span className="text-[11.5px] text-text-muted hidden sm:block tabular-nums">{filesTotal.toLocaleString("id")} file</span>
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
            ) : (
              <>
                {subFolders.length > 0 && (
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-text-light mb-2">Sub-folder</p>
                    <div className="flex flex-wrap gap-2">
                      {subFolders.map((sf) => (
                        <button
                          key={sf.id}
                          onClick={() => setSelectedFolder(sf)}
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
                  onDeleted={handleFileDeleted}
                  onRenamed={handleFileRenamed}
                  processingFiles={processingFiles}
                />
              </>
            )}
          </div>

          {/* Drop zone at bottom for empty folders */}
          {selectedFolder && !isSpecialFolder && !filesLoading && files.length === 0 && processingFiles.length === 0 && (
            <div className="px-6 pb-6">
              <UploadZone onFiles={(files) => setUploadQueue((q) => [...q, ...files])} />
            </div>
          )}
        </div>

        {/* ── Batch upload modal ── */}
        {uploadQueue.length > 0 && selectedFolder && !isSpecialFolder && (
          <BatchUploadModal
            files={uploadQueue}
            folder={selectedFolder}
            onClose={() => setUploadQueue([])}
            onApproveAll={handleApproveAll}
          />
        )}

        {/* ── Fixed bottom-right: upload progress + toasts ── */}
        {(activeUpload || toasts.length > 0) && (
          <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-[320px]">
            {/* Active upload progress panel */}
            {activeUpload && (
              <div className="bg-bg border border-border rounded-xl shadow-2xl overflow-hidden">
                <div className="px-3.5 py-2 border-b border-border bg-bg-ctrl flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex-1">
                    Mengunggah {activeUpload.doneCount + 1}/{activeUpload.total}
                  </span>
                </div>
                <div className="px-3.5 py-2.5">
                  <div className="text-[12px] font-mono truncate text-text mb-2">{activeUpload.fileName}</div>
                  <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-200"
                      style={{ width: `${activeUpload.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10.5px] text-text-muted mt-1.5 tabular-nums">
                    <span>{approvedQueue.length > 1 ? `${approvedQueue.length - 1} file dalam antrian` : ""}</span>
                    <span>{activeUpload.progress}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Toasts */}
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
          Semua anggota dapat melihat daftar file. Akses isi file memerlukan persetujuan Pustakawan.
        </p>
      </div>
    </div>
  );
}
