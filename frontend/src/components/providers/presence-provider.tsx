"use client";

/** App-wide presence — every signed-in user joins one Supabase Realtime
 *  channel and "tracks" themselves. Supabase Presence is a broadcast channel
 *  (no DB writes, no pooler connections), so this is cheap and never touches
 *  the 15-client transaction pool.
 *
 *  Anyone mounts the provider (so they show up as online), but only the Admin
 *  panel actually reads the list — see features/admin/activity-tab.tsx. */

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { AppRole } from "@/lib/utils/roles";

export interface OnlineUser {
  id: string;
  name: string;
  username: string;
  role: AppRole;
  /** ISO timestamp of the user's EARLIEST still-open session (drives "sudah
   *  berapa lama"). */
  online_at: string;
  /** How many tabs/devices this user has open right now. */
  connections: number;
}

const PresenceContext = createContext<OnlineUser[]>([]);

/** Live list of users currently on REIN, earliest-joined first. */
export function usePresence(): OnlineUser[] {
  return useContext(PresenceContext);
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [online, setOnline] = useState<OnlineUser[]>([]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !profile) return;

    const channel = supabase.channel("rein-presence", {
      config: { presence: { key: profile.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, OnlineUser[]>;
        // Each key (= a user id) holds one meta per open tab. Collapse them to
        // one row per user: earliest online_at + a connection count.
        const byUser = new Map<string, OnlineUser>();
        for (const metas of Object.values(state)) {
          for (const m of metas) {
            const prev = byUser.get(m.id);
            if (!prev) {
              byUser.set(m.id, { ...m, connections: 1 });
            } else {
              byUser.set(m.id, {
                ...prev,
                online_at:
                  m.online_at < prev.online_at ? m.online_at : prev.online_at,
                connections: prev.connections + 1,
              });
            }
          }
        }
        setOnline(
          [...byUser.values()].sort((a, b) =>
            a.online_at.localeCompare(b.online_at)
          )
        );
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            id: profile.id,
            name: profile.full_name,
            username: profile.username,
            role: profile.role,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // Re-join only when the identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return (
    <PresenceContext.Provider value={online}>
      {children}
    </PresenceContext.Provider>
  );
}
