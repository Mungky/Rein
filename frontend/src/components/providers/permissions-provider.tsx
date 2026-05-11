"use client";

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

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  ROLE_PERMISSIONS_FALLBACK,
  type AppRole,
  type Permission,
} from "@/lib/utils/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Matrix = Partial<Record<AppRole, Permission[]>>;

interface PermissionsCtx {
  matrix: Matrix;
  loaded: boolean;
  refresh: () => Promise<void>;
  can: (role: AppRole, permission: Permission) => boolean;
}

const Ctx = createContext<PermissionsCtx>({
  matrix: ROLE_PERMISSIONS_FALLBACK,
  loaded: false,
  refresh: async () => {},
  can: (role, permission) => ROLE_PERMISSIONS_FALLBACK[role]?.includes(permission) ?? false,
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
  const [matrix, setMatrix] = useState<Matrix>(ROLE_PERMISSIONS_FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoaded(true);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setLoaded(true);
        return;
      }

      const res = await fetch(`${API_URL}/api/permissions/`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoaded(true);
        return;
      }
      const data = (await res.json()) as { permissions: Record<string, string[]> };
      const next: Matrix = {};
      for (const [role, perms] of Object.entries(data.permissions ?? {})) {
        next[role as AppRole] = perms as Permission[];
      }
      setMatrix(next);
      setLoaded(true);
    } catch {
      setLoaded(true);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

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
        setMatrix(ROLE_PERMISSIONS_FALLBACK);
        setLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const can = useCallback(
    (role: AppRole, permission: Permission) => matrix[role]?.includes(permission) ?? false,
    [matrix],
  );

  const value = useMemo(
    () => ({ matrix, loaded, refresh, can }),
    [matrix, loaded, refresh, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
