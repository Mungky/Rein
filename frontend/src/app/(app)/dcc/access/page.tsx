"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  ShieldX,
  Clock,
  Copy,
  Link2,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import type { AppRole } from "@/lib/utils/roles";
import { useCan } from "@/components/providers/permissions-provider";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { accessApi, type AccessRequest } from "@/lib/api/access";

type AccessStatus = "pending" | "approved" | "denied" | "expired";

const STATUS_BADGE: Record<AccessStatus, { label: string; cls: string }> = {
  pending: { label: "Menunggu", cls: "badge-amber" },
  approved: { label: "Disetujui", cls: "badge-green" },
  denied: { label: "Ditolak", cls: "badge-red" },
  expired: { label: "Kedaluwarsa", cls: "badge-muted" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, diff);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(0);
        clearInterval(interval);
      } else {
        setRemaining(diff);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remaining <= 0) {
    return <span className="text-[11px] text-red font-semibold">Kedaluwarsa</span>;
  }

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  return (
    <span className="text-[11px] font-mono font-semibold text-amber">
      {mins}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

export default function AccessPage() {
  const { role } = useAuth();
  const userRole = role as AppRole;
  const isAdmin = useCan(userRole, "dcc:manage_access");

  const [items, setItems] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | AccessStatus>("all");

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await accessApi.getPending();
      setItems(data);
    } catch {
      // Use empty list on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const filtered =
    activeTab === "all" ? items : items.filter((i) => i.status === activeTab);

  const handleApprove = useCallback(async (id: string) => {
    try {
      const result = await accessApi.approveAccess(id);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "approved" as AccessStatus,
                token: result.token || "",
                expiresAt: result.expiresAt || "",
              }
            : item
        )
      );
    } catch {
      // Could show error toast
    }
  }, []);

  const handleDeny = useCallback(async (id: string) => {
    try {
      await accessApi.denyAccess(id);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "denied" as AccessStatus } : item
        )
      );
    } catch {
      // Could show error toast
    }
  }, []);

  const handleCopyLink = useCallback((token: string, id: string) => {
    const link = `${window.location.origin}/access/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const TABS: { key: "all" | AccessStatus; label: string }[] = [
    { key: "all", label: "Semua" },
    { key: "pending", label: "Menunggu" },
    { key: "approved", label: "Disetujui" },
    { key: "denied", label: "Ditolak" },
    { key: "expired", label: "Kedaluwarsa" },
  ];

  return (
    <PageGuard permission="dcc:view">
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control panel */}
      <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <span className="text-[15px] font-bold text-text">Akses Dokumen</span>
        <span className="text-[10.5px] text-text-muted ml-0.5">
          Permintaan akses sementara
        </span>
        <div className="flex-1" />
        <button onClick={fetchRequests} className="btn btn-default btn-sm gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-5 h-[38px] min-h-[38px] border-b border-border bg-bg shrink-0 overflow-x-auto">
        {TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? items.length
              : items.filter((i) => i.status === tab.key).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-[30px] rounded-[var(--r)] text-[12.5px] font-medium whitespace-nowrap border-none cursor-pointer shrink-0",
                "transition-[background,color] duration-[var(--tr)]",
                isActive
                  ? "badge-purple font-semibold"
                  : "text-text-muted hover:bg-bg-hover hover:text-text"
              )}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-[5px] py-[1px] rounded-full",
                    isActive
                      ? "bg-primary-mid text-primary"
                      : "bg-bg-hover text-text-muted"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-text-muted">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="text-[13px]">Memuat data…</span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <ShieldCheck className="w-8 h-8 mb-2 opacity-40" />
            <div className="text-[13px]">Tidak ada permintaan akses</div>
          </div>
        )}

        {/* Desktop: table view */}
        {!loading && filtered.length > 0 && (
          <div className="hidden md:block">
            <div className="flex items-center px-5 h-[36px] min-h-[36px] border-b border-border-soft bg-bg-ctrl text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-muted">
              <div className="w-[140px] min-w-[140px]">No. Dokumen</div>
              <div className="flex-1 min-w-0 pl-3">Judul</div>
              <div className="w-[120px] min-w-[120px]">Pemohon</div>
              <div className="w-[90px] min-w-[90px]">Status</div>
              <div className="w-[100px] min-w-[100px]">Waktu</div>
              <div className="w-[180px] min-w-[180px] text-right">Aksi</div>
            </div>

            {filtered.map((item, idx) => {
              const st = (item.status || "pending") as AccessStatus;
              const statusBadge = STATUS_BADGE[st] || STATUS_BADGE.pending;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center px-5 min-h-[48px] border-b border-border-soft",
                    "transition-[background] duration-[var(--tr)] hover:bg-bg-hover",
                    idx % 2 === 1 && "bg-bg-stripe"
                  )}
                >
                  <div className="w-[140px] min-w-[140px] text-[12.5px] font-mono font-semibold text-text">
                    {item.documentNumber || item.documentId}
                  </div>
                  <div className="flex-1 min-w-0 pl-3 text-[12.5px] text-text truncate">
                    {item.documentTitle || item.documentName}
                  </div>
                  <div className="w-[120px] min-w-[120px] text-[12px] text-text-muted truncate">
                    {item.requestedByName}
                  </div>
                  <div className="w-[90px] min-w-[90px]">
                    <span className={cn("badge", statusBadge.cls)}>{statusBadge.label}</span>
                  </div>
                  <div className="w-[100px] min-w-[100px] text-[11.5px] text-text-muted">
                    {item.createdAt ? formatTime(item.createdAt) : "—"}
                  </div>
                  <div className="w-[180px] min-w-[180px] flex justify-end items-center gap-1.5">
                    {st === "pending" && isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApprove(item.id)}
                          className="btn btn-sm gap-1 text-[11.5px]"
                          style={{ background: "var(--rein-green)", color: "var(--rein-text-inv)" }}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Setujui
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeny(item.id)}
                          className="btn btn-default btn-sm gap-1 text-[11.5px]"
                          style={{ color: "var(--rein-red)", borderColor: "var(--rein-red-bg)" }}
                        >
                          <XCircle className="w-3 h-3" />
                          Tolak
                        </button>
                      </>
                    )}
                    {st === "approved" && item.token && (
                      <>
                        {item.expiresAt && new Date(item.expiresAt).getTime() > Date.now() && (
                          <CountdownTimer expiresAt={item.expiresAt} />
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopyLink(item.token!, item.id)}
                          className="btn btn-default btn-sm gap-1 text-[11px]"
                          title="Salin link akses"
                        >
                          {copiedId === item.id ? (
                            <>
                              <CheckCircle className="w-3 h-3" style={{ color: "var(--rein-green)" }} />
                              Disalin
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Salin Link
                            </>
                          )}
                        </button>
                      </>
                    )}
                    {st === "denied" && (
                      <span className="text-[11px] text-red">Akses ditolak</span>
                    )}
                    {st === "expired" && (
                      <span className="text-[11px] text-text-muted">Link kedaluwarsa</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Mobile: card view */}
        {!loading && filtered.length > 0 && (
          <div className="md:hidden flex flex-col gap-2 p-4">
            {filtered.map((item) => {
              const st = (item.status || "pending") as AccessStatus;
              const statusBadge = STATUS_BADGE[st] || STATUS_BADGE.pending;

              return (
                <div key={item.id} className="bg-bg border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-soft bg-bg-ctrl">
                    <div
                      className={cn(
                        "w-[28px] h-[28px] rounded flex items-center justify-center shrink-0",
                        st === "approved" ? "bg-green-bg text-green"
                          : st === "denied" ? "bg-red-bg text-red"
                          : st === "expired" ? "bg-bg-hover text-text-muted"
                          : "bg-amber-bg text-amber"
                      )}
                    >
                      {st === "approved" ? <ShieldCheck className="w-3.5 h-3.5" />
                        : st === "denied" ? <ShieldX className="w-3.5 h-3.5" />
                        : st === "expired" ? <Clock className="w-3.5 h-3.5" />
                        : <Link2 className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-mono font-semibold text-text truncate">
                        {item.documentNumber || item.documentId}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {item.requestedByName} · {item.createdAt ? `${formatDate(item.createdAt)} ${formatTime(item.createdAt)}` : "—"}
                      </div>
                    </div>
                    <span className={cn("badge", statusBadge.cls)}>{statusBadge.label}</span>
                  </div>

                  <div className="px-3.5 py-2.5">
                    <div className="text-[13px] font-medium text-text mb-1">
                      {item.documentTitle || item.documentName}
                    </div>
                    {item.reason && (
                      <div className="text-[11.5px] text-text-muted mb-2">
                        Alasan: {item.reason}
                      </div>
                    )}

                    {st === "approved" && item.token && (
                      <div className="flex items-center gap-2 mb-2">
                        {item.expiresAt && new Date(item.expiresAt).getTime() > Date.now() && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber" />
                            <CountdownTimer expiresAt={item.expiresAt} />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopyLink(item.token!, item.id)}
                          className="btn btn-default btn-sm gap-1 text-[11px]"
                        >
                          {copiedId === item.id ? (
                            <>
                              <CheckCircle className="w-3 h-3" style={{ color: "var(--rein-green)" }} />
                              Disalin
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Salin Link
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {st === "pending" && isAdmin && (
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(item.id)}
                          className="btn btn-sm flex-1 gap-1 text-[11.5px]"
                          style={{ background: "var(--rein-green)", color: "var(--rein-text-inv)" }}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Setujui
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeny(item.id)}
                          className="btn btn-default btn-sm flex-1 gap-1 text-[11.5px]"
                          style={{ color: "var(--rein-red)", borderColor: "var(--rein-red-bg)" }}
                        >
                          <XCircle className="w-3 h-3" />
                          Tolak
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </PageGuard>
  );
}