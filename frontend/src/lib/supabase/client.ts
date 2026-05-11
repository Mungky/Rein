/** Supabase browser client for REIN. */

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabaseInstance: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("Supabase URL or API key not configured. Auth features will be disabled.");
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseInstance;
}

// Lazy-initialized singleton — only creates client when accessed
export const supabase = typeof window !== "undefined" ? getSupabaseClient() : null;