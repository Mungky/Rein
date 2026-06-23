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
  | "engineer_civil"
  | "purchasing"
  | "procurement"
  | "safety_man"
  | "warehouse_manager"
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
  | "admin:manage_users"
  | "admin:manage_file_types"
  | "workspace:view"
  | "workspace:manage"
  | "workspace:complete_task"
  | "workspace:create_wo"
  | "workspace:execute_wo"
  | "workspace:review_wo"
  | "workspace:close_project";

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
  "admin:manage_users",
  "admin:manage_file_types",
  "workspace:view",
  "workspace:manage",
  "workspace:complete_task",
  "workspace:create_wo",
  "workspace:execute_wo",
  "workspace:review_wo",
  "workspace:close_project",
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
  "admin:manage_users": "Kelola Pengguna (Admin)",
  "admin:manage_file_types": "Kelola Jenis File (Admin)",
  "workspace:view": "Lihat Workspace",
  "workspace:manage": "Kelola Proyek & Phase",
  "workspace:complete_task": "Submit Penyelesaian Task (legacy)",
  "workspace:create_wo": "Buat Work Order",
  "workspace:execute_wo": "Eksekusi WO (mulai & submit laporan)",
  "workspace:review_wo": "Review WO (approve / minta revisi)",
  "workspace:close_project": "Tutup Proyek",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  director: "Direktur",
  manager: "General Manager",
  finance: "Finance",
  accounting: "Accounting",
  human_resources: "Human Resources",
  engineer_mechanical: "Mechanical Engineer",
  engineer_process: "Process Engineer",
  engineer_electrical: "Electrical Engineer",
  engineer_civil: "Civil Engineer",
  purchasing: "Purchasing",
  procurement: "Procurement",
  safety_man: "Safety Man",
  warehouse_manager: "Warehouse Manager",
  operational_manager: "Operational Manager",
};

/** Static fallback used while the API matrix is loading or unreachable. */
export const ROLE_PERMISSIONS_FALLBACK: Record<AppRole, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  director: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:manage_access", "dcc:manage_clients", "dcc:chat",
    "workspace:view", "workspace:manage",
  ],
  manager: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:manage_clients", "dcc:chat",
    "workspace:view", "workspace:manage",
  ],
  finance: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:chat", "workspace:view",
  ],
  accounting: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view",
  ],
  human_resources: [
    "dashboard:view", "dcc:view", "dcc:search", "dcc:chat", "workspace:view",
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
  engineer_civil: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view", "workspace:complete_task",
  ],
  purchasing: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view",
  ],
  procurement: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view",
  ],
  safety_man: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view",
  ],
  warehouse_manager: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    "workspace:view",
  ],
  operational_manager: [
    "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
    "dcc:approve", "dcc:chat", "workspace:view", "workspace:manage",
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
