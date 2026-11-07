"use client";

/** Permission matrix provider — single source of truth is the backend
 *  (`db/models/role_permission.py`, served by GET /api/permissions/).
 *
 *  Design rules:
 *  - Admin always passes `can()` — mirrors the backend short-circuit in
 *    `_load_permissions`, so a stale/incomplete DB matrix can never lock
 *    the admin out of the UI.
 *  - No hardcoded fallback matrix. If the API can't be reached we expose
 *    `error` and let guards show an explicit failure state — silently
 *    guessing permissions hides real problems.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { toast } from "sonner";

import { getSupabaseClient } from "@/lib/supabase/client";
import type { AppRole, Permission } from "@/lib/utils/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Matrix = Partial<Record<AppRole, Permission[]>>;

interface PermissionsCtx {
  matrix: Matrix;
  /** Indonesian labels per permission key, served by the backend. */
  labels: Record<string, string>;
  loaded: boolean;
  /** True when the matrix could not be fetched — guards should surface this. */
  error: boolean;
  refresh: () => Promise<void>;
  can: (role: AppRole, permission: Permission) => boolean;
}

const Ctx = createContext<PermissionsCtx>({
  matrix: {},
  labels: {},
  loaded: false,
  error: false,
  refresh: async () => {},
  can: (role) => role === "admin",
});

export function usePermissions() {
  return useContext(Ctx);
}

export function useCan(role: AppRole | undefined | null, permission: Permission): boolean {
  const { can } = usePermissions();
  if (!role) return false;
  return can(role, permission);
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [matrix, setMatrix] = useState<Matrix>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const fetchingRef = useRef(false);
  const errorToastShownRef = useRef(false);

  // Toast once per failure episode — loud, but not spammy on retries
  const failLoudly = useCallback(() => {
    setError(true);
    setLoaded(true);
    if (!errorToastShownRef.current) {
      errorToastShownRef.current = true;
      toast.error("Gagal memuat izin akses — beberapa menu mungkin tersembunyi", {
        description: "Periksa koneksi ke server, lalu coba muat ulang.",
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        failLoudly();
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // Not logged in yet — nothing to fetch, not an error
        setLoaded(true);
        return;
      }

      const res = await fetch(`${API_URL}/api/permissions`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        failLoudly();
        return;
      }
      const data = (await res.json()) as {
        permissions: Record<string, string[]>;
        labels?: Record<string, string>;
      };
      const next: Matrix = {};
      for (const [role, perms] of Object.entries(data.permissions ?? {})) {
        next[role as AppRole] = perms as Permission[];
      }
      setMatrix(next);
      setLabels(data.labels ?? {});
      setError(false);
      setLoaded(true);
      errorToastShownRef.current = false;
    } catch {
      failLoudly();
    } finally {
      fetchingRef.current = false;
    }
  }, [failLoudly]);

  useEffect(() => {
    void refresh();
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refresh();
      } else if (event === "SIGNED_OUT") {
        setMatrix({});
        setLabels({});
        setLoaded(false);
        setError(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const can = useCallback(
    (role: AppRole, permission: Permission) => {
      if (role === "admin") return true;
      return matrix[role]?.includes(permission) ?? false;
    },
    [matrix],
  );

  const value = useMemo(
    () => ({ matrix, labels, loaded, error, refresh, can }),
    [matrix, labels, loaded, error, refresh, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
