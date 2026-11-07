"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { ROLE_LABELS, getInitials } from "@/lib/utils/roles";
import { requestProfile, clearProfileRequest } from "@/lib/auth/profile-request";
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
  /** NULL selama profil belum diketahui — jangan pernah ditebak. Lihat catatan
   *  di useAuth() tentang kenapa ini sebelumnya punya nilai bawaan. */
  role: AppRole | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useAuth(): AuthState {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!!supabase);

  const fetchProfile = useCallback(
    async (accessToken: string): Promise<{ profile: UserProfile | null; expired: boolean }> => {
      try {
        const res = await requestProfile(API_URL, accessToken);
        // 401/403 = the token is rejected (expired/invalid), not a transient
        // outage. Signal "expired" so the caller can clear the stale session
        // and send the user to login instead of hanging (Masalah G). A network
        // error or 5xx is NOT expired — keep the session and let it retry.
        if (res.status === 401 || res.status === 403) return { profile: null, expired: true };
        if (!res.ok) return { profile: null, expired: false };
        const data = await res.json();
        return {
          profile: {
            id: data.id,
            username: data.username ?? "",
            full_name: data.full_name ?? "",
            initials: data.initials ?? "",
            avatar_url: data.avatar_url ?? null,
            role: (data.role as AppRole) ?? "engineer_mechanical",
            is_active: data.is_active ?? true,
          },
          expired: false,
        };
      } catch {
        return { profile: null, expired: false };
      }
    },
    []
  );

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function init() {
      const {
        data: { session },
      } = await supabase!.auth.getSession();

      if (cancelled) return;

      if (session?.user) {
        setUser(session.user);
        const { profile: prof, expired } = await fetchProfile(session.access_token);
        if (cancelled) return;
        if (expired) {
          // Stale ticket — clear it so we don't sit half-authenticated.
          // onAuthStateChange fires with null and the guards send us to login.
          await supabase!.auth.signOut();
          setUser(null);
          setProfile(null);
        } else {
          setProfile(prof);
        }
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
          const { profile: prof, expired } = await fetchProfile(session.access_token);
          if (cancelled) return;
          if (expired) {
            await supabase!.auth.signOut();
            setUser(null);
            setProfile(null);
          } else {
            setProfile(prof);
          }
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

  useEffect(() => {
    if (!supabase) return;
    const handleProfileUpdated = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const { profile: prof } = await fetchProfile(session.access_token);
      if (prof) setProfile(prof);
    };
    window.addEventListener("rein:profile-updated", handleProfileUpdated);
    return () => window.removeEventListener("rein:profile-updated", handleProfileUpdated);
  }, [supabase, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (!supabase) return;
    clearProfileRequest();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const { profile: prof } = await fetchProfile(session.access_token);
    if (prof) setProfile(prof);
    window.dispatchEvent(new CustomEvent("rein:profile-updated"));
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
    clearProfileRequest();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

  /** Peran user, atau NULL kalau profilnya belum diketahui.
   *
   *  Dulu ini `profile?.role ?? "engineer_mechanical"` — sebuah peran NYATA
   *  yang diberikan diam-diam ketika profilnya belum ada. Akibatnya bukan
   *  kosmetik: selama profil masih dimuat, atau kalau /api/auth/me gagal, atau
   *  di antara pergantian sesi, useCan() menjawab pertanyaan izin memakai peran
   *  itu — jadi tombol ubah/kelola bisa muncul untuk orang yang belum jelas
   *  siapa. Layar salah selama sedetik memang tidak berbahaya pada dirinya
   *  sendiri, tapi ia mengajarkan bahwa UI-lah yang menentukan izin. (Yang
   *  benar-benar menjaga data tetap backend: setiap endpoint R-Net menuntut
   *  permission-nya sendiri.)
   *
   *  `useCan` sudah menerima null dan menjawab false — "belum tahu" berarti
   *  "belum boleh", bukan "boleh". */
  const role = profile?.role ?? null;

  return { user, profile, role, loading, login, logout, refreshProfile };
}

/** Convenience helpers */
export function useAuthDisplay() {
  const { profile, role, refreshProfile } = useAuth();
  const userName = profile?.full_name || "Pengguna";
  const userInitials = profile?.initials || (profile?.full_name ? getInitials(profile.full_name) : "U");
  const username = profile?.username || "";
  const avatarUrl = profile?.avatar_url || null;
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "—";
  return { userName, userInitials, username, avatarUrl, roleLabel, role, refreshProfile };
}

export type { Permission };
