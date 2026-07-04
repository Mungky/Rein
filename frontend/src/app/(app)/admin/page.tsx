"use client";

/** Admin panel — root page: hero header, stat cards, tab switching.
 *  Tab contents live in `features/admin/` (one file per tab). */

import { useState, useEffect } from "react";
import {
  Shield,
  Users,
  ShieldCheck,
  FileText,
  Hash,
  Folder,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageGuard } from "@/components/guards/page-guard";
import { cn } from "@/lib/utils";
import { getSequences, getFolderPermissions } from "@/lib/api/library";
import { API_URL, authHeaders } from "@/features/admin/shared";
import { UsersTab } from "@/features/admin/users-tab";
import { SequencesTab } from "@/features/admin/sequences-tab";
import { DocTypesTab, type FileTypeRow } from "@/features/admin/file-types-tab";
import { PermissionsTab } from "@/features/admin/permissions-tab";

type AdminTab = "users" | "sequences" | "doctypes" | "permissions";

interface AdminStats {
  users: number | null;
  fileTypes: number | null;
  folders: number | null;
  sequences: number | null;
}

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<AdminTab>("users");
  const [stats, setStats] = useState<AdminStats>({ users: null, fileTypes: null, folders: null, sequences: null });

  // Fetch summary stats in parallel — pure read, doesn't block tab rendering
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [users, fileTypes, folderRes, seqRes] = await Promise.all([
          fetch(`${API_URL}/api/admin/users`, { headers }).then((r) => r.ok ? r.json() : []),
          fetch(`${API_URL}/api/admin/file-types`, { headers }).then((r) => r.ok ? r.json() : []),
          getFolderPermissions().catch(() => ({ folders: [], permissions: [] })),
          getSequences().catch(() => ({ sequences: [] })),
        ]);
        if (cancelled) return;
        setStats({
          users: Array.isArray(users) ? users.length : 0,
          fileTypes: Array.isArray(fileTypes) ? fileTypes.filter((t: FileTypeRow) => t.is_active).length : 0,
          folders: folderRes.folders.length,
          sequences: seqRes.sequences.length,
        });
      } catch {
        if (!cancelled) setStats({ users: 0, fileTypes: 0, folders: 0, sequences: 0 });
      }
    })();
    return () => { cancelled = true; };
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
                Kelola pengguna, jenis dokumen, nomor urutan arsip, dan izin akses folder seluruh Rein.
              </p>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-soft text-primary text-[11.5px] font-semibold border border-primary/15">
              <Sparkles className="size-3" />
              Admin
            </span>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            <StatCard
              accent="blue"
              icon={<Users className="size-5" />}
              label="Total Pengguna"
              value={stats.users}
              hint="Akun aktif & nonaktif"
            />
            <StatCard
              accent="purple"
              icon={<FileText className="size-5" />}
              label="Jenis File"
              value={stats.fileTypes}
              hint="Yang aktif dipakai"
            />
            <StatCard
              accent="green"
              icon={<Folder className="size-5" />}
              label="Folder Dokumen"
              value={stats.folders}
              hint="Tercatat di sistem"
            />
            <StatCard
              accent="amber"
              icon={<Hash className="size-5" />}
              label="Nomor Urutan"
              value={stats.sequences}
              hint="Sequence dokumen"
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-4 md:px-8 bg-bg border-b border-border shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1">
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="w-3.5 h-3.5" />}>
              Pengguna
            </TabButton>
            <TabButton active={tab === "sequences"} onClick={() => setTab("sequences")} icon={<Hash className="w-3.5 h-3.5" />}>
              Nomor Urutan
            </TabButton>
            <TabButton active={tab === "doctypes"} onClick={() => setTab("doctypes")} icon={<FileText className="w-3.5 h-3.5" />}>
              Jenis File
            </TabButton>
            <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
              Permission Role
            </TabButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-ctrl">
          {tab === "users" && <UsersTab currentUserId={profile?.id} />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "doctypes" && <DocTypesTab />}
          {tab === "permissions" && <PermissionsTab />}
        </div>
      </div>
    </PageGuard>
  );
}

function StatCard({
  accent, icon, label, value, hint,
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
  active, onClick, icon, children,
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
