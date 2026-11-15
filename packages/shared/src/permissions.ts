/**
 * Kunci izin & matriks default (PRD §2.3, §2.4).
 * Scope:
 *  - all     : semua project / global
 *  - managed : project tempat user pengelola (is_project_manager)
 *  - member  : project tempat user anggota
 *  - own     : objek yang dibuat / di-assign / ditulis user
 *  - none    : tidak diizinkan
 */

export const SCOPES = ['all', 'managed', 'member', 'own', 'none'] as const;
export type Scope = (typeof SCOPES)[number];

export const PERMISSIONS = {
  'project.view': { label: 'Melihat project & isinya', scopes: ['all', 'member'] },
  'project.create': { label: 'Membuat project', scopes: ['all'] },
  'project.edit': { label: 'Edit info project & status', scopes: ['all', 'managed'] },
  'project.members.manage': { label: 'Kelola anggota project', scopes: ['all', 'managed'] },
  'project.close': { label: 'Menandai Selesai & arsip', scopes: ['all', 'managed'] },
  'wo.create': { label: 'Membuat WO', scopes: ['all', 'managed', 'member'] },
  'wo.edit.any': { label: 'Edit WO siapa pun', scopes: ['all', 'managed'] },
  'wo.edit.own': { label: 'Edit WO yang di-assign ke saya', scopes: ['own'] },
  'wo.delete': { label: 'Hapus WO', scopes: ['all', 'managed'] },
  'wo.weight.edit': { label: 'Ubah bobot WO', scopes: ['all', 'managed'] },
  'logbook.create': { label: 'Menulis logbook & komentar', scopes: ['member'] },
  'logbook.edit.own': { label: 'Edit/hapus entri sendiri ≤ 24 jam', scopes: ['own'] },
  'logbook.delete.any': { label: 'Hapus entri orang lain', scopes: ['all', 'managed'] },
  'attachment.upload': { label: 'Mengunggah lampiran', scopes: ['member'] },
  'attachment.delete.any': { label: 'Menghapus lampiran orang lain', scopes: ['all', 'managed'] },
  'view.scurve': { label: 'Melihat S-Curve', scopes: ['all', 'member'] },
  'admin.users': { label: 'Kelola pengguna', scopes: ['all'] },
  'admin.roles': { label: 'Kelola role & izin', scopes: ['all'] },
  'admin.wo_types': { label: 'Kelola jenis WO', scopes: ['all'] },
  'admin.audit': { label: 'Melihat audit log', scopes: ['all'] },
} as const satisfies Record<string, { label: string; scopes: readonly Scope[] }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.hasOwn(PERMISSIONS, key);
}

export const SYSTEM_ROLES = [
  'manager',
  'engineering',
  'production',
  'purchasing',
  'qc',
  'admin',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const SYSTEM_ROLE_META: Record<SystemRole, { name: string; division: string }> = {
  manager: { name: 'Manager', division: 'Manajemen Project' },
  engineering: { name: 'Engineering/Drafting', division: 'Engineering' },
  production: { name: 'Produksi', division: 'Produksi' },
  purchasing: { name: 'Purchasing', division: 'Purchasing' },
  qc: { name: 'QC', division: 'Quality Control' },
  admin: { name: 'Admin', division: 'Sistem' },
};

export type PermissionMap = Partial<Record<PermissionKey, Scope>>;

/**
 * Matriks default (PRD §2.4). Entri yang tidak disebut = none.
 * Asumsi: ✓ tanpa scope → scope tunggal yang didukung permission itu; `view.scurve`
 * mengikuti scope `project.view` role tersebut (all untuk Manager & Admin, member lainnya).
 */
const WORKER: PermissionMap = {
  'project.view': 'member',
  'wo.create': 'member',
  'wo.edit.own': 'own',
  'logbook.create': 'member',
  'logbook.edit.own': 'own',
  'attachment.upload': 'member',
  'view.scurve': 'member',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, PermissionMap> = {
  manager: {
    'project.view': 'all',
    'project.create': 'all',
    'project.edit': 'managed',
    'project.members.manage': 'managed',
    'project.close': 'managed',
    'wo.create': 'member',
    'wo.edit.any': 'managed',
    'wo.edit.own': 'own',
    'wo.weight.edit': 'managed',
    'logbook.create': 'member',
    'logbook.edit.own': 'own',
    'attachment.upload': 'member',
    'view.scurve': 'all',
    'admin.wo_types': 'all',
  },
  engineering: { ...WORKER },
  production: { ...WORKER },
  purchasing: { ...WORKER },
  qc: { ...WORKER },
  admin: {
    'project.view': 'all',
    'project.edit': 'all',
    'project.members.manage': 'all',
    'logbook.delete.any': 'all',
    'attachment.delete.any': 'all',
    'view.scurve': 'all',
    'admin.users': 'all',
    'admin.roles': 'all',
    'admin.wo_types': 'all',
    'admin.audit': 'all',
  },
};
