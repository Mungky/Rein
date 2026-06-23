/**
 * Workspace photo storage — uploads field-worker report photos to
 * Supabase Storage bucket `workspace-photos`.
 *
 * The bucket should be created with public read access. SQL:
 *   insert into storage.buckets (id, name, public) values
 *     ('workspace-photos', 'workspace-photos', true)
 *   on conflict do nothing;
 *
 * If upload fails (bucket missing, network error, etc.), we throw — the
 * caller surfaces the error to the user.
 */

import { getSupabaseClient } from "@/lib/supabase/client";

const BUCKET = "workspace-photos";

export async function uploadWorkspacePhoto(file: File, taskId: string): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi");

  // Path: <taskId>/<timestamp>-<randomid>.<ext>
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "jpg";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${taskId}/${Date.now()}-${rand}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || `image/${ext}`,
  });

  if (error) {
    throw new Error(`Upload gagal: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
