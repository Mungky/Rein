"use client";

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getAdminTemp } from "@/lib/api/library";
import type { ActivityLogEntry, TempFile } from "./types";

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  uploading: { label: "Mengunggah", color: "text-amber", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  in_audit: { label: "Dalam Audit", color: "text-blue", icon: <Clock className="w-3 h-3" /> },
  failed: { label: "Gagal", color: "text-red", icon: <XCircle className="w-3 h-3" /> },
};

const LAYER_STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3 h-3 text-text-light" />,
  running: <Loader2 className="w-3 h-3 text-blue animate-spin" />,
  passed: <CheckCircle className="w-3 h-3 text-green" />,
  failed: <XCircle className="w-3 h-3 text-red" />,
  skipped: <span className="w-3 h-3 text-text-light text-[9px]">—</span>,
};

const ACTION_LABELS: Record<string, string> = {
  upload: "Upload",
  propose: "Propose",
  confirm: "Konfirmasi",
  cancel: "Batalkan",
  audit_pass: "Audit Lulus",
  audit_fail: "Audit Gagal",
  view_request: "Minta Akses",
  view_approved: "Akses Disetujui",
  view_denied: "Akses Ditolak",
  view_expired: "Akses Kedaluwarsa",
  file_delete: "Hapus File",
  folder_create: "Buat Folder",
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id", { day: "numeric", month: "short", year: "2-digit" });
}

export function TempPanel() {
  const [data, setData] = useState<{ temp_files: TempFile[]; activity_log: ActivityLogEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"temp" | "log">("temp");

  const load = () => {
    setLoading(true);
    getAdminTemp()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-[12.5px] font-semibold text-text">Riwayat &amp; Sementara</span>
        <div className="flex-1" />
        <button
            onClick={load}
            disabled={loading}
            className="btn btn-ghost btn-icon btn-sm text-text-muted"
            title="Segarkan"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border px-4 shrink-0">
        {(["temp", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[12px] px-3 py-2 border-b-2 transition-colors duration-100 ${
              tab === t
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {t === "temp"
              ? `File Sementara${data ? ` (${data.temp_files.length})` : ""}`
              : `Log Aktivitas${data ? ` (${data.activity_log.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-text-light" />
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <AlertTriangle className="w-5 h-5 text-amber" />
            <p className="text-[12px] text-text-muted">Gagal memuat data</p>
          </div>
        ) : tab === "temp" ? (
          <TempFileList files={data.temp_files} />
        ) : (
          <ActivityLog entries={data.activity_log} />
        )}
      </div>
    </div>
  );
}

function TempFileList({ files }: { files: TempFile[] }) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <CheckCircle className="w-7 h-7 text-green opacity-40" />
        <p className="text-[12px] text-text-muted">Tidak ada file yang tertunda</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {files.map((f) => {
        const s = STATUS_LABELS[f.upload_status] ?? { label: f.upload_status, color: "text-text-muted", icon: null };
        return (
          <div key={f.id} className="px-4 py-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded bg-bg-ctrl border border-border flex items-center justify-center shrink-0 mt-0.5">
                <FileText className="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold font-mono truncate">{f.file_name}</span>
                  <span className={`flex items-center gap-1 text-[10px] font-semibold shrink-0 ${s.color}`}>
                    {s.icon}
                    {s.label}
                  </span>
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">{relTime(f.created_at)}</div>

                {/* Audit layers */}
                {f.audit_layers.length > 0 && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {f.audit_layers.map((l) => (
                      <span
                        key={l.layer}
                        className="flex items-center gap-1 text-[10px] text-text-muted bg-bg-ctrl border border-border rounded px-1.5 py-0.5"
                        title={l.result ? JSON.stringify(l.result) : l.status}
                      >
                        {LAYER_STATUS_ICON[l.status] ?? null}
                        {l.layer_name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Failure reason from layer 1 */}
                {f.upload_status === "failed" && f.audit_layers.find(l => l.status === "failed")?.result && (
                  <p className="text-[10.5px] text-red mt-1">
                    {String((f.audit_layers.find(l => l.status === "failed")!.result as Record<string, unknown>)?.reason ?? "")}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityLog({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex justify-center items-center h-40">
        <p className="text-[12px] text-text-muted">Belum ada aktivitas</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {entries.map((e) => (
        <div key={e.id} className="flex items-start gap-2.5 px-4 py-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[12px] font-semibold text-text">
                {ACTION_LABELS[e.action] ?? e.action}
              </span>
              {e.meta?.filename != null && (
                <span className="text-[11px] text-text-muted font-mono truncate">
                  {String(e.meta.filename)}
                </span>
              )}
            </div>
            <div className="text-[10.5px] text-text-light mt-px">{relTime(e.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
