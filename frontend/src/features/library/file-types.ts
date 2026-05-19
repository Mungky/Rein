/** Fetch the active file-type list from the backend, with a small in-memory cache. */

export interface ActiveFileType {
  code: string;
  label: string;
  description: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

let cached: ActiveFileType[] | null = null;
let expiresAt = 0;
let inflight: Promise<ActiveFileType[]> | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function fetchFromServer(): Promise<ActiveFileType[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}/api/library/file-types`, { headers });
  if (!res.ok) throw new Error(`Gagal memuat jenis file (HTTP ${res.status})`);
  const data = await res.json();
  return data.file_types as ActiveFileType[];
}

export async function getActiveFileTypes(): Promise<ActiveFileType[]> {
  const now = Date.now();
  if (cached && now < expiresAt) return cached;
  if (inflight) return inflight;
  inflight = fetchFromServer()
    .then((list) => {
      cached = list;
      expiresAt = Date.now() + TTL_MS;
      return list;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cache — call after admin adds/edits types to force a refetch. */
export function invalidateFileTypesCache(): void {
  cached = null;
  expiresAt = 0;
}

/** Build a "CODE — Label" string the same way the form selects expect. */
export function formatFileTypeOption(t: ActiveFileType): string {
  return `${t.code} — ${t.label}`;
}
