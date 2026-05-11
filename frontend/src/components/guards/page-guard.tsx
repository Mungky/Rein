"use client";

import { ShieldX } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCan, usePermissions } from "@/components/providers/permissions-provider";
import type { Permission } from "@/lib/utils/roles";

export function PageGuard({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { profile, loading: authLoading } = useAuth();
  const { loaded: permsLoaded } = usePermissions();
  const allowed = useCan(profile?.role, permission);

  if (authLoading || !permsLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-muted animate-pulse">Memuat…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full badge-purple flex items-center justify-center">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L12 6.5 6.5 12 1 6.5z" fill="currentColor" />
          </svg>
        </div>
        <p className="text-[13px] text-text-muted">Memuat profil…</p>
      </div>
    );
  }

  if (!allowed) {
    const permLabel: Record<string, string> = {
      "dashboard:view": "Dashboard",
      "dcc:view": "Document Manager",
      "dcc:upload": "Unggah Dokumen",
      "dcc:search": "Cari Dokumen",
      "dcc:approve": "Persetujuan",
      "dcc:manage_access": "Kelola Akses",
      "dcc:delete": "Hapus Dokumen",
      "dcc:chat": "AI Chat",
    };
    const label = permLabel[permission] || permission;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full bg-red-bg text-red flex items-center justify-center">
          <ShieldX className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-text mb-1">Akses Ditolak</p>
          <p className="text-[13px] text-text-muted">
            Role <span className="font-semibold text-text">{profile.role}</span> tidak memiliki izin <span className="font-semibold text-text">{label}</span>.
          </p>
          <p className="text-[12px] text-text-light mt-2">
            Hubungi administrator untuk mendapatkan akses.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}