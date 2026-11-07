"use client";

/** Admin panel — root page: hero header, stat cards, tab switching.
 *  Tab contents live in `features/admin/` (one file per tab). */

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  Users,
  ShieldCheck,
  Folder,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageGuard } from "@/components/guards/page-guard";
import { cn } from "@/lib/utils";
import { getFolderPermissions } from "@/lib/api/library";
import { API_URL, ALL_ROLES, authHeaders } from "@/features/admin/shared";
import { UsersTab } from "@/features/admin/users-tab";
import { PermissionsTab } from "@/features/admin/permissions-tab";

const ADMIN_TABS = ["users", "permissions"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

interface AdminStats {
  users: number | null;
  folders: number | null;
  roles: number;
}

function AdminPageInner() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const want = searchParams.get("tab");
  const [tab, setTab] = useState<AdminTab>(
    ADMIN_TABS.includes(want as AdminTab) ? (want as AdminTab) : "users"
  );
  const [stats, setStats] = useState<AdminStats>({
    users: null,
    folders: null,
    roles: ALL_ROLES.length,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [users, folderRes] = await Promise.all([
          fetch(`${API_URL}/api/admin/users`, { headers }).then((r) => (r.ok ? r.json() : [])),
          getFolderPermissions().catch(() => ({ folders: [], permissions: [] })),
        ]);
        if (cancelled) return;
        setStats({
          users: Array.isArray(users) ? users.length : 0,
          folders: folderRes.folders.length,
          roles: ALL_ROLES.length,
        });
      } catch {
        if (!cancelled) setStats({ users: 0, folders: 0, roles: ALL_ROLES.length });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageGuard permission="admin:manage_users">
      <div className="flex flex-col h-full overflow-hidden bg-bg-ctrl">
        {/* Hero header */}
        <div className="px-4 md:px-8 pt-6 pb-5 bg-bg border-b border-border-soft shrink-0">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-[var(--r-xl)] bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-[0_4px_14px_rgba(37,99,235,0.30)] shrink-0">
              <Shield className="size-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] md:text-[22px] font-bold text-text leading-tight">
                Panel Administrasi
              </h1>
              <p className="text-[13px] text-text-muted mt-1 leading-relaxed">
                Kelola akun pengguna, role, serta izin akses modul dan folder dokumen.
              </p>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-soft text-primary text-[11.5px] font-semibold border border-primary/15">
              <Sparkles className="size-3" />
              Admin
            </span>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
            <StatCard
              accent="blue"
              icon={<Users className="size-5" />}
              label="Total Pengguna"
              value={stats.users}
              hint="Akun aktif & nonaktif"
            />
            <StatCard
              accent="purple"
              icon={<ShieldCheck className="size-5" />}
              label="Total Role"
              value={stats.roles}
              hint="Role yang dapat diatur"
            />
            <StatCard
              accent="green"
              icon={<Folder className="size-5" />}
              label="Folder Dokumen"
              value={stats.folders}
              hint="Folder aktif di sistem"
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-4 md:px-8 bg-bg border-b border-border shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1">
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="w-3.5 h-3.5" />}>
              Pengguna
            </TabButton>
            <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
              Permission Role
            </TabButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-ctrl">
          {tab === "users" && <UsersTab currentUserId={profile?.id} />}
          {tab === "permissions" && <PermissionsTab />}
        </div>
      </div>
    </PageGuard>
  );
}

function StatCard({
  accent,
  icon,
  label,
  value,
  hint,
}: {
  accent: "blue" | "green" | "amber" | "red" | "purple";
  icon: React.ReactNode;
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className={cn("stat-card", `stat-card-${accent}`)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[11.5px] font-semibold text-text-muted uppercase tracking-wide leading-tight">
          {label}
        </span>
        <span className="opacity-90">{icon}</span>
      </div>
      <div className="text-[24px] md:text-[26px] font-bold tabular-nums text-text leading-none">
        {value === null ? <span className="inline-block w-12 h-7 rounded bg-bg-ctrl animate-pulse" /> : value.toLocaleString("id")}
      </div>
      <div className="text-[11px] text-text-light mt-1.5">{hint}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 -mb-px transition-all whitespace-nowrap",
        active
          ? "border-primary text-primary"
          : "border-transparent text-text-muted hover:text-text hover:bg-bg-hover/50"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  );
}
