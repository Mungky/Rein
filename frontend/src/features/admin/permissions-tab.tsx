"use client";

/** Admin — Permissions tab: module + folder access per role.
 *  Moved verbatim from app/(app)/admin/page.tsx.
 *
 *  PERM_MODULE_CARDS groups backend permission keys into admin-UI cards.
 *  Parity with backend ALL_PERMISSIONS is enforced by
 *  `backend/tests/test_frontend_parity.py` — every key must appear in
 *  exactly one card, or CI fails. */

import { useState, useEffect } from "react";
import { ChevronDown, CheckCircle, Lock, Save } from "lucide-react";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { usePermissions } from "@/components/providers/permissions-provider";
import { cn } from "@/lib/utils";
import {
  getFolderPermissions,
  setFolderPermissions,
  type FolderInfo,
  type FolderPermEntry,
} from "@/lib/api/library";
import { API_URL, ALL_ROLES, authHeaders, ErrorBanner, LoadingState } from "./shared";

/* ── Permission module cards — one card per major feature area ── */
const PERM_MODULE_CARDS: { id: string; label: string; description: string; perms: Permission[]; accent: "blue" | "green" | "amber" | "purple" }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Akses ke beranda & ringkasan harian",
    accent: "blue",
    perms: ["dashboard:view"],
  },
  {
    id: "document-control",
    label: "Document Control",
    description: "Akses ke modul Perpustakaan / DCC",
    accent: "purple",
    perms: [
      "dcc:view", "dcc:upload", "dcc:search", "dcc:approve",
      "dcc:manage_access", "dcc:manage_clients", "dcc:delete", "dcc:chat",
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Akses proyek, Work Order, eksekusi lapangan, review",
    accent: "green",
    perms: [
      "workspace:view", "workspace:manage", "workspace:complete_task",
      "workspace:create_wo", "workspace:execute_wo",
      "workspace:review_wo", "workspace:close_project",
    ],
  },
  {
    id: "scada",
    label: "R-Net",
    description: "Cloud SCADA Remula — pemantauan layar, layout, dan sumber stream",
    accent: "blue",
    perms: ["scada:view", "scada:edit_layout", "scada:manage", "scada:ack"],
  },
  {
    id: "administrasi",
    label: "Administrasi",
    description: "Kelola pengguna, jenis file, dan permission",
    accent: "amber",
    perms: ["admin:manage_users", "admin:manage_file_types"],
  },
];

type FolderPerm = {
  can_view: boolean;
  can_upload: boolean;
  can_download: boolean;
  can_rename: boolean;
  can_delete: boolean;
  can_move: boolean;
  can_create_folder: boolean;
  can_rename_folder: boolean;
  can_delete_folder: boolean;
};
type FolderDraft = Record<string, Record<string, FolderPerm>>;

const FOLDER_PERM_FIELDS: { key: keyof FolderPerm; label: string; width: string }[] = [
  { key: "can_view", label: "View", width: "w-[58px]" },
  { key: "can_upload", label: "Upload", width: "w-[62px]" },
  { key: "can_create_folder", label: "Buat Folder", width: "w-[78px]" },
  { key: "can_download", label: "Download", width: "w-[72px]" },
  { key: "can_rename", label: "Rename", width: "w-[62px]" },
  { key: "can_rename_folder", label: "Rename Folder", width: "w-[88px]" },
  { key: "can_delete", label: "Hapus", width: "w-[58px]" },
  { key: "can_delete_folder", label: "Hapus Folder", width: "w-[88px]" },
  { key: "can_move", label: "Pindah", width: "w-[62px]" },
];

const EMPTY_FOLDER_PERM: FolderPerm = {
  can_view: false, can_upload: false, can_download: false,
  can_rename: false, can_delete: false, can_move: false,
  can_create_folder: false, can_rename_folder: false, can_delete_folder: false,
};

export function PermissionsTab() {
  const { matrix, loaded, refresh, labels: permLabels } = usePermissions();
  const [draft, setDraft] = useState<Record<AppRole, Set<Permission>> | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderDraft, setFolderDraft] = useState<FolderDraft>({});
  const [folderLoaded, setFolderLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<AppRole | null>(null);

  // Load module permissions draft
  useEffect(() => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next);
  }, [loaded, matrix]);

  // Load folder permissions
  useEffect(() => {
    getFolderPermissions()
      .then(({ folders: f, permissions: p }) => {
        setFolders(f);
        const fd: FolderDraft = {};
        for (const [role] of ALL_ROLES) {
          fd[role] = {};
          for (const folder of f) fd[role][folder.id] = { ...EMPTY_FOLDER_PERM };
        }
        for (const perm of p) {
          if (!fd[perm.role]) fd[perm.role] = {};
          fd[perm.role][perm.folder_id] = {
            can_view: perm.can_view,
            can_upload: perm.can_upload,
            can_download: perm.can_download,
            can_rename: perm.can_rename,
            can_delete: perm.can_delete,
            can_move: perm.can_move,
            can_create_folder: perm.can_create_folder,
            can_rename_folder: perm.can_rename_folder,
            can_delete_folder: perm.can_delete_folder,
          };
        }
        setFolderDraft(fd);
        setFolderLoaded(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Gagal memuat izin folder");
        setFolderLoaded(true);
      });
  }, []);

  const togglePerm = (role: AppRole, perm: Permission) => {
    if (!draft || role === "admin") return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(perm)) next[role].delete(perm); else next[role].add(perm);
      return next;
    });
  };

  const toggleFolderPerm = (role: string, folderId: string, field: keyof FolderPerm) => {
    if (role === "admin") return;
    setFolderDraft((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [folderId]: {
          ...(prev[role]?.[folderId] ?? EMPTY_FOLDER_PERM),
          [field]: !prev[role]?.[folderId]?.[field],
        },
      },
    }));
  };

  const resetDraft = () => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next); setError(null); setSuccess(null);
    // Re-fetch folder perms
    setFolderLoaded(false);
    getFolderPermissions()
      .then(({ folders: f, permissions: p }) => {
        setFolders(f);
        const fd: FolderDraft = {};
        for (const [role] of ALL_ROLES) {
          fd[role] = {};
          for (const folder of f) fd[role][folder.id] = { ...EMPTY_FOLDER_PERM };
        }
        for (const perm of p) {
          if (!fd[perm.role]) fd[perm.role] = {};
          fd[perm.role][perm.folder_id] = {
            can_view: perm.can_view, can_upload: perm.can_upload, can_download: perm.can_download,
            can_rename: perm.can_rename, can_delete: perm.can_delete, can_move: perm.can_move,
            can_create_folder: perm.can_create_folder, can_rename_folder: perm.can_rename_folder, can_delete_folder: perm.can_delete_folder,
          };
        }
        setFolderDraft(fd);
      })
      .finally(() => setFolderLoaded(true));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      // -- Module permissions (PUT /api/admin/permissions) --
      const permissions: Record<string, string[]> = {};
      for (const [role, perms] of Object.entries(draft)) {
        permissions[role] = Array.from(perms);
      }
      const headers = await authHeaders();
      const permRes = await fetch(`${API_URL}/api/admin/permissions`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!permRes.ok) {
        const e = await permRes.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menyimpan izin modul");
      }

      // -- Folder permissions --
      const folderPerms: FolderPermEntry[] = [];
      for (const [role, folderMap] of Object.entries(folderDraft)) {
        if (role === "admin") continue;
        for (const [folderId, perms] of Object.entries(folderMap)) {
          folderPerms.push({ folder_id: folderId, role, ...perms });
        }
      }
      await setFolderPermissions(folderPerms);

      await refresh();
      setSuccess("Permission berhasil diperbarui.");
    } catch (e) { setError(e instanceof Error ? e.message : "Terjadi kesalahan"); }
    finally { setSaving(false); }
  };

  if (!loaded || !draft || !folderLoaded) {
    return <LoadingState label="Memuat konfigurasi permission…" />;
  }

  const nonAdminRoles = ALL_ROLES.filter(([role]) => role !== "admin");

  return (
    <div className="px-4 md:px-8 py-6">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Permission Role</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Konfigurasi izin modul dan akses folder per role. Klik nama role untuk membuka pengaturan detail.
        </p>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="mb-3 px-3.5 py-2.5 rounded-[var(--r)] bg-green-bg text-green text-[13px] border border-green/20 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {success}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {/* Admin — locked */}
        <div className="surface px-4 py-3.5 flex items-center gap-3 bg-bg-ctrl">
          <div className="w-9 h-9 rounded-full bg-amber-bg text-amber flex items-center justify-center shrink-0 ring-1 ring-amber/15">
            <Lock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-text leading-tight">Administrator</div>
            <div className="text-[11.5px] text-text-muted mt-0.5">Semua izin aktif secara otomatis</div>
          </div>
          <span className="badge badge-amber">{Object.keys(permLabels).length} izin</span>
        </div>

        {/* Non-admin role cards */}
        {nonAdminRoles.map(([role, label]) => {
          const folderCount = folders.filter((f) => folderDraft[role]?.[f.id]?.can_view).length;
          const isExpanded = expanded === role;
          const initials = label.slice(0, 2).toUpperCase();

          return (
            <div key={role} className={cn("surface overflow-hidden transition-all", isExpanded && "shadow-[var(--shadow-sm)]")}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : role)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-bg-hover transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-hover text-white text-[11px] font-bold flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.20)]">
                  {initials}
                </div>
                <span className="text-[13.5px] font-semibold text-text flex-1">{label}</span>
                <span className={cn("badge", folderCount > 0 ? "badge-blue" : "badge-muted")}>{folderCount}/{folders.length} folder</span>
                <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4 space-y-6">
                  {/* === Module permissions — one card per module === */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-light mb-3">
                      Izin Modul
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {PERM_MODULE_CARDS.map((mod) => {
                        const activeInMod = mod.perms.filter((p) => draft[role].has(p)).length;
                        return (
                          <div key={mod.id} className={cn("stat-card", `stat-card-${mod.accent}`)}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="text-[13px] font-bold text-text">{mod.label}</div>
                                <div className="text-[11px] text-text-muted mt-0.5">{mod.description}</div>
                              </div>
                              <span className={cn("badge text-[10.5px] shrink-0", activeInMod > 0 ? `badge-${mod.accent === "purple" ? "purple" : mod.accent}` : "badge-muted")}>
                                {activeInMod}/{mod.perms.length}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 mt-3">
                              {mod.perms.map((perm) => (
                                <label
                                  key={perm}
                                  className="flex items-start gap-2 cursor-pointer select-none px-2 py-1.5 rounded-[var(--r-sm)] hover:bg-bg-hover transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    checked={draft[role].has(perm)}
                                    onChange={() => togglePerm(role, perm)}
                                    className="mt-0.5 size-3.5 cursor-pointer accent-primary shrink-0"
                                  />
                                  <span className="text-[12px] text-text leading-snug flex-1">
                                    {permLabels[perm] ?? perm}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* === Folder access (per-folder DCC perms) === */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-light mb-3">
                      Akses Folder Dokumen
                    </div>
                    {folders.length === 0 ? (
                      <p className="text-[12px] text-text-muted">Tidak ada folder yang tersedia</p>
                    ) : (
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-bg-ctrl border-b border-border">
                              <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-text-muted">Folder</th>
                              {FOLDER_PERM_FIELDS.map((f) => (
                                <th
                                  key={f.key}
                                  className={cn("px-2 py-2 text-center text-[10.5px] font-bold uppercase tracking-wider text-text-muted", f.width)}
                                >
                                  {f.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {folders.map((folder) => {
                              const fp = folderDraft[role]?.[folder.id] ?? EMPTY_FOLDER_PERM;
                              return (
                                <tr key={folder.id} className="border-b border-border-soft hover:bg-bg-hover transition-colors">
                                  <td className="px-3 py-2">
                                    <div className="text-[12.5px] font-semibold text-text">{folder.name}</div>
                                    <div className="text-[10.5px] text-text-muted">{folder.dept}</div>
                                  </td>
                                  {FOLDER_PERM_FIELDS.map((field) => (
                                    <td key={field.key} className="px-2 py-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={fp[field.key]}
                                        onChange={() => toggleFolderPerm(role, folder.id, field.key)}
                                        className="w-3.5 h-3.5 cursor-pointer accent-primary"
                                      />
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button className="btn btn-default" onClick={resetDraft} disabled={saving}>Reset</button>
        <button className="btn btn-primary gap-1.5" onClick={save} disabled={saving}>
          <Save className="w-3.5 h-3.5" />
          {saving ? "Menyimpan…" : "Simpan Perubahan"}
        </button>
      </div>
    </div>
  );
}
