"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  History,
  Info,
  Layers,
  Loader2,
  Package,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { workspaceApi, type Task, type TaskStatus } from "@/lib/api/workspace";
import type { WorkOrderDetail as Detail, WorkOrderFile, WorkLog } from "@/lib/api/workspace-logbook";
import { apiErrorText } from "@/lib/api/client";
import { dateLabel, duration } from "./operations-ui";
import { WorkOrderForm, getFileIcon, todayLocal } from "./work-order-form";
import { StatusBadge } from "./shared/status-badge";
import { AvatarGroup } from "./compact-ui";
import { workOrderLabel, materialStatuses, formatFileSize } from "./work-order-ui";
import { WorkOrderStatus } from "./work-order-status";

function formatIndonesianDate(dateStr: string) {
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(d);
  } catch {
    return dateStr;
  }
}

function WorkOrderLogForm({
  api,
  taskId,
  onSaved,
  onCancel,
}: {
  api: typeof workspaceApi;
  taskId: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [logFiles, setLogFiles] = useState<File[]>([]);
  const [isIssue, setIsIssue] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState(todayLocal());
  const [hours, setHours] = useState("");
  const [body, setBody] = useState("");

  function appendLogFiles(newFiles: File[]) {
    setLogFiles((prev) => {
      const keys = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const unique = newFiles.filter(
        (f) => !keys.has(`${f.name}-${f.size}-${f.lastModified}`) && f.size > 0
      );
      return [...prev, ...unique];
    });
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError("Uraian pekerjaan wajib diisi");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.addWorkLog(
        taskId,
        {
          request_id: crypto.randomUUID(),
          work_date: date,
          body: body.trim(),
          minutes: Math.round(Number(hours || 0) * 60),
          is_issue: isIssue,
        },
        logFiles
      );
      setLogFiles([]);
      setIsIssue(false);
      setBody("");
      setHours("");
      await onSaved();
    } catch (err) {
      setError(apiErrorText(err, "Gagal menyimpan logbook"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-bg p-5 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-border-soft pb-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-text">Catat Logbook Harian</h3>
          <p className="text-xs text-text-muted">
            Laporkan pekerjaan, jam kerja, dan dokumentasi foto lapangan
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost btn-icon btn-sm text-text-muted hover:text-text"
        >
          <X className="size-4" />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 font-medium">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void handleLogSubmit(e)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-semibold text-text">
              Tanggal Pekerjaan <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className="field-input text-sm py-2 px-3"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-semibold text-text">
              Durasi Kerja (Jam)
            </label>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Contoh: 3.5 (jam)"
                className="field-input pl-9 text-sm py-2"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-semibold text-text">
            Uraian Pekerjaan & Hasil Hari Ini <span className="text-red-500">*</span>
          </label>
          <textarea
            required
            rows={4}
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Jelaskan progres pekerjaan: bagian mana yang dikerjakan, berapa sambungan las/pemotongan yang selesai, atau kendala lapangan..."
            className="field-input resize-y py-2.5 px-3 text-sm leading-relaxed"
          />
        </div>

        {/* Issue toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isIssue}
          onClick={() => setIsIssue(!isIssue)}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all ${
            isIssue
              ? "border-amber-500/60 bg-amber-500/10 shadow-2xs"
              : "border-border bg-bg-ctrl/20 hover:border-amber-500/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                isIssue ? "bg-amber-500 text-white" : "bg-amber-500/15 text-amber-600"
              }`}
            >
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold text-text">
                Tandai sebagai Kendala / Blocker
              </p>
              <p className="text-[11px] text-text-muted">
                Aktifkan bila ada keterlambatan material, gambar belum jelas, atau kendala alat.
              </p>
            </div>
          </div>
          <div
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              isIssue ? "bg-amber-500" : "bg-border"
            }`}
          >
            <span
              className={`inline-block size-4 transform rounded-full bg-white shadow-xs transition ${
                isIssue ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </div>
        </button>

        {/* Drag & drop upload */}
        <div className="space-y-2">
          <label className="block text-xs sm:text-sm font-semibold text-text">
            Dokumentasi Foto & Lampiran (Opsional)
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) appendLogFiles(Array.from(e.dataTransfer.files));
            }}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border bg-bg-ctrl/15 hover:border-primary/40"
            }`}
          >
            <UploadCloud className="mb-1.5 size-7 text-primary" />
            <p className="text-xs sm:text-sm text-text font-medium">
              Tarik foto hasil kerja ke sini, atau{" "}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="font-bold text-primary hover:underline"
              >
                pilih berkas
              </button>
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Mendukung foto lapangan (.jpg, .png) dan dokumen
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) appendLogFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          {logFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{logFiles.length} berkas siap dilampirkan:</span>
                <button
                  type="button"
                  onClick={() => setLogFiles([])}
                  className="text-red-600 hover:underline"
                >
                  Hapus semua
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {logFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${file.size}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg p-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {getFileIcon(file.name, "size-4 text-primary shrink-0")}
                      <span className="truncate font-medium text-text">{file.name}</span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLogFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="btn btn-ghost btn-icon btn-xs text-text-muted hover:text-red-600"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn btn-default btn-sm px-4"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="btn btn-primary btn-sm gap-1.5 px-5 font-semibold"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            <span>Simpan Logbook</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export interface WorkOrderDetailProps {
  api?: typeof workspaceApi;
  taskId: string;
  initial?: Task;
  onClose: () => void;
  onChanged?: () => void;
  onNavigate?: (section: string) => void;
  onEdit?: () => void;
  canManage?: boolean;
  canExecute?: boolean;
  canReview?: boolean;
  rpoNumber?: string | null;
  phaseName?: string | null;
  operationalPanel?: React.ReactNode;
  projectFeatures?: boolean;
}

export function WorkOrderDetail({
  api = workspaceApi,
  taskId,
  initial,
  onClose,
  onChanged,
  onNavigate,
  onEdit,
  rpoNumber,
  phaseName,
}: WorkOrderDetailProps) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<"logs" | "docs" | "materials" | "history">("logs");
  const [showAddLog, setShowAddLog] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  // Filters for logbook
  const [authorFilter, setAuthorFilter] = useState("all");
  const [issueOnly, setIssueOnly] = useState(false);
  const [logSearch, setLogSearch] = useState("");

  const load = useCallback(
    async (page = 0) => {
      try {
        const result = await api.workOrderDetail(taskId, page);
        setData(result);
        setError("");
      } catch (err) {
        setError(apiErrorText(err, "WO belum dapat dimuat"));
      }
    },
    [api, taskId]
  );

  useEffect(() => {
    let active = true;
    api
      .workOrderDetail(taskId, offset)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(apiErrorText(err, "WO belum dapat dimuat"));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, offset]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function openSection(section: string) {
    if (onNavigate) onNavigate(section);
    else window.location.assign(`/workspace?project=${data?.project_id}&tab=${section}`);
  }

  async function openFile(file: WorkOrderFile) {
    try {
      const { blob } = file.document_id
        ? await api.downloadProjectDocument(file.document_id)
        : await api.downloadAttachment(file.id);
      const url = URL.createObjectURL(blob);
      if (file.content_type.startsWith("image/")) {
        setPreview({ url, name: file.name });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      setError(apiErrorText(err, "Lampiran belum dapat dibuka"));
    }
  }

  const active = data?.task.status === "in_progress";
  const done = data?.task.status === "done" || data?.task.status === "cancelled";
  const canExecute = !!data?.can_execute && !data.archived;

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (!data?.logs) return [];
    return data.logs.filter((log) => {
      if (authorFilter !== "all" && log.author_name !== authorFilter) return false;
      if (issueOnly && !log.issue_id && !log.issue_status) return false;
      if (logSearch.trim()) {
        const q = logSearch.toLowerCase();
        const matchBody = log.body.toLowerCase().includes(q);
        const matchAuthor = log.author_name.toLowerCase().includes(q);
        if (!matchBody && !matchAuthor) return false;
      }
      return true;
    });
  }, [data?.logs, authorFilter, issueOnly, logSearch]);

  // Group logs by Indonesian date
  const dateGroups = useMemo(() => {
    const map = new Map<
      string,
      { date: string; displayDate: string; logs: WorkLog[]; totalMinutes: number }
    >();

    for (const log of filteredLogs) {
      const key = log.work_date || (log.created_at ? log.created_at.slice(0, 10) : "");
      let group = map.get(key);
      if (!group) {
        group = {
          date: key,
          displayDate: formatIndonesianDate(key),
          logs: [],
          totalMinutes: 0,
        };
        map.set(key, group);
      }
      group.logs.push(log);
      group.totalMinutes += log.minutes || 0;
    }

    const groups = Array.from(map.values());
    groups.sort((a, b) => b.date.localeCompare(a.date));
    return groups;
  }, [filteredLogs]);

  // Unique authors for filter dropdown
  const uniqueAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const log of data?.logs ?? []) {
      if (log.author_name) set.add(log.author_name);
    }
    return Array.from(set).sort();
  }, [data?.logs]);

  // Calendar duration days
  const durationDays = useMemo(() => {
    if (!data?.start_date || !data?.end_date) return null;
    const s = new Date(data.start_date + "T00:00:00");
    const e = new Date(data.end_date + "T00:00:00");
    const diff = e.getTime() - s.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
  }, [data?.start_date, data?.end_date]);

  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-bg text-text overflow-hidden select-text animate-[fadeIn_150ms_ease]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (preview) setPreview(null);
          else if (!editing) onClose();
        }
      }}
    >
      {/* Topbar / Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-bg/95 px-4 py-3 sm:px-6 lg:px-8 backdrop-blur z-20">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon size-9 rounded-xl border border-border/70 hover:bg-bg-hover"
            aria-label="Kembali"
          >
            <ArrowLeft className="size-4.5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xs sm:text-sm font-semibold text-primary">
                {data?.rpo_number ?? rpoNumber ?? "Work Order"}
              </span>
              <span className="text-xs text-text-muted">·</span>
              <span className="text-xs sm:text-sm text-text-muted truncate max-w-[200px]">
                {data?.project_name ?? phaseName ?? "Proyek"}
              </span>
              {data && <StatusBadge status={data.task.status} />}
            </div>
            <h1 className="text-base sm:text-lg font-bold text-text truncate mt-0.5">
              {data ? workOrderLabel(data.task) : initial?.name ?? "Memuat Work Order…"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            aria-label="Muat ulang"
            onClick={() => void load(offset)}
            className="btn btn-ghost btn-icon size-9 rounded-xl border border-border/60 hover:bg-bg-hover"
          >
            <RefreshCw className="size-4" />
          </button>
          {data?.can_edit && !data.archived && !done && (
            <button
              type="button"
              onClick={() => (onEdit ? onEdit() : setEditing(true))}
              className="btn btn-default btn-sm sm:btn-md gap-1.5 px-3 sm:px-4 text-xs sm:text-sm font-medium"
            >
              <Pencil className="size-3.5" />
              <span>Ubah WO</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon size-9 rounded-xl border border-border/60 hover:bg-bg-hover"
            aria-label="Tutup"
          >
            <X className="size-4.5" />
          </button>
        </div>
      </header>

      {/* Tabs Subheader */}
      <nav
        aria-label="Tab Work Order"
        className="flex shrink-0 gap-2 border-b border-border bg-bg-ctrl/30 px-4 sm:px-6 lg:px-8 overflow-x-auto"
      >
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === "logs"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          <Clock className="size-4" />
          <span>Logbook Harian</span>
          {data && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              {data.log_total || data.logs.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("docs")}
          className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === "docs"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          <FileText className="size-4" />
          <span>Dokumen & Hasil Kerja</span>
          {data && data.attachments.length > 0 && (
            <span className="rounded-full bg-bg-ctrl px-2 py-0.5 text-[11px] font-bold text-text">
              {data.attachments.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("materials")}
          className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === "materials"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          <Package className="size-4" />
          <span>Material & Prasyarat</span>
          {data && data.materials.length > 0 && (
            <span className="rounded-full bg-bg-ctrl px-2 py-0.5 text-[11px] font-bold text-text">
              {data.materials.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text"
          }`}
        >
          <History className="size-4" />
          <span>Riwayat Status & Catatan</span>
          {data && data.status_history.length > 0 && (
            <span className="rounded-full bg-bg-ctrl px-2 py-0.5 text-[11px] font-bold text-text">
              {data.status_history.length}
            </span>
          )}
        </button>
      </nav>

      {/* Main Content Area: 2 Columns Widescreen */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT COLUMN: Overview Pane */}
        <aside className="w-full lg:w-[380px] xl:w-[420px] shrink-0 border-r border-border overflow-y-auto bg-bg-ctrl/20 p-5 sm:p-6 space-y-5">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 font-medium"
            >
              {error}
              <button onClick={() => void load(offset)} className="ml-2 underline font-bold">
                Muat ulang
              </button>
            </div>
          )}

          {!data && !error && (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="mt-2 text-xs text-text-muted">Memuat rincian WO…</p>
            </div>
          )}

          {data && (
            <>
              {/* Card 1: Status & Lifecycle Action */}
              <div className="rounded-2xl border border-border bg-bg p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Status Pekerjaan
                  </span>
                  <StatusBadge status={data.task.status} />
                </div>
                <WorkOrderStatus
                  data={data}
                  onChange={async (status, note) => {
                    await api.setWorkOrderStatus(taskId, {
                      status,
                      note,
                      expected_updated_at: data.task.updated_at!,
                    });
                    await load(offset);
                    onChanged?.();
                  }}
                />
              </div>

              {/* Card 2: PIC & Assignees */}
              <div className="rounded-2xl border border-border bg-bg p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Users className="size-3.5 text-primary" />
                  <span>Penanggung Jawab (PIC)</span>
                </div>
                <div className="space-y-2 pt-1">
                  {data.assignees && data.assignees.length > 0 ? (
                    data.assignees.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center gap-3 rounded-xl border border-border-soft bg-bg-ctrl/30 p-2.5"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
                          {person.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs sm:text-sm font-semibold text-text">
                            {person.name}
                          </p>
                          {person.inactive && (
                            <span className="inline-block text-[10px] text-red-600 font-semibold">
                              Sudah tidak bekerja
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-3 text-xs sm:text-sm text-text">
                      <User className="size-4 text-text-muted" />
                      <span>{data.task.assigned_name ?? "PIC belum ditetapkan"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card 3: Target Waktu & Progress */}
              <div className="rounded-2xl border border-border bg-bg p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Calendar className="size-3.5 text-primary" />
                  <span>Jadwal & Waktu Kerja</span>
                </div>
                <div className="space-y-2 pt-1 text-xs sm:text-sm">
                  <div className="flex justify-between py-1 border-b border-border-soft">
                    <span className="text-text-muted">Mulai:</span>
                    <span className="font-semibold text-text">
                      {data.start_date ? formatIndonesianDate(data.start_date) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border-soft">
                    <span className="text-text-muted">Target Selesai:</span>
                    <span className="font-semibold text-text">
                      {data.end_date ? formatIndonesianDate(data.end_date) : "—"}
                    </span>
                  </div>
                  {durationDays !== null && (
                    <div className="flex justify-between py-1 border-b border-border-soft">
                      <span className="text-text-muted">Durasi Kalender:</span>
                      <span className="font-bold text-primary">{durationDays} Hari</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1">
                    <span className="text-text-muted">Jam Kerja Tercatat:</span>
                    <span className="font-bold text-text">
                      {data.logged_minutes > 0
                        ? `${duration(data.logged_minutes)} (${(data.logged_minutes / 60).toFixed(1)} jam)`
                        : "0 jam"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Deskripsi Pekerjaan */}
              <div className="rounded-2xl border border-border bg-bg p-5 shadow-xs space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Deskripsi Pekerjaan
                </h3>
                <p className="whitespace-pre-wrap text-xs sm:text-sm leading-relaxed text-text">
                  {data.task.description || "Belum ada deskripsi pekerjaan."}
                </p>
              </div>

              {/* Card 5: Pintasan Navigasi Proyek */}
              <div className="rounded-2xl border border-border bg-bg p-4 shadow-xs space-y-2">
                <span className="text-xs font-semibold text-text-muted">Buka Modul Proyek:</span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["documents", "Dokumen"],
                    ["materials", "Material"],
                    ["blockers", "Kendala"],
                    ["team", "Tim Proyek"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => openSection(key)}
                      className="btn btn-default btn-xs justify-start text-[11px] font-medium"
                    >
                      <ExternalLink className="size-3 mr-1" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        {/* RIGHT COLUMN: Main Canvas */}
        <main className="flex-1 min-h-0 overflow-y-auto bg-bg p-5 sm:p-7 lg:p-8 space-y-6">
          {/* TAB 1: Logbook Harian Lapangan */}
          {activeTab === "logs" && (
            <div className="space-y-6 max-w-4xl">
              {/* Header Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
                <div>
                  <h2 className="text-lg font-bold text-text">Logbook Harian Lapangan</h2>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Catatan harian personil lapangan, jam pengerjaan, dan dokumentasi foto
                  </p>
                </div>
                {active && canExecute && (
                  <button
                    type="button"
                    onClick={() => setShowAddLog(!showAddLog)}
                    className="btn btn-primary btn-md gap-2 font-semibold shadow-xs shrink-0"
                  >
                    <Plus className="size-4" />
                    <span>{showAddLog ? "Tutup Form Logbook" : "Catat Logbook Baru"}</span>
                  </button>
                )}
              </div>

              {/* Form Tambah Logbook (Spacious & Clean) */}
              {showAddLog && active && canExecute && (
                <WorkOrderLogForm
                  api={api}
                  taskId={taskId}
                  onCancel={() => setShowAddLog(false)}
                  onSaved={async () => {
                    setShowAddLog(false);
                    setOffset(0);
                    await load(0);
                    onChanged?.();
                  }}
                />
              )}

              {/* Filter Bar */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-ctrl/20 p-3">
                <div className="flex items-center gap-2 min-w-[160px]">
                  <Filter className="size-3.5 text-text-muted" />
                  <select
                    value={authorFilter}
                    onChange={(e) => setAuthorFilter(e.target.value)}
                    className="field-input text-xs py-1.5"
                  >
                    <option value="all">Semua Personil ({uniqueAuthors.length})</option>
                    {uniqueAuthors.map((author) => (
                      <option key={author} value={author}>
                        {author}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative flex-1 min-w-[180px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Cari dalam catatan pekerjaan..."
                    className="field-input pl-8 text-xs py-1.5"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIssueOnly(!issueOnly)}
                  className={`btn btn-xs gap-1.5 rounded-lg border font-medium ${
                    issueOnly
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-border bg-bg text-text-muted hover:text-text"
                  }`}
                >
                  <AlertTriangle className="size-3" />
                  <span>Hanya Kendala</span>
                </button>
              </div>

              {/* Date Grouped Logbook Entries */}
              {dateGroups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-bg-ctrl/10 py-12 text-center space-y-3">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Clock className="size-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text">Belum ada catatan logbook</h3>
                    <p className="mt-1 text-xs text-text-muted max-w-sm mx-auto">
                      {done
                        ? "Tidak ada catatan pada WO ini."
                        : active
                        ? "Mulai catat aktivitas pertama dengan klik tombol 'Catat Logbook Baru' di atas."
                        : "Logbook harian dapat diisi setelah status pekerjaan diubah menjadi In Progress."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {dateGroups.map((group) => (
                    <div key={group.date} className="space-y-3">
                      {/* Date Heading */}
                      <div className="flex items-center justify-between border-b border-border pb-2 pt-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="size-4 text-primary" />
                          <h3 className="text-sm font-bold text-text">{group.displayDate}</h3>
                          <span className="text-xs text-text-muted">
                            ({group.logs.length} catatan)
                          </span>
                        </div>
                        {group.totalMinutes > 0 && (
                          <span className="rounded-md bg-bg-ctrl px-2.5 py-1 text-xs font-semibold text-text">
                            Total {duration(group.totalMinutes)}
                          </span>
                        )}
                      </div>

                      {/* Entries for this date */}
                      <div className="grid grid-cols-1 gap-3">
                        {group.logs.map((log) => (
                          <article
                            key={log.id}
                            className={`rounded-2xl border p-4 sm:p-5 transition-all ${
                              Boolean(log.issue_id || log.issue_status)
                                ? "border-amber-500/50 bg-amber-500/5 shadow-2xs"
                                : "border-border bg-bg hover:border-primary/30 shadow-2xs"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-3 mb-3">
                              <div className="flex items-center gap-3">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
                                  {log.author_name.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs sm:text-sm font-bold text-text">
                                      {log.author_name}
                                    </span>
                                    {log.author_inactive && (
                                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.2 text-[10px] font-semibold text-red-600">
                                        Nonaktif
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-text-muted">
                                    Dicatat {dateLabel(log.created_at)}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {log.minutes > 0 && (
                                  <span className="flex items-center gap-1 rounded-lg bg-bg-ctrl/70 px-2.5 py-1 text-xs font-semibold text-text">
                                    <Clock className="size-3 text-primary" />
                                    <span>{duration(log.minutes)}</span>
                                  </span>
                                )}
                                {Boolean(log.issue_id || log.issue_status) && (
                                  <span className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="size-3.5" />
                                    <span>Kendala</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            <p className="whitespace-pre-wrap text-xs sm:text-sm leading-relaxed text-text">
                              {log.body}
                            </p>

                            {/* Attachments / Photos thumbnails */}
                            {log.attachments && log.attachments.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-border-soft">
                                <span className="block text-xs font-semibold text-text-muted mb-2">
                                  Dokumentasi & Lampiran:
                                </span>
                                <div className="flex flex-wrap gap-2.5">
                                  {log.attachments.map((file) => (
                                    <button
                                      key={file.id}
                                      type="button"
                                      onClick={() => void openFile(file)}
                                      className="flex items-center gap-2 rounded-xl border border-border bg-bg-ctrl/30 p-2 text-left text-xs hover:border-primary/50 hover:bg-bg-hover transition-colors"
                                    >
                                      {getFileIcon(file.name, "size-4 text-primary shrink-0")}
                                      <span className="truncate max-w-[180px] font-medium text-text">
                                        {file.name}
                                      </span>
                                      <span className="text-[10px] text-text-muted shrink-0">
                                        {formatFileSize(file.bytes)}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {data && data.log_total > 30 && (
                <div className="flex items-center justify-between gap-3 pt-4 border-t border-border text-xs">
                  <button
                    disabled={!offset}
                    className="btn btn-default btn-sm"
                    onClick={() => setOffset(Math.max(0, offset - 30))}
                  >
                    Lebih Baru
                  </button>
                  <span className="text-text-muted font-medium">
                    {offset + 1}–{Math.min(offset + 30, data.log_total)} dari {data.log_total} catatan
                  </span>
                  <button
                    disabled={offset + 30 >= data.log_total}
                    className="btn btn-default btn-sm"
                    onClick={() => setOffset(offset + 30)}
                  >
                    Lebih Lama
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Dokumen & Hasil Kerja */}
          {activeTab === "docs" && (
            <div className="space-y-5 max-w-4xl">
              <div>
                <h2 className="text-lg font-bold text-text">Dokumen & Hasil Kerja</h2>
                <p className="text-xs sm:text-sm text-text-muted">
                  Kumpulan berkas teknis, gambar acuan, dan berkas hasil pelaksanaan pekerjaan
                </p>
              </div>

              {data && data.attachments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {data.attachments.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => void openFile(file)}
                      className="flex flex-col justify-between rounded-2xl border border-border bg-bg p-4 text-left hover:border-primary/50 hover:shadow-xs transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                          {getFileIcon(file.name, "size-5 text-primary")}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs sm:text-sm text-text line-clamp-2">
                            {file.name}
                          </p>
                          <p className="mt-1 text-[11px] text-text-muted">
                            {file.kind ?? "Lampiran"} · {formatFileSize(file.bytes)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-xs text-primary font-semibold">
                        <span>Buka / Unduh</span>
                        <Eye className="size-3.5" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-bg-ctrl/10 py-12 text-center text-sm text-text-muted">
                  Belum ada dokumen atau lampiran pada WO ini.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Material & Prasyarat */}
          {activeTab === "materials" && (
            <div className="space-y-5 max-w-4xl">
              <div>
                <h2 className="text-lg font-bold text-text">Material Terikat</h2>
                <p className="text-xs sm:text-sm text-text-muted">
                  Daftar material dan komponen yang dialokasikan untuk pelaksanaan WO ini
                </p>
              </div>

              {data && data.materials.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-border bg-bg">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-bg-ctrl/50 text-text-muted border-b border-border">
                      <tr>
                        <th className="p-3 font-semibold">Nama Material</th>
                        <th className="p-3 font-semibold">Spesifikasi</th>
                        <th className="p-3 font-semibold">Jumlah</th>
                        <th className="p-3 font-semibold">Status Kesiapan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-soft">
                      {data.materials.map((item) => (
                        <tr key={item.id} className="hover:bg-bg-hover">
                          <td className="p-3 font-semibold text-text">{item.name}</td>
                          <td className="p-3 text-text-muted">{item.specification || "—"}</td>
                          <td className="p-3 font-mono font-medium">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="p-3">
                            <span className="rounded-md bg-bg-ctrl px-2 py-0.5 text-xs font-semibold text-text">
                              {materialStatuses[item.status] ?? item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-bg-ctrl/10 py-12 text-center text-sm text-text-muted">
                  Belum ada material yang dialokasikan ke WO ini.
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Riwayat Status & Catatan */}
          {activeTab === "history" && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-lg font-bold text-text">Riwayat Status & Catatan</h2>
                <p className="text-xs sm:text-sm text-text-muted">
                  Histori perubahan status dan catatan komunikasi dari pengawas / engineer
                </p>
              </div>

              {data && data.status_history.length > 0 ? (
                <div className="space-y-3">
                  {data.status_history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-border bg-bg p-4 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.from} />
                          <span className="text-text-muted">→</span>
                          <StatusBadge status={item.status} />
                        </div>
                        <span className="text-xs text-text-muted">
                          {dateLabel(item.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">
                        Oleh: <strong className="text-text">{item.author_name ?? "Sistem"}</strong>
                      </p>
                      {item.note && (
                        <p className="text-xs sm:text-sm bg-bg-ctrl/30 p-2.5 rounded-xl border border-border-soft text-text leading-relaxed">
                          {item.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-bg-ctrl/10 py-12 text-center text-sm text-text-muted">
                  Belum ada riwayat perubahan status.
                </div>
              )}

              {data &&
                (data.previous_reports.length > 0 || data.previous_notes.length > 0) && (
                  <div className="space-y-3 pt-4 border-t border-border">
                    <h3 className="text-sm font-bold text-text">Catatan & Laporan Pengawas:</h3>
                    {[...data.previous_notes, ...data.previous_reports].map((note) => (
                      <div
                        key={note.id}
                        className="rounded-2xl border border-border bg-bg p-4 space-y-1.5"
                      >
                        <p className="text-xs text-text-muted">
                          {note.author_name} · {dateLabel(note.created_at)}
                        </p>
                        <p className="whitespace-pre-wrap text-xs sm:text-sm text-text">
                          {note.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}
        </main>
      </div>

      {/* Editing Modal / Full Screen view */}
      {editing && data && (
        <WorkOrderForm
          api={api}
          projectId={data.project_id}
          projectName={data.project_name}
          existing={data}
          fullPage
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load(offset);
            onChanged?.();
          }}
        />
      )}

      {/* Full-Screen Image Lightbox */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dokumentasi pekerjaan"
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/90 p-5 backdrop-blur-xs"
        >
          <button
            type="button"
            aria-label="Tutup dokumentasi"
            onClick={() => setPreview(null)}
            className="absolute right-5 top-5 rounded-xl bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
          >
            <X className="size-6" />
          </button>
          <Image
            unoptimized
            src={preview.url}
            alt={preview.name}
            width={1400}
            height={1000}
            className="max-h-[82dvh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
          />
          <p className="mt-4 text-sm font-semibold text-white/90">{preview.name}</p>
        </div>
      )}
    </div>
  );
}
