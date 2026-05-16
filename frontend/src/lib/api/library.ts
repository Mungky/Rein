import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  ActivityLogEntry,
  FolderNode,
  LibraryFileMeta,
  ProposeResult,
  TempFile,
  UploadFormValues,
  ViewRequestResponse,
} from "@/features/library/types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase!.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

// ── Folder tree ──────────────────────────────────────────────────────────────

export async function getFolderTree(): Promise<{ tree: FolderNode[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/tree`, { headers });
  if (!res.ok) throw new Error("Gagal memuat folder tree");
  return res.json();
}

// ── File listing ─────────────────────────────────────────────────────────────

export type FolderFilesResult =
  | { restricted: false; files: LibraryFileMeta[]; total: number; folder: { name: string; path: string; department: string } }
  | { restricted: true; folder: { id: string; name: string; department: string; dept_label: string }; file_count: number; last_updated: string | null };

export async function getFolderFiles(
  folderId: string,
  page = 1,
  pageSize = 50,
): Promise<FolderFilesResult> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/api/library/folders/${folderId}/files?page=${page}&page_size=${pageSize}`,
    { headers },
  );
  if (!res.ok) throw new Error("Gagal memuat daftar file");
  const data = await res.json();
  return data.restricted ? { restricted: true, ...data } : { restricted: false, ...data };
}

export async function getAdminTemp(): Promise<{
  temp_files: TempFile[];
  activity_log: ActivityLogEntry[];
}> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/temp`, { headers });
  if (!res.ok) throw new Error("Gagal memuat panel sementara");
  return res.json();
}

// ── Propose (metadata detection — no upload yet) ─────────────────────────────

export async function proposeFile(
  filename: string,
  fileSize: number,
  folderId?: string,
): Promise<ProposeResult> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/propose`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, file_size: fileSize, folder_id: folderId }),
  });
  if (!res.ok) throw new Error("Gagal mendeteksi metadata");
  return res.json();
}

// ── Upload (after confirm) ────────────────────────────────────────────────────

export async function uploadFile(
  file: File,
  values: UploadFormValues,
  onProgress?: (pct: number) => void,
): Promise<{ file_id: string; file_name: string; status: string }> {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("file", file);
  form.append("folder_id", values.folder_id);
  if (values.doc_type) form.append("doc_type", values.doc_type);
  if (values.client_code) form.append("client_code", values.client_code);
  if (values.client_name) form.append("client_name", values.client_name);
  if (values.project_code) form.append("project_code", values.project_code);
  if (values.project_name) form.append("project_name", values.project_name);
  if (values.title) form.append("title", values.title);
  if (values.note) form.append("note", values.note);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/api/library/upload`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    xhr.onload = () => {
      if (xhr.status === 202) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || "Upload gagal"));
        } catch {
          reject(new Error("Upload gagal"));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus saat upload"));
    xhr.send(form);
  });
}

// ── File status polling ───────────────────────────────────────────────────────

export async function getFileStatus(fileId: string) {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}/status`, { headers });
  if (!res.ok) throw new Error("Gagal memuat status file");
  return res.json();
}

// ── View request ──────────────────────────────────────────────────────────────

export async function requestViewAccess(fileId: string): Promise<ViewRequestResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}/view-request`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal mengirim permintaan akses");
  }
  return res.json();
}

export async function pollViewLink(fileId: string): Promise<ViewRequestResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}/link`, { headers });
  if (!res.ok) throw new Error("Gagal memeriksa status akses");
  return res.json();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function deleteFile(fileId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error("Gagal menghapus file");
}

export async function getAuditLog(page = 1, pageSize = 100) {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/api/library/log?page=${page}&page_size=${pageSize}`,
    { headers },
  );
  if (!res.ok) throw new Error("Gagal memuat log aktivitas");
  return res.json();
}

export async function createFolder(body: {
  name: string;
  department: string;
  folder_type?: string;
  parent_id?: string;
}) {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/folders`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal membuat folder");
  }
  return res.json();
}
