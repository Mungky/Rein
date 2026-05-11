const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authHeaders(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export type DccAction = "upload" | "access_request";

export interface DccActivityEntry {
  id: string;
  user_name: string;
  user_initials: string;
  user_role: string;
  action: DccAction;
  detail: string;
  created_at: string;
}

export const dccActivityApi = {
  async log(action: DccAction, detail: string): Promise<void> {
    try {
      const headers = await authHeaders();
      await fetch(`${API_URL}/api/dcc/activity`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action, detail }),
      });
    } catch {
      // Fire-and-forget — don't block the user action on logging failure
    }
  },

  async list(limit = 50): Promise<DccActivityEntry[]> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/dcc/activity?limit=${limit}`, { headers });
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },
};
