/**
 * Enum domain REIN (PRD §4). Nilai disimpan dalam bahasa Inggris; label UI dalam Bahasa Indonesia.
 * Project tidak punya tahapan — hanya status Berjalan / Ditunda / Selesai (PRD §4.4).
 */

export const PROJECT_STATUSES = ['active', 'on_hold', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Berjalan',
  on_hold: 'Ditunda',
  done: 'Selesai',
};

export const WO_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'canceled',
] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const LOGBOOK_CATEGORIES = ['activity', 'document', 'issue'] as const;
export type LogbookCategory = (typeof LOGBOOK_CATEGORIES)[number];
export const LOGBOOK_CATEGORY_LABEL: Record<LogbookCategory, string> = {
  activity: 'Aktivitas',
  document: 'Dokumen',
  issue: 'Kendala',
};
export const MATERIAL_STATUSES = ['in_stock', 'not_available', 'po', 'need_review'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  in_stock: 'In stock',
  not_available: 'Not available',
  po: 'PO',
  need_review: 'Need review',
};
export const WO_STATUS_LABEL: Record<WoStatus, string> = {
  backlog: 'Backlog',
  todo: 'Belum Mulai',
  in_progress: 'Dikerjakan',
  review: 'Review',
  done: 'Selesai',
  canceled: 'Dibatalkan',
};

/** 6 kategori jenis WO (PRD §4.2, §9.9). Warna hanya untuk titik/garis/bar. */
export const WO_CATEGORIES = [
  'engineering',
  'procurement',
  'production',
  'qc_testing',
  'shipping_handover',
  'general',
] as const;
export type WoCategory = (typeof WO_CATEGORIES)[number];
export const WO_CATEGORY_META: Record<WoCategory, { label: string; token: string }> = {
  engineering: { label: 'Engineering', token: '--c-eng' },
  procurement: { label: 'Pengadaan', token: '--c-pro' },
  production: { label: 'Produksi', token: '--c-prd' },
  qc_testing: { label: 'QC & Testing', token: '--c-qct' },
  shipping_handover: { label: 'Pengiriman & Serah Terima', token: '--c-ship' },
  general: { label: 'Umum', token: '--c-umum' },
};

/** Seed jenis WO (PRD §4.2, frame D/10c). */
export const WO_TYPE_SEED: ReadonlyArray<{
  name: string;
  code: string;
  category: WoCategory;
  isPunchList?: boolean;
}> = [
  { name: 'Gambar Detail', code: 'GD', category: 'engineering' },
  { name: 'Gambar Proses', code: 'GP', category: 'engineering' },
  { name: 'Skematik', code: 'SK', category: 'engineering' },
  { name: 'Manufaktur Internal', code: 'MI', category: 'production' },
  { name: 'Manufaktur Vendor', code: 'MV', category: 'production' },
  { name: 'Belanja', code: 'BL', category: 'procurement' },
  { name: 'Machining', code: 'MC', category: 'production' },
  { name: 'QC', code: 'QC', category: 'qc_testing' },
  { name: 'Testing & Commissioning', code: 'TC', category: 'qc_testing' },
  { name: 'Pengiriman', code: 'KR', category: 'shipping_handover' },
  { name: 'Punch List', code: 'PL', category: 'shipping_handover', isPunchList: true },
  { name: 'Meeting', code: 'MT', category: 'general' },
];

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  invited: 'Diundang',
  active: 'Aktif',
  disabled: 'Nonaktif',
};

export const CONTACT_KINDS = ['email', 'whatsapp'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const VERIFICATION_PURPOSES = [
  'verify_email',
  'verify_whatsapp',
  'activate',
  'reset_password',
] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const ATTACHMENT_OWNER_TYPES = ['project', 'wo', 'logbook', 'user', 'client'] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export const ATTACHMENT_CATEGORIES = [
  'general',
  'po_client',
  'contract',
  'bast',
  'qc_doc',
  'photo',
  'drawing',
  'purchase_doc',
] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const ATTACHMENT_VARIANTS = ['original', 'display', 'thumb'] as const;
export type AttachmentVariant = (typeof ATTACHMENT_VARIANTS)[number];

/** Batas lampiran (PRD §7). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_ENTRY = 10;
