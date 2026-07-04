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

/** Compile-time union of permission keys.
 *
 *  Source of truth is the backend: `ALL_PERMISSIONS` in
 *  `db/models/role_permission.py`. This union exists only so typos are
 *  caught at build time — labels, the active matrix, and role defaults all
 *  come from the API (`GET /api/permissions/`), never from this file.
 *  Parity with the backend is enforced by `backend/tests`. */
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
  | "workspace:close_project"
  | "scada:view"
  | "scada:edit_layout"
  | "scada:manage";

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

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return fullName.slice(0, 2).toUpperCase();
}
