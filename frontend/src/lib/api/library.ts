import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  DocumentSequence,
  FolderNode,
  LibraryFileMeta,
  ProposeResult,
  PublicIndexDept,
  UploadFormValues,
  ViewRequestResponse,
} from "@/features/library/types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  try {
    const sessionPromise = supabase!.auth.getSession();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("session timeout")), 8000),
    );
    const { data: { session } } = await Promise.race([sessionPromise, timeout]);
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
  } catch {
    return {};
  }
}

// ── Folder tree ──────────────────────────────────────────────────────────────

export async function getFolderTree(): Promise<{ tree: FolderNode[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/tree`, { headers });
  if (!res.ok) throw new Error("Gagal memuat folder tree");
  return res.json();
}

// ── File listing ─────────────────────────────────────────────────────────────

export interface FolderMyPerms {
  can_view: boolean;
  can_upload: boolean;
  can_download: boolean;
  can_rename: boolean;
  can_delete: boolean;
  can_move: boolean;
  can_create_folder: boolean;
  can_rename_folder: boolean;
  can_delete_folder: boolean;
}

export type FolderFilesResult = {
  files: LibraryFileMeta[];
  total: number;
  folder: { name: string; path: string; department: string };
  my_perms: FolderMyPerms;
};

export async function getFolderFiles(
  folderId: string,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<FolderFilesResult> {
  const headers = await authHeaders();
  const q = new URLSearchParams();
  q.set("page", String(opts.page ?? 1));
  q.set("page_size", String(opts.pageSize ?? 200));
  if (opts.search) q.set("search", opts.search);
  const res = await fetch(
    `${API}/api/library/folders/${folderId}/files?${q}`,
    { headers },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal memuat daftar file");
  }
  return res.json();
}

export async function getPublicIndex(): Promise<{ departments: PublicIndexDept[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/public-index`, { headers });
  if (!res.ok) throw new Error("Gagal memuat index publik");
  return res.json();
}

export async function resetStuckUploads(): Promise<{ reset_count: number }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/reset-stuck`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error("Gagal reset file stuck");
  return res.json();
}

export interface ActivityEntry {
  id: number;
  action: string;
  actor_name: string | null;
  actor_username: string | null;
  actor_role: string | null;
  target_type: string | null;
  target_id: string | null;
  file_name: string | null;
  file_status: string | null;
  audit_layers: { layer: number; layer_name: string; status: string }[];
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
  page: number;
  page_size: number;
  stuck_count: number;
  failed_count: number;
  email_configured: boolean;
}

export async function getAdminActivity(params: {
  search?: string;
  action?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ActivityResponse> {
  const headers = await authHeaders();
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.action) q.set("action", params.action);
  q.set("page", String(params.page ?? 1));
  q.set("page_size", String(params.pageSize ?? 50));
  const res = await fetch(`${API}/api/library/admin/activity?${q}`, { headers });
  if (!res.ok) throw new Error("Gagal memuat panel aktivitas");
  return res.json();
}

export async function purgeTempFile(fileId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/temp/${fileId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal menghapus record");
  }
}

export async function purgeAllFailed(): Promise<{
  purged_count: number;
  drive_trash_failed: number;
}> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/purge-failed`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal hapus massal");
  }
  return res.json();
}

export interface EmailConfig {
  smtp_configured: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_from: string | null;
  librarian_emails_configured: boolean;
  recipient_count: number;
  recipients_redacted: string[];
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/email-config`, { headers });
  if (!res.ok) throw new Error("Gagal memuat konfigurasi email");
  return res.json();
}

export async function sendTestEmail(): Promise<{ sent: number; recipients: number; errors: string[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/email-test`, { method: "POST", headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal mengirim email tes");
  }
  return res.json();
}

export interface ViewRequestInboxItem {
  id: string;
  status: "pending" | "approved" | "denied" | "expired";
  file_id: string;
  file_name: string;
  doc_type: string | null;
  requester_name: string;
  requester_username: string;
  requester_role: string;
  created_at: string;
  expires_at: string | null;
  approved_at: string | null;
}

export async function getViewRequestInbox(): Promise<{
  pending: ViewRequestInboxItem[];
  recent: ViewRequestInboxItem[];
}> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/view-requests/inbox`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal memuat inbox permintaan akses");
  }
  return res.json();
}

export async function decideViewRequest(
  reqId: string,
  action: "approve" | "deny",
): Promise<{ status: string; id: string; link_expires_at?: string }> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/api/library/view-requests/${reqId}/decide?action=${action}`,
    { method: "POST", headers },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal memproses permintaan");
  }
  return res.json();
}

export async function moveFile(
  fileId: string,
  targetFolderId: string,
): Promise<{ id: string; folder_id: string; moved: boolean; drive_moved?: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}/move`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ target_folder_id: targetFolderId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal memindahkan file");
  }
  return res.json();
}

// ── Propose (metadata detection — no upload yet) ─────────────────────────────

export async function proposeFile(
  filename: string,
  fileSize: number,
  folderId?: string,
  contentHash?: string,
): Promise<ProposeResult> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/propose`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      file_size: fileSize,
      folder_id: folderId,
      content_hash: contentHash,
    }),
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
  form.append("use_original_name", "true");

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
      if (xhr.status >= 200 && xhr.status < 300) {
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
    xhr.ontimeout = () => reject(new Error("Koneksi timeout — coba lagi"));
    xhr.timeout = 600_000;
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

export async function getSequences(): Promise<{ sequences: DocumentSequence[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/sequences`, { headers });
  if (!res.ok) throw new Error("Gagal memuat nomor urutan");
  return res.json();
}

export interface FolderInfo {
  id: string;
  name: string;
  dept: string;
  dept_label: string;
  own_roles?: string[];
}

export interface FolderPermEntry {
  folder_id: string;
  role: string;
  can_view: boolean;
  can_upload: boolean;
  can_download: boolean;
  can_rename: boolean;
  can_delete: boolean;
  can_move: boolean;
  can_create_folder: boolean;
  can_rename_folder: boolean;
  can_delete_folder: boolean;
}

export async function getFolderPermissions(): Promise<{ folders: FolderInfo[]; permissions: FolderPermEntry[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/folder-permissions`, { headers });
  if (!res.ok) throw new Error("Gagal memuat izin folder");
  return res.json();
}

export async function setFolderPermissions(permissions: FolderPermEntry[]): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/folder-permissions`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal menyimpan izin folder");
  }
}

export async function renameFile(
  fileId: string,
  fileName: string,
): Promise<{ id: string; file_name: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/files/${fileId}/rename`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal rename file");
  }
  return res.json();
}

export async function renameFolder(
  folderId: string,
  name: string,
): Promise<{ id: string; name: string; path: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/folders/${folderId}/rename`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal rename folder");
  }
  return res.json();
}

export async function deleteFolder(
  folderId: string,
  cascade = false,
): Promise<{ files_trashed: number; drive_folder_trashed: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API}/api/library/folders/${folderId}?cascade=${cascade ? "true" : "false"}`,
    { method: "DELETE", headers },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal menghapus folder");
  }
  return res.json();
}

export async function moveFolder(
  folderId: string,
  targetParentId: string | null,
): Promise<{ id: string; path: string; drive_moved: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/folders/${folderId}/move`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ target_parent_id: targetParentId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal memindahkan folder");
  }
  return res.json();
}

export async function linkFolderToDrive(
  folderId: string,
  gdriveFolderId: string | null,
): Promise<{ id: string; gdrive_folder_id: string | null }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/admin/folders/${folderId}/gdrive-link`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ gdrive_folder_id: gdriveFolderId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Gagal menghubungkan folder ke Drive");
  }
  return res.json();
}

export async function getPublicIndexSheets(): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/public-index/sheets`, { headers });
  if (!res.ok) throw new Error("Gagal memuat data spreadsheet");
  return res.json();
}

export async function getPublicList(): Promise<{ files: { id: string; file_name: string; uploaded_by: string; created_at: string }[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/public-list`, { headers });
  if (!res.ok) throw new Error("Gagal memuat daftar file publik");
  return res.json();
}

export async function setSequence(docType: string, currentNumber: number): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/api/library/sequences/${docType}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ current_number: currentNumber }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Gagal mengatur nomor urutan");
  }
}
