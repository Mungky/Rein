"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Filter, Clock, FileText } from "lucide-react";
import type { AppRole } from "@/lib/utils/roles";
import { useCan } from "@/components/providers/permissions-provider";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";

// ── Mock data ──
type ApprovalStatus = "pending" | "approved" | "rejected";

interface MockApproval {
  id: string;
  documentNumber: string;
  documentTitle: string;
  documentType: string;
  requestedBy: string;
  requestedByName: string;
  status: ApprovalStatus;
  createdAt: string;
  comment?: string;
}

const MOCK_APPROVALS: MockApproval[] = [
  {
    id: "a1",
    documentNumber: "DRW-PLB-0041",
    documentTitle: "Gambar Teknik Pile Cap Dermaga Palembang",
    documentType: "DRW",
    requestedBy: "u3",
    requestedByName: "Budi Santoso",
    status: "pending",
    createdAt: "2026-05-08T08:32:00Z",
  },
  {
    id: "a2",
    documentNumber: "INV-MUSI-2024-047",
    documentTitle: "Invoice Jembatan Sungai Musi Periode April",
    documentType: "INV",
    requestedBy: "u5",
    requestedByName: "Rina Wijaya",
    status: "pending",
    createdAt: "2026-05-07T14:10:00Z",
  },
  {
    id: "a3",
    documentNumber: "SPK-CILEGON-021",
    documentTitle: "Surat Perintah Kerja Proyek Krakatau Steel",
    documentType: "SPK",
    requestedBy: "u7",
    requestedByName: "Hendra Kusuma",
    status: "pending",
    createdAt: "2026-05-07T10:45:00Z",
  },
  {
    id: "a4",
    documentNumber: "RPT-PLB-0034",
    documentTitle: "Laporan Inspeksi Struktur Dermaga Phase 2",
    documentType: "RPT",
    requestedBy: "u9",
    requestedByName: "Siti Aisyah",
    status: "approved",
    createdAt: "2026-05-06T09:15:00Z",
    comment: "Disetujui, dokumen lengkap.",
  },
  {
    id: "a5",
    documentNumber: "PO-CILEGON-2024-032",
    documentTitle: "Purchase Order Bahan Baja Krakatau Steel",
    documentType: "PO",
    requestedBy: "u2",
    requestedByName: "Agus Prasetyo",
    status: "approved",
    createdAt: "2026-05-05T16:30:00Z",
    comment: "OK untuk diproses.",
  },
  {
    id: "a6",
    documentNumber: "DRW-MUSI-0019",
    documentTitle: "Gambar Detail Jembatan Sungai Musi",
    documentType: "DRW",
    requestedBy: "u4",
    requestedByName: "Dewi Lestari",
    status: "rejected",
    createdAt: "2026-05-04T11:20:00Z",
    comment: "Perlu revisi, detail penulangan belum sesuai spesifikasi.",
  },
  {
    id: "a7",
    documentNumber: "MEM-OPS-0089",
    documentTitle: "Memo Perubahan Jadwal Proyek Dermaga",
    documentType: "MEM",
    requestedBy: "u6",
    requestedByName: "Fajar Ramadhan",
    status: "rejected",
    createdAt: "2026-05-03T15:00:00Z",
    comment: "Format tidak sesuai template.",
  },
];

const DOC_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  DRW: { label: "Gambar", cls: "badge-blue" },
  INV: { label: "Invoice", cls: "badge-amber" },
  SPK: { label: "SPK", cls: "badge-purple" },
  RPT: { label: "Laporan", cls: "badge-green" },
  PO: { label: "PO", cls: "badge-amber" },
  MEM: { label: "Memo", cls: "badge-muted" },
};

const STATUS_BADGE: Record<ApprovalStatus, { label: string; cls: string }> = {
  pending: { label: "Menunggu", cls: "badge-amber" },
  approved: { label: "Disetujui", cls: "badge-green" },
  rejected: { label: "Ditolak", cls: "badge-red" },
};

const TABS: { key: "all" | ApprovalStatus; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "pending", label: "Menunggu" },
  { key: "approved", label: "Disetujui" },
  { key: "rejected", label: "Ditolak" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


export default function ApprovalsPage() {
  const { role } = useAuth();
  const userRole = role as AppRole;
  const canApprove = useCan(userRole, "dcc:approve");

  if (!canApprove) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
        <div className="w-12 h-12 rounded-xl bg-red-bg flex items-center justify-center">
          <XCircle className="w-6 h-6 text-red" />
        </div>
        <div className="text-[14px] font-semibold text-text">Akses Ditolak</div>
        <div className="text-[12.5px] text-text-muted text-center max-w-[280px]">
          Anda tidak memiliki izin untuk melihat halaman persetujuan dokumen.
        </div>
      </div>
    );
  }

  return <ApprovalsList />;
}

function ApprovalsList() {
  const [items, setItems] = useState<MockApproval[]>(MOCK_APPROVALS);
  const [activeTab, setActiveTab] = useState<"all" | ApprovalStatus>("all");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const filtered =
    activeTab === "all" ? items : items.filter((i) => i.status === activeTab);

  const pendingCount = items.filter((i) => i.status === "pending").length;

  const handleApprove = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: "approved" as ApprovalStatus, comment: "Disetujui" }
          : item
      )
    );
  }, []);

  const handleReject = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "rejected" as ApprovalStatus,
                comment: rejectComment || undefined,
              }
            : item
        )
      );
      setRejectingId(null);
      setRejectComment("");
    },
    [rejectComment]
  );

  const handleStartReject = useCallback((id: string) => {
    setRejectingId(id);
    setRejectComment("");
  }, []);

  const handleCancelReject = useCallback(() => {
    setRejectingId(null);
    setRejectComment("");
  }, []);

  return (
    <PageGuard permission="dcc:approve">
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control panel */}
      <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <span className="text-[15px] font-bold text-text">Persetujuan Dokumen</span>
        {pendingCount > 0 && (
          <span className="badge badge-amber">{pendingCount}</span>
        )}
        <div className="flex-1" />
        <button className="btn btn-default btn-sm gap-1.5">
          <Filter className="w-3 h-3" /> Filter
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-5 h-[38px] min-h-[38px] border-b border-border bg-bg shrink-0">
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
                "flex items-center gap-1.5 px-3 h-[30px] rounded-[var(--r)] text-[12.5px] font-medium whitespace-nowrap border-none cursor-pointer",
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
                    isActive ? "bg-primary-mid text-primary" : "bg-bg-hover text-text-muted"
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
        {/* Desktop: table view */}
        <div className="hidden md:block">
          {/* Table header */}
          <div className="flex items-center px-5 h-[36px] min-h-[36px] border-b border-border-soft bg-bg-ctrl text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-muted">
            <div className="w-[160px] min-w-[160px]">No. Dokumen</div>
            <div className="flex-1 min-w-0 pl-3">Judul</div>
            <div className="w-[80px] min-w-[80px]">Tipe</div>
            <div className="w-[130px] min-w-[130px]">Diminta oleh</div>
            <div className="w-[100px] min-w-[100px]">Tanggal</div>
            <div className="w-[80px] min-w-[80px]">Status</div>
            <div className="w-[130px] min-w-[130px] text-right">Aksi</div>
          </div>

          {/* Table rows */}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <div className="text-[13px]">Tidak ada dokumen yang perlu ditinjau</div>
            </div>
          )}

          {filtered.map((item, idx) => {
            const typeBadge = DOC_TYPE_BADGE[item.documentType] ?? {
              label: item.documentType,
              cls: "badge-muted",
            };
            const statusBadge = STATUS_BADGE[item.status];
            const isRejecting = rejectingId === item.id;

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center px-5 min-h-[44px] border-b border-border-soft",
                  "transition-[background] duration-[var(--tr)] hover:bg-bg-hover",
                  idx % 2 === 1 && "bg-bg-stripe"
                )}
              >
                <div className="w-[160px] min-w-[160px] text-[12.5px] font-mono font-semibold text-text">
                  {item.documentNumber}
                </div>
                <div className="flex-1 min-w-0 pl-3 text-[12.5px] text-text truncate">
                  {item.documentTitle}
                </div>
                <div className="w-[80px] min-w-[80px]">
                  <span className={cn("badge", typeBadge.cls)}>{typeBadge.label}</span>
                </div>
                <div className="w-[130px] min-w-[130px] text-[12px] text-text-muted truncate">
                  {item.requestedByName}
                </div>
                <div className="w-[100px] min-w-[100px] text-[12px] text-text-muted">
                  {formatDate(item.createdAt)}
                </div>
                <div className="w-[80px] min-w-[80px]">
                  <span className={cn("badge", statusBadge.cls)}>{statusBadge.label}</span>
                </div>
                <div className="w-[130px] min-w-[130px] flex justify-end items-center gap-1.5">
                  {item.status === "pending" && !isRejecting && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApprove(item.id)}
                        className="btn btn-sm gap-1 text-[11.5px]"
                        style={{
                          background: "var(--rein-green)",
                          color: "var(--rein-text-inv)",
                        }}
                      >
                        <CheckCircle className="w-3 h-3" />
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartReject(item.id)}
                        className="btn btn-default btn-sm gap-1 text-[11.5px]"
                        style={{
                          color: "var(--rein-red)",
                          borderColor: "var(--rein-red-bg)",
                        }}
                      >
                        <XCircle className="w-3 h-3" />
                        Tolak
                      </button>
                    </>
                  )}
                  {item.status === "pending" && isRejecting && (
                    <div className="flex items-center gap-1.5 w-full">
                      <input
                        type="text"
                        placeholder="Alasan penolakan…"
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        className="flex-1 min-w-0 h-[26px] px-2 text-[11.5px] border border-border rounded-[var(--r)] bg-bg text-text outline-none focus:border-red"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleReject(item.id);
                          if (e.key === "Escape") handleCancelReject();
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleReject(item.id)}
                        className="btn btn-sm gap-1 text-[11px]"
                        style={{
                          background: "var(--rein-red)",
                          color: "var(--rein-text-inv)",
                        }}
                      >
                        Tolak
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelReject}
                        className="btn btn-default btn-sm text-[11px]"
                      >
                        Batal
                      </button>
                    </div>
                  )}
                  {item.status !== "pending" && (
                    <span className="text-[11px] text-text-muted">
                      {item.comment ?? "—"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile: card view */}
        <div className="md:hidden flex flex-col gap-2 p-4">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              <div className="text-[13px]">Tidak ada dokumen yang perlu ditinjau</div>
            </div>
          )}

          {filtered.map((item) => {
            const typeBadge = DOC_TYPE_BADGE[item.documentType] ?? {
              label: item.documentType,
              cls: "badge-muted",
            };
            const statusBadge = STATUS_BADGE[item.status];
            const isRejecting = rejectingId === item.id;

            return (
              <div
                key={item.id}
                className="bg-bg border border-border rounded-lg overflow-hidden"
              >
                {/* Card header */}
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-soft bg-bg-ctrl">
                  <div className="w-[28px] h-[28px] rounded badge-purple flex items-center justify-center shrink-0">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono font-semibold text-text truncate">
                      {item.documentNumber}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {item.requestedByName} · {formatDate(item.createdAt)}
                    </div>
                  </div>
                  <span className={cn("badge", typeBadge.cls)}>{typeBadge.label}</span>
                </div>

                {/* Card body */}
                <div className="px-3.5 py-2.5">
                  <div className="text-[13px] font-medium text-text mb-2">
                    {item.documentTitle}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn("badge", statusBadge.cls)}>{statusBadge.label}</span>
                    {item.comment && (
                      <span className="text-[11px] text-text-muted truncate">
                        — {item.comment}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  {item.status === "pending" && !isRejecting && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApprove(item.id)}
                        className="btn btn-sm flex-1 gap-1 text-[11.5px]"
                        style={{
                          background: "var(--rein-green)",
                          color: "var(--rein-text-inv)",
                        }}
                      >
                        <CheckCircle className="w-3 h-3" />
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartReject(item.id)}
                        className="btn btn-default btn-sm flex-1 gap-1 text-[11.5px]"
                        style={{
                          color: "var(--rein-red)",
                          borderColor: "var(--rein-red-bg)",
                        }}
                      >
                        <XCircle className="w-3 h-3" />
                        Tolak
                      </button>
                    </div>
                  )}
                  {item.status === "pending" && isRejecting && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="Alasan penolakan…"
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        className="w-full h-[28px] px-2 text-[12px] border border-border rounded-[var(--r)] bg-bg text-text outline-none focus:border-red"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleReject(item.id);
                          if (e.key === "Escape") handleCancelReject();
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleReject(item.id)}
                          className="btn btn-sm flex-1 gap-1 text-[11px]"
                          style={{
                            background: "var(--rein-red)",
                            color: "var(--rein-text-inv)",
                          }}
                        >
                          Tolak
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelReject}
                          className="btn btn-default btn-sm flex-1 text-[11px]"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </PageGuard>
  );
}