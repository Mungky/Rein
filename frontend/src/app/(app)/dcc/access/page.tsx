"use client";

import {
  AlertCircle,
  Check,
  CheckCircle,
  Clock,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageGuard } from "@/components/guards/page-guard";
import {
  decideViewRequest,
  getViewRequestInbox,
  type ViewRequestInboxItem,
} from "@/lib/api/library";

const PUSTAKAWAN_ROLES = new Set(["admin", "director", "manager"]);

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id", { day: "numeric", month: "short", year: "2-digit" });
}

function remainingTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "Kedaluwarsa";
  if (diff < 60) return `${diff}d lagi`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lagi`;
  return `${Math.floor(diff / 3600)} jam lagi`;
}

export default function PustakawanInbox() {
  return (
    <PageGuard permission="dcc:view">
      <PustakawanInner />
    </PageGuard>
  );
}

function PustakawanInner() {
  const { profile } = useAuth();
  const isPustakawan = profile && PUSTAKAWAN_ROLES.has(profile.role);
  const [pending, setPending] = useState<ViewRequestInboxItem[]>([]);
  const [recent, setRecent] = useState<ViewRequestInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getViewRequestInbox()
      .then((r) => {
        setPending(r.pending);
        setRecent(r.recent);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat inbox"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (isPustakawan) load(); }, [isPustakawan, load]);

  // Auto-refresh every 20 s
  useEffect(() => {
    if (!isPustakawan) return;
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [isPustakawan, load]);

  const handleDecide = async (id: string, action: "approve" | "deny") => {
    setProcessingId(id);
    try {
      await decideViewRequest(id, action);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal memproses permintaan");
    } finally {
      setProcessingId(null);
    }
  };

  if (!isPustakawan) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <ShieldCheck className="w-10 h-10 text-text-light opacity-40" />
        <div>
          <p className="text-[14px] font-semibold text-text">Khusus Pustakawan</p>
          <p className="text-[12px] text-text-muted mt-1">
            Halaman ini hanya untuk role Admin, Direktur, dan Manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 md:px-6 h-[52px] min-h-[52px] border-b border-border bg-bg shrink-0">
        <Inbox className="w-4 h-4 text-primary" />
        <h1 className="text-[14px] font-bold text-text flex-1">Inbox Pustakawan</h1>
        <span className="text-[11px] text-text-muted tabular-nums">
          {pending.length} menunggu
        </span>
        <button onClick={load} disabled={loading} className="btn btn-ghost btn-icon btn-sm text-text-muted" title="Segarkan">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {error && (
          <div className="px-3 py-2 rounded bg-red-bg text-red text-[12.5px] border border-red/20 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
          </div>
        )}

        {/* Pending */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-light mb-2">
            Permintaan Menunggu
          </h2>
          {pending.length === 0 ? (
            <div className="rounded-lg border border-border-soft bg-bg-ctrl px-4 py-6 text-center">
              <CheckCircle className="w-6 h-6 text-green opacity-50 mx-auto mb-2" />
              <p className="text-[12px] text-text-muted">Tidak ada permintaan menunggu</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border-soft">
              {pending.map((req) => (
                <PendingRow
                  key={req.id}
                  req={req}
                  processing={processingId === req.id}
                  onApprove={() => handleDecide(req.id, "approve")}
                  onDeny={() => handleDecide(req.id, "deny")}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-light mb-2">
            Riwayat (50 terakhir)
          </h2>
          {recent.length === 0 ? (
            <p className="text-[12px] text-text-muted">Belum ada riwayat</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border-soft">
              {recent.map((req) => (
                <RecentRow key={req.id} req={req} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PendingRow({
  req, processing, onApprove, onDeny,
}: {
  req: ViewRequestInboxItem;
  processing: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-md bg-amber-bg flex items-center justify-center shrink-0">
        <Clock className="w-3.5 h-3.5 text-amber" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          {req.doc_type && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0">
              {req.doc_type}
            </span>
          )}
          <span className="text-[12.5px] font-mono truncate text-text">{req.file_name}</span>
        </div>
        <div className="text-[11px] text-text-muted">
          {req.requester_name}
          <span className="ml-1 opacity-60">· {req.requester_role}</span>
          <span className="ml-1 opacity-60">· {relTime(req.created_at)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10.5px] text-amber tabular-nums">{remainingTime(req.expires_at)}</span>
        <div className="flex gap-1">
          <button
            onClick={onDeny}
            disabled={processing}
            className="btn btn-default btn-sm gap-1 text-[11px] text-red border-red/30 hover:bg-red-bg"
          >
            <XCircle className="w-3 h-3" /> Tolak
          </button>
          <button
            onClick={onApprove}
            disabled={processing}
            className="btn btn-primary btn-sm gap-1 text-[11px]"
          >
            {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Setujui
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentRow({ req }: { req: ViewRequestInboxItem }) {
  const meta = {
    approved: { label: "Disetujui", color: "text-green bg-green-bg", icon: <CheckCircle className="w-3.5 h-3.5" /> },
    denied: { label: "Ditolak", color: "text-red bg-red-bg", icon: <XCircle className="w-3.5 h-3.5" /> },
    expired: { label: "Kedaluwarsa", color: "text-text-muted bg-bg-hover", icon: <Clock className="w-3.5 h-3.5" /> },
    pending: { label: "Menunggu", color: "text-amber bg-amber-bg", icon: <Clock className="w-3.5 h-3.5" /> },
  }[req.status];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${meta.color}`}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-text-muted shrink-0">
            {meta.label}
          </span>
          <span className="text-[12px] font-mono truncate text-text">{req.file_name}</span>
        </div>
        <div className="text-[10.5px] text-text-muted">
          {req.requester_name} · {req.requester_role}
        </div>
      </div>
      <span className="text-[10.5px] text-text-muted tabular-nums shrink-0">
        {relTime(req.approved_at ?? req.created_at)}
      </span>
    </div>
  );
}
