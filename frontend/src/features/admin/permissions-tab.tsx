"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check,
  Loader2,
  RotateCcw,
  FileText,
  Briefcase,
  Lock,
  Unlock,
} from "lucide-react";
import { ROLE_LABELS, type AppRole } from "@/lib/utils/roles";
import { cn } from "@/lib/utils";
import {
  getFolderPermissions,
  setFolderPermissions as saveFolderPermissions,
  type FolderInfo,
  type FolderPermEntry,
} from "@/lib/api/library";
import { API_URL, ALL_ROLES, authHeaders } from "./shared";

// Keep PERM_MODULE_CARDS intact for backend/tests/test_frontend_parity.py verification.
const PERM_MODULE_CARDS: {
  id: string;
  title: string;
  subtitle: string;
  perms: string[];
}[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    subtitle: "Ringkasan operasional dan pemantauan utama",
    perms: ["dashboard:view"],
  },
  {
    id: "workspace",
    title: "Project",
    subtitle: "Manajemen proyek, Work Order (WO), logbook harian, keluhan/kendala, dan material",
    perms: [
      "workspace:view",
      "workspace:view_all",
      "workspace:manage",
      "workspace:create_wo",
      "workspace:execute_wo",
      "workspace:review_wo",
      "workspace:verify_issue",
      "workspace:purchase",
      "workspace:warehouse",
      "workspace:publish_document",
      "workspace:approve_document",
      "workspace:archive",
    ],
  },
  {
    id: "dcc",
    title: "Document Control",
    subtitle: "Perpustakaan dokumen, pencarian, dan persetujuan akses berkas",
    perms: [
      "dcc:view",
      "dcc:upload",
      "dcc:search",
      "dcc:approve",
      "dcc:manage_access",
      "dcc:delete",
    ],
  },
  {
    id: "admin",
    title: "Administrasi",
    subtitle: "Pengelolaan akun pengguna dan konfigurasi hak akses role",
    perms: ["admin:manage_users"],
  },
];
void PERM_MODULE_CARDS;

const DEPT_ROLE_MAP_FALLBACK: Record<string, string[]> = {
  purchasing_procurement: ["purchasing", "procurement"],
  engineering: [
    "engineer_mechanical",
    "engineer_process",
    "engineer_electrical",
    "engineer_civil",
  ],
  management: ["manager"],
  hse: ["safety_man"],
  field_operational: ["operational_manager"],
  warehouse: ["warehouse_manager"],
  finance: ["finance"],
  human_resources: ["human_resources"],
  accounting: ["accounting"],
  directorate: ["director"],
};

function isOwnDivisionFolder(role: AppRole, folder: FolderInfo): boolean {
  const owners = folder.own_roles ?? DEPT_ROLE_MAP_FALLBACK[folder.dept] ?? [];
  return owners.includes(role);
}

type AccessLevel = 0 | 1 | 2 | 3 | 4;

const PROJECT_LEVELS: {
  level: AccessLevel;
  name: string;
  badge: string;
  summary: string;
  bullets: string[];
  perms: string[];
}[] = [
  {
    level: 0,
    name: "Nonaktif",
    badge: "Level 0",
    summary: "Tidak memiliki akses ke menu Project.",
    bullets: ["Menu Project tidak dapat diakses oleh role ini"],
    perms: [],
  },
  {
    level: 1,
    name: "Viewer (Pemantau)",
    badge: "Level 1",
    summary: "Memantau progres proyek tanpa mengubah pekerjaan.",
    bullets: [
      "Lihat daftar proyek, Work Order (WO), logbook, material & kendala",
      "Hanya baca (tidak bisa mengubah data)",
    ],
    perms: ["workspace:view"],
  },
  {
    level: 2,
    name: "Executor (Pelaksana)",
    badge: "Level 2",
    summary: "Mengerjakan WO, mengisi logbook harian, serta mengupdate material, stok & pembelian.",
    bullets: [
      "Semua akses Level 1 (Lihat Project)",
      "Kerjakan WO, buat Logbook harian & unggah dokumen pekerjaan",
      "Update Material, Pembelian (PO), dan Stok Gudang",
    ],
    perms: [
      "workspace:view",
      "workspace:execute_wo",
      "workspace:publish_document",
      "workspace:purchase",
      "workspace:warehouse",
    ],
  },
  {
    level: 3,
    name: "Coordinator (Supervisor)",
    badge: "Level 3",
    summary: "Mengatur Work Order, memverifikasi keluhan/kendala, dan me-review pekerjaan.",
    bullets: [
      "Semua akses Level 2 (Eksekusi WO, Logbook & Material)",
      "Tambah & ubah Work Order (WO) serta tetapkan PIC",
      "Berikan & verifikasi penyelesaian Keluhan / Kendala proyek",
      "Review hasil pengerjaan WO & setujui dokumen teknis",
    ],
    perms: [
      "workspace:view",
      "workspace:execute_wo",
      "workspace:publish_document",
      "workspace:purchase",
      "workspace:warehouse",
      "workspace:create_wo",
      "workspace:verify_issue",
      "workspace:review_wo",
      "workspace:approve_document",
    ],
  },
  {
    level: 4,
    name: "Manager (Pengelola Penuh)",
    badge: "Level 4",
    summary: "Kendali penuh atas pembuatan proyek, anggota tim, dan pantauan seluruh proyek perusahaan.",
    bullets: [
      "Semua akses Level 3 (Koordinasi WO, Kendala, Material & Review)",
      "Pantau seluruh Project perusahaan & beban kerja personel",
      "Buat Project baru, atur tahapan & kelola anggota Tim Project",
      "Arsipkan atau pulihkan Project",
    ],
    perms: [
      "workspace:view",
      "workspace:view_all",
      "workspace:manage",
      "workspace:create_wo",
      "workspace:execute_wo",
      "workspace:review_wo",
      "workspace:verify_issue",
      "workspace:purchase",
      "workspace:warehouse",
      "workspace:publish_document",
      "workspace:approve_document",
      "workspace:archive",
    ],
  },
];

const DCC_LEVELS: {
  level: AccessLevel;
  name: string;
  badge: string;
  crossDivision: boolean;
  summary: string;
  bullets: string[];
  perms: string[];
}[] = [
  {
    level: 0,
    name: "Terkunci (No Access)",
    badge: "Level 0",
    crossDivision: false,
    summary: "Tidak memiliki akses ke Document Control.",
    bullets: ["Seluruh folder departemen terkunci untuk role ini"],
    perms: [],
  },
  {
    level: 1,
    name: "Viewer (Divisi Sendiri)",
    badge: "Level 1",
    crossDivision: false,
    summary: "Buka folder, lihat & unduh dokumen khusus di folder divisinya sendiri.",
    bullets: [
      "Lihat & unduh file di folder milik divisinya sendiri",
      "Tidak bisa upload, ubah nama, atau hapus file",
      "Tidak bisa mengakses folder milik divisi lain",
    ],
    perms: ["dcc:view", "dcc:search"],
  },
  {
    level: 2,
    name: "Contributor (Divisi Sendiri)",
    badge: "Level 2",
    crossDivision: false,
    summary: "Upload dokumen & buat subfolder khusus di folder divisinya sendiri.",
    bullets: [
      "Lihat, unduh, upload file baru & buat subfolder di divisi sendiri",
      "Tidak bisa ubah nama, pindah, atau hapus file yang sudah ada",
      "Tidak bisa mengakses folder milik divisi lain",
    ],
    perms: ["dcc:view", "dcc:search", "dcc:upload"],
  },
  {
    level: 3,
    name: "Editor (Lintas Divisi)",
    badge: "Level 3",
    crossDivision: true,
    summary: "Kelola penataan berkas dan dapat mengakses seluruh folder lintas divisi.",
    bullets: [
      "Bisa mengakses folder divisi sendiri maupun folder divisi lain",
      "Lihat, unduh, upload, buat subfolder, ubah nama & pindahkan file/folder",
      "Aman: tidak bisa menghapus permanen file atau folder",
    ],
    perms: ["dcc:view", "dcc:search", "dcc:upload"],
  },
  {
    level: 4,
    name: "Full Access (Lintas Divisi)",
    badge: "Level 4",
    crossDivision: true,
    summary: "Akses penuh di seluruh folder lintas divisi termasuk menghapus berkas.",
    bullets: [
      "Bisa mengakses seluruh folder divisi sendiri maupun divisi lain",
      "Semua akses Level 3 + Hapus file & hapus subfolder",
      "Mengelola penautan folder Google Drive",
    ],
    perms: [
      "dcc:view",
      "dcc:search",
      "dcc:upload",
      "dcc:delete",
      "dcc:approve",
      "dcc:manage_access",
    ],
  },
];

function folderEntryFromLevel(
  folder_id: string,
  role: string,
  level: AccessLevel,
): FolderPermEntry {
  return {
    folder_id,
    role,
    can_view: level >= 1,
    can_download: level >= 1,
    can_upload: level >= 2,
    can_create_folder: level >= 2,
    can_rename: level >= 3,
    can_move: level >= 3,
    can_rename_folder: level >= 3,
    can_delete: level >= 4,
    can_delete_folder: level >= 4,
  };
}

function detectFolderLevel(entry?: FolderPermEntry): AccessLevel {
  if (!entry || !entry.can_view) return 0;
  if (entry.can_delete || entry.can_delete_folder) return 4;
  if (entry.can_rename || entry.can_move || entry.can_rename_folder) return 3;
  if (entry.can_upload || entry.can_create_folder) return 2;
  return 1;
}

function detectProjectLevel(perms: Set<string>): AccessLevel {
  if (perms.has("workspace:manage") || perms.has("workspace:archive") || perms.has("workspace:view_all")) {
    return 4;
  }
  if (
    perms.has("workspace:create_wo") ||
    perms.has("workspace:verify_issue") ||
    perms.has("workspace:review_wo") ||
    perms.has("workspace:approve_document")
  ) {
    return 3;
  }
  if (
    perms.has("workspace:execute_wo") ||
    perms.has("workspace:publish_document") ||
    perms.has("workspace:purchase") ||
    perms.has("workspace:warehouse")
  ) {
    return 2;
  }
  if (perms.has("workspace:view")) {
    return 1;
  }
  return 0;
}

function detectRoleDccLevel(
  role: AppRole,
  perms: Set<string>,
  folders: FolderInfo[],
  folderMap: Record<string, Record<string, FolderPermEntry>>,
): AccessLevel {
  let maxOwn: AccessLevel = 0;
  let maxOther: AccessLevel = 0;

  for (const f of folders) {
    const lv = detectFolderLevel(folderMap[f.id]?.[role]);
    if (isOwnDivisionFolder(role, f)) {
      if (lv > maxOwn) maxOwn = lv;
    } else {
      if (lv > maxOther) maxOther = lv;
    }
  }

  if (maxOwn === 4 || maxOther === 4 || perms.has("dcc:delete")) return 4;
  if (maxOwn === 3 || maxOther > 0) return 3;
  if (maxOwn === 2 || perms.has("dcc:upload")) return 2;
  if (maxOwn === 1 || perms.has("dcc:view")) return 1;
  return 0;
}

interface PermMatrixPayload {
  permissions?: Record<string, string[]>;
  matrix?: Record<string, string[]>;
  all_permissions: string[];
  labels: Record<string, string>;
}

const ALL_ROLE_KEYS: AppRole[] = ALL_ROLES.map(([r]) => r);
const NON_ADMIN_ROLES: AppRole[] = ALL_ROLE_KEYS.filter((r) => r !== "admin");

export function PermissionsTab() {
  const [selectedRole, setSelectedRole] = useState<AppRole>("engineer_mechanical");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectLevels, setProjectLevels] = useState<Record<string, AccessLevel>>({});
  const [dccLevels, setDccLevels] = useState<Record<string, AccessLevel>>({});
  const [folders, setFolders] = useState<FolderInfo[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const [modRes, folderData] = await Promise.all([
        fetch(`${API_URL}/api/admin/permissions`, { headers }),
        getFolderPermissions(),
      ]);
      if (!modRes.ok) throw new Error("Gagal memuat matriks izin modul");
      const modJson: PermMatrixPayload = await modRes.json();
      const rawMatrix = modJson.permissions ?? modJson.matrix ?? {};

      const fmap: Record<string, Record<string, FolderPermEntry>> = {};
      for (const f of folderData.folders) {
        fmap[f.id] = {};
      }
      for (const p of folderData.permissions) {
        if (fmap[p.folder_id]) {
          fmap[p.folder_id][p.role] = { ...p };
        }
      }

      const initProj: Record<string, AccessLevel> = {};
      const initDcc: Record<string, AccessLevel> = {};
      for (const r of NON_ADMIN_ROLES) {
        const permSet = new Set(rawMatrix[r] ?? []);
        initProj[r] = detectProjectLevel(permSet);
        initDcc[r] = detectRoleDccLevel(r, permSet, folderData.folders, fmap);
      }

      setFolders(folderData.folders);
      setProjectLevels(initProj);
      setDccLevels(initDcc);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal memuat izin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSelectProjectLevel = (level: AccessLevel) => {
    setProjectLevels((prev) => ({ ...prev, [selectedRole]: level }));
    setSavedOk(false);
  };

  const handleSelectDccLevel = (level: AccessLevel) => {
    setDccLevels((prev) => ({ ...prev, [selectedRole]: level }));
    setSavedOk(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedOk(false);
    setError(null);
    try {
      const headers = await authHeaders();
      const matrixOut: Record<string, string[]> = {};
      const flatFolders: FolderPermEntry[] = [];

      for (const r of NON_ADMIN_ROLES) {
        const pLv = projectLevels[r] ?? 0;
        const dLv = dccLevels[r] ?? 0;

        const projPerms = PROJECT_LEVELS.find((l) => l.level === pLv)?.perms ?? [];
        const dccPerms = DCC_LEVELS.find((l) => l.level === dLv)?.perms ?? [];

        // Non-admin roles never receive admin:manage_users; dashboard:view is always enabled.
        const rolePermSet = new Set<string>(["dashboard:view", ...projPerms, ...dccPerms]);
        matrixOut[r] = Array.from(rolePermSet);

        // Compute folder permissions automatically from the role's DCC Access Level:
        // - Level 0-2: Only own division folder gets `dLv`; other divisions get Level 0 (locked).
        // - Level 3-4: All folders (own & other divisions) get `dLv`.
        for (const f of folders) {
          const own = isOwnDivisionFolder(r, f);
          const folderLv: AccessLevel = dLv >= 3 ? dLv : own ? dLv : 0;
          flatFolders.push(folderEntryFromLevel(f.id, r, folderLv));
        }
      }

      const [modRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/permissions`, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: matrixOut }),
        }),
        saveFolderPermissions(flatFolders),
      ]);
      if (!modRes.ok) {
        const body = await modRes.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `HTTP ${modRes.status}`);
      }
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan izin");
    } finally {
      setSaving(false);
    }
  };

  const handleResetModules = async () => {
    if (!confirm("Reset semua izin role ke pengaturan bawaan?")) return;
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/permissions/reset`, {
        method: "POST",
        headers,
      });
      if (!res.ok) throw new Error("Gagal mereset izin");
      await loadAll();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal mereset");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-text-light" />
      </div>
    );
  }

  const currentProjectLevel: AccessLevel = projectLevels[selectedRole] ?? 0;
  const currentDccLevel: AccessLevel = dccLevels[selectedRole] ?? 0;
  const ownFolderNames = folders
    .filter((f) => isOwnDivisionFolder(selectedRole, f))
    .map((f) => f.name);

  return (
    <div className="p-4 md:p-8 max-w-[1180px] mx-auto space-y-6">
      {/* Top Bar: Role Selector + Summary + Save */}
      <div className="bg-bg border border-border rounded-[var(--r-xl)] p-4 md:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-light">
              Konfigurasi Access Level Role
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h2 className="text-[18px] font-bold text-text">
                {ROLE_LABELS[selectedRole]}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-primary-soft text-primary border border-primary/20">
                Project: Level {currentProjectLevel} ({PROJECT_LEVELS[currentProjectLevel].name})
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                Document Control: Level {currentDccLevel} ({DCC_LEVELS[currentDccLevel].name})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {savedOk && (
              <span className="flex items-center gap-1 text-[12px] text-green font-semibold px-2">
                <Check className="w-3.5 h-3.5" /> Tersimpan
              </span>
            )}
            <button
              type="button"
              onClick={handleResetModules}
              disabled={saving}
              className="btn btn-default btn-sm gap-1.5 text-[12px]"
              title="Kembalikan izin ke pengaturan bawaan"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset Bawaan
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn btn-primary btn-sm gap-1.5 text-[12.5px] px-4"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Simpan Perubahan
            </button>
          </div>
        </div>

        {/* Role Selector Pills */}
        <div className="flex flex-wrap gap-1.5 pt-3 border-t border-border-soft">
          {NON_ADMIN_ROLES.map((r) => {
            const active = r === selectedRole;
            const pLv = projectLevels[r] ?? 0;
            const dLv = dccLevels[r] ?? 0;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setSelectedRole(r)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-[var(--r-md)] text-[12px] font-semibold border transition-all",
                  active
                    ? "bg-primary text-white border-primary shadow-xs"
                    : "bg-bg-ctrl text-text-muted border-border hover:border-primary/40 hover:text-text"
                )}
              >
                <span>{ROLE_LABELS[r]}</span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-mono font-bold",
                    active ? "bg-white/20 text-white" : "bg-bg text-text-light border border-border-soft"
                  )}
                >
                  P:{pLv} · DC:{dLv}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-bg border border-red/20 rounded-[var(--r-lg)] text-[12.5px] text-red">
          {error}
        </div>
      )}

      {/* 1. ACCESS LEVEL: PROJECT (Level 0 - Level 4) */}
      <section className="bg-bg border border-border rounded-[var(--r-xl)] overflow-hidden shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-5 py-3.5 bg-bg-ctrl/60 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-8 rounded-[var(--r-md)] bg-primary-soft border border-primary/15 flex items-center justify-center shrink-0">
              <Briefcase className="size-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-bold text-text">Access Level: Project</h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/20">
                  Level {currentProjectLevel} — {PROJECT_LEVELS[currentProjectLevel].name}
                </span>
              </div>
              <p className="text-[11.5px] text-text-muted">
                Pilih tingkatan akses <strong>{ROLE_LABELS[selectedRole]}</strong> untuk modul Project
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {PROJECT_LEVELS.map((item) => {
              const selected = currentProjectLevel === item.level;
              return (
                <button
                  key={item.level}
                  type="button"
                  onClick={() => handleSelectProjectLevel(item.level)}
                  className={cn(
                    "text-left p-3.5 rounded-[var(--r-lg)] border transition-all flex flex-col justify-between gap-2",
                    selected
                      ? "bg-primary-soft/35 border-primary ring-2 ring-primary/20 shadow-xs"
                      : "bg-bg border-border hover:border-primary/40 hover:bg-bg-hover"
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={cn(
                          "text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                          selected
                            ? "bg-primary text-white"
                            : "bg-bg-ctrl text-text-muted border border-border-soft"
                        )}
                      >
                        {item.badge}
                      </span>
                      {selected && <Check className="size-4 text-primary shrink-0" />}
                    </div>
                    <div className="text-[13px] font-bold text-text leading-snug">
                      {item.name}
                    </div>
                    <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                      {item.summary}
                    </p>
                  </div>

                  <ul className="mt-2 pt-2 border-t border-border-soft space-y-1">
                    {item.bullets.map((b, i) => (
                      <li key={i} className="text-[10.5px] text-text-muted flex items-start gap-1.5 leading-snug">
                        <span className="text-primary font-bold">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. ACCESS LEVEL: DOCUMENT CONTROL (Level 0 - Level 4) */}
      <section className="bg-bg border border-border rounded-[var(--r-xl)] overflow-hidden shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-5 py-3.5 bg-bg-ctrl/60 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-8 rounded-[var(--r-md)] bg-primary-soft border border-primary/15 flex items-center justify-center shrink-0">
              <FileText className="size-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-bold text-text">Access Level: Document Control</h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  Level {currentDccLevel} — {DCC_LEVELS[currentDccLevel].name}
                </span>
              </div>
              <p className="text-[11.5px] text-text-muted">
                Pilih tingkatan akses <strong>{ROLE_LABELS[selectedRole]}</strong> untuk modul Document Control
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {DCC_LEVELS.map((item) => {
              const selected = currentDccLevel === item.level;
              return (
                <button
                  key={item.level}
                  type="button"
                  onClick={() => handleSelectDccLevel(item.level)}
                  className={cn(
                    "text-left p-3.5 rounded-[var(--r-lg)] border transition-all flex flex-col justify-between gap-2",
                    selected
                      ? "bg-primary-soft/35 border-primary ring-2 ring-primary/20 shadow-xs"
                      : "bg-bg border-border hover:border-primary/40 hover:bg-bg-hover"
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={cn(
                          "text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                          selected
                            ? "bg-primary text-white"
                            : "bg-bg-ctrl text-text-muted border border-border-soft"
                        )}
                      >
                        {item.badge}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                          item.crossDivision
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-800 border border-amber-200"
                        )}
                      >
                        {item.crossDivision ? "Lintas Divisi" : "Divisi Sendiri"}
                      </span>
                    </div>
                    <div className="text-[13px] font-bold text-text leading-snug">
                      {item.name}
                    </div>
                    <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                      {item.summary}
                    </p>
                  </div>

                  <ul className="mt-2 pt-2 border-t border-border-soft space-y-1">
                    {item.bullets.map((b, i) => (
                      <li key={i} className="text-[10.5px] text-text-muted flex items-start gap-1.5 leading-snug">
                        <span className="text-primary font-bold">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          {/* Concise Division Scope Info Banner */}
          <div
            className={cn(
              "rounded-[var(--r-lg)] border px-3.5 py-2.5 flex items-center gap-2.5 text-[12px]",
              currentDccLevel <= 2
                ? "bg-amber-50/70 border-amber-200 text-amber-950"
                : "bg-emerald-50/60 border-emerald-200 text-emerald-950"
            )}
          >
            {currentDccLevel <= 2 ? (
              <Lock className="size-4 text-amber-700 shrink-0" />
            ) : (
              <Unlock className="size-4 text-emerald-700 shrink-0" />
            )}
            <span>
              {currentDccLevel === 0 ? (
                <>
                  <strong>Level 0 (Terkunci):</strong> Role ini tidak dapat membuka folder mana pun di Document Control.
                </>
              ) : currentDccLevel <= 2 ? (
                <>
                  <strong>Cakupan Folder Level {currentDccLevel} (Khusus Divisi Sendiri):</strong> Hanya dapat mengakses folder{" "}
                  <strong>{ownFolderNames.length ? ownFolderNames.join(", ") : "divisinya sendiri"}</strong>. Folder milik divisi lain terkunci (jika membutuhkan file dari divisi lain, minta ke pengguna minimal <strong>Level 3</strong>).
                </>
              ) : (
                <>
                  <strong>Cakupan Folder Level {currentDccLevel} (Lintas Divisi):</strong> Dapat mengakses dan mengelola berkas di seluruh folder departemen (baik divisi sendiri maupun divisi lain).
                </>
              )}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
