/** Role definitions and permission helpers for REIN. */

export type AppRole =
  | "admin"
  | "director"
  | "manager"
  | "finance"
  | "accounting"
  | "human_resources"
  | "engineer_mechanical"
  | "engineer_process"
  | "engineer_electrical"
  | "purchasing"
  | "operational_manager";

export type Permission =
  | "dashboard:view"
  | "dcc:view"
  | "dcc:upload"
  | "dcc:search"
  | "dcc:approve"
  | "dcc:manage_access"
  | "dcc:manage_clients"
  | "dcc:delete"
  | "dcc:chat"
  | "sidebar:crm"
  | "sidebar:projects"
  | "sidebar:finance"
  | "sidebar:hr"
  | "admin:manage_users"
  | "workspace:view"
  | "workspace:manage"
  | "workspace:complete_task";

export const ALL_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "dcc:view",
  "dcc:upload",
  "dcc:search",
  "dcc:approve",
  "dcc:manage_access",
  "dcc:manage_clients",
  "dcc:delete",
  "dcc:chat",
  "sidebar:crm",
  "sidebar:projects",
  "sidebar:finance",
  "sidebar:hr",
  "admin:manage_users",
  "workspace:view",
  "workspace:manage",
  "workspace:complete_task",
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard:view": "Lihat Dashboard",
  "dcc:view": "Lihat Dokumen",
  "dcc:upload": "Unggah Dokumen",
  "dcc:search": "Cari Dokumen",
  "dcc:approve": "Setujui Dokumen",
  "dcc:manage_access": "Kelola Akses",
  "dcc:manage_clients": "Kelola Klien & Proyek",
  "dcc:delete": "Hapus Dokumen",
  "dcc:chat": "Gunakan AI Chat",
  "sidebar:crm": "Akses Modul CRM",
  "sidebar:projects": "Akses Modul Proyek",
  "sidebar:finance": "Akses Modul Keuangan",
  "sidebar:hr": "Akses Modul HR",
  "admin:manage_users": "Kelola Pengguna (Admin)",
  "workspace:view": "Lihat Workspace",
  "workspace:manage": "Kelola Proyek & Task",
  "workspace:complete_task": "Submit Penyelesaian Task",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  director: "Direktur",
  manager: "Manajer",
  finance: "Keuangan",
  accounting: "Akuntansi",
  human_resources: "SDM",
  engineer_mechanical: "Insinyur Mekanikal",
  engineer_process: "Insinyur Proses",
  engineer_electrical: "Insinyur Elektrikal",
  purchasing: "Pengadaan",
  operational_manager: "Manajer Operasional",
};

/** Static fallback used while the API matrix is loading or unreachable. */
export const ROLE_PERMISSIONS_FALLBACK: Record<AppRole, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  director: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:manage_access", "dcc:manage_clients", "dcc:chat",
    "sidebar:crm", "sidebar:projects", "sidebar:finance", "sidebar:hr",
    "workspace:view", "workspace:manage",
  ],
  manager: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:manage_clients", "dcc:chat",
    "sidebar:crm", "sidebar:projects",
    "workspace:view", "workspace:manage",
  ],
  finance: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:chat",
    "sidebar:finance", "workspace:view",
  ],
  accounting: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "sidebar:finance", "workspace:view",
  ],
  human_resources: [
    "dashboard:view", "dcc:view", "dcc:search", "dcc:chat",
    "sidebar:hr", "workspace:view",
  ],
  engineer_mechanical: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view", "workspace:complete_task",
  ],
  engineer_process: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view", "workspace:complete_task",
  ],
  engineer_electrical: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view", "workspace:complete_task",
  ],
  purchasing: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "sidebar:crm", "workspace:view",
  ],
  operational_manager: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:chat",
    "sidebar:projects", "workspace:view", "workspace:manage",
  ],
};

/** Static helpers — kept for code paths that don't need DB-backed matrix. */
export function hasPermission(
  role: AppRole,
  permission: Permission,
  matrix: Partial<Record<AppRole, Permission[]>> = ROLE_PERMISSIONS_FALLBACK,
): boolean {
  return matrix[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(
  role: AppRole,
  permissions: Permission[],
  matrix: Partial<Record<AppRole, Permission[]>> = ROLE_PERMISSIONS_FALLBACK,
): boolean {
  return permissions.some((p) => hasPermission(role, p, matrix));
}

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return fullName.slice(0, 2).toUpperCase();
}
