"use client";

import { useEffect, useState } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import { workspaceApi, type WorkspaceSummary } from "@/lib/api/workspace";
import type { AppRole } from "@/lib/utils/roles";
import {
  LayoutGrid, CheckCircle2, AlertTriangle, Clock, TrendingUp,
  FolderKanban, ClipboardList, Loader2,
} from "lucide-react";

// ── Status helpers ──
const STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan", active: "Aktif", on_hold: "Ditunda", completed: "Selesai",
};
const STATUS_COLOR: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-gray-100 text-gray-600",
};
const TASK_STATUS_COLOR: Record<string, string> = {
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};
const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "Belum", in_progress: "Dikerjakan", done: "Selesai", overdue: "Terlambat",
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-bg-hover rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function KPICard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <div className="bg-bg border border-border rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      <div className="text-[28px] font-extrabold tracking-tight text-text leading-none">{value}</div>
      {sub && <div className="text-[11.5px] text-text-muted">{sub}</div>}
    </div>
  );
}

function ManagerDashboard({ summary }: { summary: WorkspaceSummary }) {
  const m = summary.managed;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard label="Proyek Aktif" value={m.active_projects}
          sub={`dari ${m.total_projects} total`} icon={FolderKanban} color="bg-primary-bg text-primary" />
        <KPICard label="Task Terlambat" value={m.overdue_tasks}
          sub="perlu perhatian segera" icon={AlertTriangle} color="bg-red-50 text-red-600" />
        <KPICard label="Total Proyek" value={m.total_projects}
          sub="semua status" icon={ClipboardList} color="bg-bg-hover text-text-muted" />
      </div>

      <div className="bg-bg border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-[12.5px] font-bold">Proyek Saya</span>
          <span className="text-[10px] font-bold px-2 py-[1.5px] rounded-full bg-bg-hover text-text-muted ml-1">
            {m.total_projects}
          </span>
        </div>
        <div className="divide-y divide-border">
          {m.projects.length === 0 && (
            <div className="px-4 py-8 text-center text-text-muted text-[12.5px]">Belum ada proyek</div>
          )}
          {m.projects.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12.5px] font-semibold text-text truncate">{p.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-[1.5px] rounded-full shrink-0 ${STATUS_COLOR[p.status] ?? "bg-bg-hover text-text-muted"}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
                {p.client_name && <div className="text-[11px] text-text-muted mb-1.5">{p.client_name}</div>}
                <div className="flex items-center gap-2">
                  <ProgressBar value={p.progress} />
                  <span className="text-[10.5px] text-text-muted shrink-0">{p.progress}%</span>
                </div>
              </div>
              {p.deadline && (
                <div className="text-[10.5px] text-text-muted shrink-0">
                  {new Date(p.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EngineerDashboard({ summary }: { summary: WorkspaceSummary }) {
  const p = summary.personal;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <KPICard label="Hari Ini" value={p.today_count}
          sub="task harus dikerjakan" icon={Clock} color="bg-primary-bg text-primary" />
        <KPICard label="Selesai Bulan Ini" value={p.done_this_month}
          sub="task yang sudah selesai" icon={CheckCircle2} color="bg-green-50 text-green-600" />
      </div>

      <div className="bg-bg border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-[12.5px] font-bold">Task Hari Ini</span>
          <span className="text-[10px] font-bold px-2 py-[1.5px] rounded-full bg-primary-bg text-primary ml-1">
            {p.today_count}
          </span>
        </div>
        <div className="divide-y divide-border">
          {p.today_tasks.length === 0 && (
            <div className="px-4 py-6 text-center text-text-muted text-[12.5px]">
              Tidak ada task untuk hari ini 🎉
            </div>
          )}
          {p.today_tasks.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-text">{t.name}</div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-[2px] rounded-full shrink-0 ${TASK_STATUS_COLOR[t.status] ?? ""}`}>
                {TASK_STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {p.overdue_count > 0 && (
        <div className="bg-bg border border-red-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-200 bg-red-50">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[12.5px] font-bold text-red-700">Task Terlambat ({p.overdue_count})</span>
          </div>
          <div className="divide-y divide-border">
            {p.overdue_tasks.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="text-[12.5px] font-semibold text-text">{t.name}</div>
                {t.deadline && (
                  <div className="text-[11px] text-red-500 mt-0.5">
                    Deadline: {new Date(t.deadline).toLocaleDateString("id-ID")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GenericDashboard() {
  return (
    <div className="bg-bg border border-border rounded-lg p-8 text-center flex flex-col items-center gap-3">
      <TrendingUp className="w-10 h-10 text-text-muted opacity-40" />
      <div className="text-[13px] font-semibold text-text">Dashboard</div>
      <div className="text-[12px] text-text-muted max-w-xs">
        Kunjungi modul Workspace untuk melihat proyek dan task yang relevan dengan Anda.
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile, role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canComplete = useCan(role as AppRole, "workspace:complete_task");
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    workspaceApi.summary()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [profile]);

  const today = new Date().toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <PageGuard permission="dashboard:view">
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
          <LayoutGrid className="w-4 h-4 text-text-muted" />
          <span className="text-[15px] font-bold text-text">Dashboard</span>
          <span className="text-[11.5px] text-text-muted ml-1 hidden sm:inline">{today}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 md:px-[22px] md:py-[22px] max-w-3xl">
            {profile && (
              <div className="mb-5">
                <div className="text-[18px] font-extrabold text-text">
                  Selamat datang, {(profile as any).full_name?.split(" ")[0]} 👋
                </div>
                <div className="text-[12.5px] text-text-muted mt-0.5">{today}</div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
              </div>
            ) : !summary ? (
              <GenericDashboard />
            ) : (
              <div className="flex flex-col gap-6">
                {/* Manager view — shown when user has workspace:manage */}
                {canManage && <ManagerDashboard summary={summary} />}

                {/* Engineer view — shown when user has workspace:complete_task */}
                {canComplete && (
                  <>
                    {canManage && (
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0">
                          Task Saya
                        </span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    )}
                    <EngineerDashboard summary={summary} />
                  </>
                )}

                {/* Fallback — user has workspace:view but neither manage nor complete_task */}
                {!canManage && !canComplete && <GenericDashboard />}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageGuard>
  );
}
