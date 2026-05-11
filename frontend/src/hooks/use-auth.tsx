"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { ROLE_LABELS, getInitials } from "@/lib/utils/roles";
import { usernameToEmail } from "@/lib/auth/username";

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  initials: string;
  avatar_url: string | null;
  role: AppRole;
  is_active: boolean;
}

export interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  role: AppRole;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useAuth(): AuthState {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(
    async (accessToken: string): Promise<UserProfile | null> => {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          id: data.id,
          username: data.username ?? "",
          full_name: data.full_name ?? "",
          initials: data.initials ?? "",
          avatar_url: data.avatar_url ?? null,
          role: (data.role as AppRole) ?? "engineer_mechanical",
          is_active: data.is_active ?? true,
        };
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function init() {
      const {
        data: { session },
      } = await supabase!.auth.getSession();

      if (cancelled) return;

      if (session?.user) {
        setUser(session.user);
        const prof = await fetchProfile(session.access_token);
        if (!cancelled) setProfile(prof);
      }
      setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event: string, session: Session | null) => {
        if (cancelled) return;

        if (session?.user) {
          setUser(session.user);
          const prof = await fetchProfile(session.access_token);
          if (!cancelled) setProfile(prof);
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  const login = useCallback(
    async (username: string, password: string): Promise<{ error: string | null }> => {
      if (!supabase) {
        return { error: "Supabase belum dikonfigurasi." };
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (error) {
        return { error: error.message };
      }
      return { error: null };
    },
    [supabase]
  );

  const logout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

  const role = (profile?.role ?? "engineer_mechanical") as AppRole;

  return { user, profile, role, loading, login, logout };
}

/** Convenience helpers */
export function useAuthDisplay() {
  const { profile, role } = useAuth();
  const userName = profile?.full_name || "Pengguna";
  const userInitials = profile?.initials || (profile?.full_name ? getInitials(profile.full_name) : "U");
  const username = profile?.username || "";
  const roleLabel = ROLE_LABELS[role] ?? role;
  return { userName, userInitials, username, roleLabel, role };
}

export type { Permission };
