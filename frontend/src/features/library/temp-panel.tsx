"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Download,
  Eye,
  FileText,
  FolderPlus,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getAdminActivity,
  getEmailConfig,
  purgeTempFile,
  resetStuckUploads,
  sendTestEmail,
  type ActivityEntry,
  type EmailConfig,
} from "@/lib/api/library";

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  upload: { label: "Upload", icon: <Upload className="w-3.5 h-3.5" />, color: "text-primary bg-primary-bg" },
  propose: { label: "Propose", icon: <FileText className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  view_request: { label: "Minta Akses", icon: <Eye className="w-3.5 h-3.5" />, color: "text-amber bg-amber-bg" },
  view_approved: { label: "Akses Disetujui", icon: <Download className="w-3.5 h-3.5" />, color: "text-green bg-green-bg" },
  view_denied: { label: "Akses Ditolak", icon: <CircleSlash className="w-3.5 h-3.5" />, color: "text-red bg-red-bg" },
  view_expired: { label: "Akses Kedaluwarsa", icon: <CircleSlash className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  audit_pass: { label: "Audit Lulus", icon: <Check className="w-3.5 h-3.5" />, color: "text-green bg-green-bg" },
  audit_fail: { label: "Audit Gagal", icon: <XCircle className="w-3.5 h-3.5" />, color: "text-red bg-red-bg" },
  file_delete: { label: "Hapus File", icon: <Trash2 className="w-3.5 h-3.5" />, color: "text-red bg-red-bg" },
  rename_file: { label: "Rename File", icon: <FileText className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  rename_folder: { label: "Rename Folder", icon: <FileText className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  move_file: { label: "Pindah File", icon: <FolderPlus className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  folder_create: { label: "Buat Folder", icon: <FolderPlus className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
  delete_folder: { label: "Hapus Folder", icon: <Trash2 className="w-3.5 h-3.5" />, color: "text-red bg-red-bg" },
  reset_stuck: { label: "Reset Stuck", icon: <Settings2 className="w-3.5 h-3.5" />, color: "text-amber bg-amber-bg" },
  purge_temp_file: { label: "Bersihkan Record", icon: <Trash2 className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" },
};

const FILTER_ACTIONS = [
  { value: "", label: "Semua aksi" },
  { value: "upload", label: "Upload" },
  { value: "view_request", label: "Permintaan akses" },
  { value: "view_approved", label: "Akses disetujui" },
  { value: "file_delete", label: "Hapus file" },
  { value: "rename_file", label: "Rename file" },
  { value: "move_file", label: "Pindah file" },
  { value: "folder_create", label: "Buat folder" },
  { value: "delete_folder", label: "Hapus folder" },
];

const PAGE_SIZE = 50;

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Status dot: ●=passed ●=running ○=pending ✕=failed. */
function StatusDot({ status }: { status: "pending" | "running" | "passed" | "failed" | "skipped" }) {
  const cls = {
    pending: "bg-bg-hover border-text-light",
    running: "bg-blue border-blue",
    passed: "bg-green border-green",
    failed: "bg-red border-red",
    skipped: "bg-bg-hover border-text-light opacity-50",
  }[status];
  return <span className={`w-2 h-2 rounded-full border ${cls}`} title={status} />;
}

export function TempPanel() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [stuckCount, setStuckCount] = useState(0);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [showEmailPanel, setShowEmailPanel] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAdminActivity({ search, action: actionFilter || undefined, page, pageSize: PAGE_SIZE })
      .then((r) => {
        setEntries(r.entries);
        setTotal(r.total);
        setStuckCount(r.stuck_count);
        setEmailConfigured(r.email_configured);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [search, actionFilter, page]);

  useEffect(() => { load(); }, [load]);

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchDraft]);

  const handleResetStuck = async () => {
    setResetting(true);
    try {
      await resetStuckUploads();
      load();
    } finally {
      setResetting(false);
    }
  };

  const handlePurge = async (id: string) => {
    if (!confirm("Hapus record ini secara permanen?")) return;
    try {
      await purgeTempFile(id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal menghapus record");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-[12.5px] font-semibold text-text">Aktivitas Perpustakaan</span>
        <span className="text-[11px] text-text-muted tabular-nums">
          {total.toLocaleString("id")} entri
        </span>
        <div className="flex-1 min-w-[120px]" />

        {stuckCount > 0 && (
          <button
            onClick={handleResetStuck}
            disabled={resetting}
            className="btn btn-default btn-sm gap-1.5 text-amber border-amber/40"
            title={`Reset ${stuckCount} file stuck ke status Gagal`}
          >
            {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            {stuckCount} stuck
          </button>
        )}

        <button
          onClick={() => setShowEmailPanel(true)}
          className={`btn btn-default btn-sm gap-1.5 ${!emailConfigured ? "text-red border-red/40" : ""}`}
          title="Pengaturan email Pustakawan"
        >
          <Mail className="w-3 h-3" />
          Email
        </button>

        <button onClick={load} disabled={loading} className="btn btn-ghost btn-icon btn-sm text-text-muted" title="Segarkan">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Banner: email not configured */}
      {!emailConfigured && (
        <div className="px-4 py-2 bg-red-bg border-b border-red/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red shrink-0" />
          <span className="text-[11.5px] text-red flex-1">
            SMTP atau LIBRARIAN_EMAILS belum diset — permintaan akses tidak akan terkirim via email.
          </span>
          <button onClick={() => setShowEmailPanel(true)} className="text-[11px] underline text-red shrink-0">
            Atur
          </button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-light pointer-events-none" />
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Cari nama file atau pengguna…"
            className="field-input pl-8 pr-7 text-[12.5px] w-full"
          />
          {searchDraft && (
            <button onClick={() => setSearchDraft("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-light hover:text-text">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="field-select text-[12px] w-[160px]"
        >
          {FILTER_ACTIONS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-text-light" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
            <FileText className="w-7 h-7 text-text-light opacity-40" />
            <p className="text-[12px]">Tidak ada aktivitas yang cocok</p>
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {entries.map((e) => (
              <ActivityRow key={e.id} entry={e} onPurge={() => handlePurge(e.target_id!)} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn btn-default btn-sm btn-icon"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          <span className="text-[11px] text-text-muted">
            Halaman {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn btn-default btn-sm btn-icon"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {showEmailPanel && <EmailConfigPanel onClose={() => setShowEmailPanel(false)} />}
    </div>
  );
}

function ActivityRow({ entry, onPurge }: { entry: ActivityEntry; onPurge: () => void }) {
  const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: <FileText className="w-3.5 h-3.5" />, color: "text-text-muted bg-bg-hover" };
  const isInProgress =
    entry.action === "upload" &&
    (entry.file_status === "uploading" || entry.file_status === "in_audit" || entry.file_status === "failed");

  // Build status dots: Propose / Process (upload) / Audit
  const dots: Array<{ key: string; status: "pending" | "running" | "passed" | "failed" }> = [];
  if (isInProgress) {
    // Propose always done at this point
    dots.push({ key: "propose", status: "passed" });
    // Process = upload to Drive
    if (entry.file_status === "uploading") dots.push({ key: "process", status: "running" });
    else if (entry.file_status === "failed") dots.push({ key: "process", status: "failed" });
    else dots.push({ key: "process", status: "passed" });
    // Audit
    if (entry.file_status === "in_audit") dots.push({ key: "audit", status: "running" });
    else if (entry.file_status === "failed") dots.push({ key: "audit", status: "failed" });
    else if (entry.file_status === "passed") dots.push({ key: "audit", status: "passed" });
    else dots.push({ key: "audit", status: "pending" });
  }

  const canPurge = isInProgress || entry.file_status === "failed";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover group">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${meta.color}`}>
        {meta.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted shrink-0">
            {meta.label}
          </span>
          {entry.file_name && (
            <span className="text-[12px] font-mono truncate text-text">{entry.file_name}</span>
          )}
        </div>
        <div className="text-[10.5px] text-text-muted">
          {entry.actor_name ?? "—"}
          {entry.actor_role && <span className="ml-1 opacity-60">· {entry.actor_role}</span>}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10.5px] text-text-muted tabular-nums">{relTime(entry.created_at)}</span>
        {dots.length > 0 && (
          <div className="flex items-center gap-1.5">
            {dots.map((d) => <StatusDot key={d.key} status={d.status} />)}
          </div>
        )}
      </div>

      {canPurge && (
        <button
          onClick={onPurge}
          className="opacity-0 group-hover:opacity-100 transition-opacity btn btn-ghost btn-icon btn-sm text-red"
          title="Bersihkan record ini"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function EmailConfigPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; recipients: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEmailConfig()
      .then(setConfig)
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat konfigurasi"))
      .finally(() => setLoading(false));
  }, []);

  const handleTest = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const r = await sendTestEmail();
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim email tes");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4 text-primary" />
          <h3 className="text-[14px] font-bold flex-1">Konfigurasi Email Pustakawan</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <p className="text-[12px] text-text-muted">Memuat…</p>
        ) : config ? (
          <div className="space-y-3 text-[12px]">
            <ConfigRow label="SMTP terkonfigurasi" ok={config.smtp_configured} />
            <ConfigRow label="LIBRARIAN_EMAILS diset" ok={config.librarian_emails_configured} />
            <div>
              <div className="text-text-muted mb-1">Host</div>
              <div className="font-mono text-[11.5px]">{config.smtp_host}:{config.smtp_port}</div>
            </div>
            <div>
              <div className="text-text-muted mb-1">Penerima ({config.recipient_count})</div>
              <div className="font-mono text-[11.5px] space-y-0.5">
                {config.recipients_redacted.length === 0
                  ? <span className="text-red">Tidak ada penerima</span>
                  : config.recipients_redacted.map((e) => <div key={e}>{e}</div>)}
              </div>
            </div>

            {error && (
              <div className="px-3 py-2 rounded bg-red-bg text-red text-[11.5px] border border-red/20">
                {error}
              </div>
            )}
            {result && (
              <div className={`px-3 py-2 rounded text-[11.5px] border ${result.errors.length === 0 ? "bg-green-bg text-green border-green/20" : "bg-amber-bg text-amber border-amber/20"}`}>
                <div className="font-semibold">Terkirim: {result.sent}/{result.recipients}</div>
                {result.errors.length > 0 && (
                  <ul className="mt-1 ml-3 list-disc">
                    {result.errors.map((err) => <li key={err}>{err}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={onClose} className="btn btn-default flex-1">Tutup</button>
              <button
                onClick={handleTest}
                disabled={sending || !config.smtp_configured || config.recipient_count === 0}
                className="btn btn-primary flex-1 gap-1.5"
              >
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                Kirim Tes
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConfigRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <Check className="w-3.5 h-3.5 text-green" /> : <XCircle className="w-3.5 h-3.5 text-red" />}
      <span className={ok ? "text-text" : "text-red"}>{label}</span>
    </div>
  );
}
