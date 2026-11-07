"use client";

/**
 * Mobile My Work Orders list — jumbo cards, tap-friendly.
 *
 * Lists all non-done tasks assigned to the current user, grouped by status.
 * Tap a card → navigate to /m/wo/[id] for the detail/execution flow.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Calendar, CheckCircle2, ClipboardCheck, Clock,
  LogOut, MapPin, RefreshCw, User as UserIcon,
} from "lucide-react";
import { useAuth, useAuthDisplay } from "@/hooks/use-auth";
import { workspaceApi } from "@/lib/api/workspace";
import type { Task } from "@/lib/api/workspace";
import { workOrderLabel } from "@/features/workspace/work-order-ui";

function statusInfo(status: string) {
  switch (status) {
    case "in_progress":    return { label: "On Progress",  Icon: Clock,           cls: "bg-blue-bg text-blue border-blue/30" };
    case "pending_review": return { label: "Need Review",    Icon: ClipboardCheck,  cls: "bg-amber-bg text-amber border-amber/30" };
    case "overdue":        return { label: "Terlambat",          Icon: AlertTriangle,   cls: "bg-red-bg text-red border-red/30" };
    case "done":           return { label: "Finish",            Icon: CheckCircle2,    cls: "bg-green-bg text-green border-green/30" };
    default:               return { label: "To Do",        Icon: Clock,           cls: "bg-bg-ctrl text-text-muted border-border" };
  }
}

function deadlineInfo(iso: string | null) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `${Math.abs(diff)} hari lewat`, tone: "danger" as const };
  if (diff === 0) return { label: "Hari ini", tone: "danger" as const };
  if (diff === 1) return { label: "Besok", tone: "warn" as const };
  if (diff <= 3) return { label: `${diff} hari lagi`, tone: "warn" as const };
  return { label: d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }), tone: "ok" as const };
}

export default function MobileWorkOrdersPage() {
  const router = useRouter();
  const { loading: authLoading, profile, logout } = useAuth();
  const { userName, userInitials } = useAuthDisplay();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setRefreshing(true);
    setError(null);
    try {
      const list = await workspaceApi.myTasks();
      setTasks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat WO");
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authLoading && profile) void Promise.resolve().then(() => load());
  }, [authLoading, profile]);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  if (authLoading || tasks === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-ctrl">
        <div className="text-center">
          <div className="relative mx-auto size-14 animate-pulse">
            <Image src="/rein-logo.png" alt="REIN" fill sizes="56px" priority className="object-contain" />
          </div>
          <p className="mt-4 text-[13px] font-medium text-text-muted">Memuat…</p>
        </div>
      </div>
    );
  }

  // Group by status
  const groups = [
    { key: "in_progress",    label: "On Progress",    items: tasks.filter((t) => t.status === "in_progress") },
    { key: "todo",           label: "To Do",        items: tasks.filter((t) => t.status === "todo") },
    { key: "overdue",        label: "Sudah Lewat Tenggat", items: tasks.filter((t) => t.status === "overdue") },
    { key: "pending_review", label: "Need Review",    items: tasks.filter((t) => t.status === "pending_review") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-bg border-b border-border-soft px-4 h-16 flex items-center gap-3 shadow-[var(--shadow-xs)]">
        <div className="relative size-9 shrink-0">
          <Image src="/rein-logo.png" alt="REIN" fill sizes="36px" className="object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text leading-tight">Work Orders</div>
          <div className="text-[11px] text-text-muted truncate">{userName}</div>
        </div>
        <button
          onClick={() => load()}
          className="btn btn-ghost btn-icon size-10"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={handleLogout}
          className="btn btn-ghost btn-icon size-10"
          title="Keluar"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 px-4 py-4 pb-12 flex flex-col gap-5">
        {error && (
          <div className="px-3 py-2.5 rounded-[var(--r)] bg-red-bg text-red text-[13px] border border-red/20">
            {error}
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="size-16 rounded-full bg-green-bg flex items-center justify-center">
              <CheckCircle2 className="size-8 text-green" />
            </div>
            <div>
              <div className="text-[15px] font-bold text-text">Hari ini bebas!</div>
              <div className="text-[12.5px] text-text-muted mt-1">Tidak ada WO yang ditugaskan.</div>
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-light mb-2 px-1">
                {g.label} · <span className="tabular-nums">{g.items.length}</span>
              </h2>
              <div className="flex flex-col gap-2.5">
                {g.items.map((t) => <MobileWoCard key={t.id} task={t} />)}
              </div>
            </section>
          ))
        )}
      </main>

      {/* User avatar floating (optional) */}
      <div className="hidden">
        {/* placeholder for future bottom nav */}
        <span>{userInitials}</span>
      </div>
    </div>
  );
}

function MobileWoCard({ task }: { task: Task }) {
  const dl = deadlineInfo(task.deadline);
  const si = statusInfo(task.status);
  return (
    <Link
      href={`/m/wo/${task.id}`}
      className="surface px-4 py-3.5 flex flex-col gap-2 active:bg-bg-hover transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[15px] font-bold text-text leading-snug flex-1">
          {workOrderLabel(task)}
        </div>
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full border ${si.cls} shrink-0`}>
          <si.Icon className="size-3" />
          {si.label}
        </span>
      </div>

      {task.location && (
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{task.location}</span>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11.5px] text-text-muted flex-wrap">
        {dl && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
            dl.tone === "danger" ? "bg-red-bg text-red"
            : dl.tone === "warn" ? "bg-amber-bg text-amber"
            : "bg-bg-ctrl text-text-muted"
          }`}>
            <Calendar className="size-3" />
            {dl.label}
          </span>
        )}
        {task.assigned_name && (
          <span className="inline-flex items-center gap-1">
            <UserIcon className="size-3" />
            {task.assigned_name}
          </span>
        )}
      </div>
    </Link>
  );
}
