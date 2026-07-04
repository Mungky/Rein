"use client";

/** Shared helpers for the admin panel tabs. */

import { Loader2 } from "lucide-react";
import { ROLE_LABELS, type AppRole } from "@/lib/utils/roles";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const ALL_ROLES = Object.entries(ROLE_LABELS) as [AppRole, string][];

export async function authHeaders(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <Loader2 className="size-6 mx-auto mb-3 text-primary animate-spin" />
        <p className="text-[13px] text-text-muted">{label}</p>
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mb-4 px-3.5 py-2.5 rounded-[var(--r)] bg-red-bg text-red text-[13px] border border-red/20 flex items-center gap-2">
      <span className="flex-1">{message}</span>
      <button className="text-[11px] underline shrink-0" onClick={onClose}>Tutup</button>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-muted mb-1.5 block tracking-tight">{label}</label>
      {children}
    </div>
  );
}
