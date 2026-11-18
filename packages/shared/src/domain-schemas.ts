/** Schema Zod domain M1: project, anggota, WO, logbook, Butuh bantuan (PRD §3.3–3.6). */
import { z } from 'zod';
import {
  LOGBOOK_CATEGORIES,
  MATERIAL_STATUSES,
  PROJECT_STATUSES,
  WO_CATEGORIES,
  WO_STATUSES,
} from './enums';

const req = (label: string) => `${label} wajib diisi`;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const trimmed = (label: string, max: number) =>
  z.string().trim().min(1, req(label)).max(max, `${label} maksimal ${max} karakter`);

export const projectCreateSchema = z
  .object({
    clientName: trimmed('Nama klien', 120),
    rpoNumber: trimmed('No RPO', 40),
    name: trimmed('Nama project', 160),
    location: z.string().trim().max(160).optional(),
    startDate: isoDate,
    endDate: isoDate,
    description: z.string().trim().max(500, 'Deskripsi maksimal 500 karakter').optional(),
    logoAttachmentId: z.uuid().optional(),
    bannerAttachmentId: z.uuid().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'Tanggal selesai tidak boleh sebelum tanggal mulai',
  });
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectMediaSchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    logoAttachmentId: z.uuid().nullable().optional(),
    bannerAttachmentId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.logoAttachmentId !== undefined || v.bannerAttachmentId !== undefined, {
    message: 'Pilih foto/logo atau banner yang ingin diubah',
  });

export const projectUpdateSchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    clientName: trimmed('Nama klien', 120).optional(),
    rpoNumber: trimmed('No RPO', 40).optional(),
    name: trimmed('Nama project', 160).optional(),
    location: z.string().trim().max(160).nullable().optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'Tanggal selesai tidak boleh sebelum tanggal mulai',
  });

export const projectStatusSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  note: z.string().trim().max(300).optional(),
});

export const memberUpsertSchema = z.object({
  userId: z.uuid(),
  projectRole: z.string().trim().min(1, req('Peran')).max(40),
  isProjectManager: z.boolean().default(false),
});

export const woCreateSchema = z
  .object({
    /** UUID dari klien — idempotensi (pelajaran v1): kirim ulang dengan id sama tidak membuat WO ganda. */
    clientId: z.uuid(),
    title: trimmed('Nama WO', 160),
    typeId: z.uuid('Pilih jenis WO'),
    assigneeId: z.uuid('Pilih penanggung jawab'),
    plannedStart: isoDate.optional(),
    deadline: isoDate,
    urgent: z.boolean().default(false),
    weight: z.number().min(0).max(100).nullable().optional(),
    detail: z.string().trim().max(5000).optional(),
    references: z
      .array(
        z.object({
          kind: z.enum(['wo', 'url']),
          targetWoId: z.uuid().optional(),
          url: z.url().optional(),
          label: z.string().trim().max(120).optional(),
        }),
      )
      .max(10)
      .default([]),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
  })
  .refine((v) => !v.plannedStart || v.deadline >= v.plannedStart, {
    path: ['deadline'],
    message: 'Deadline tidak boleh sebelum tanggal mulai',
  });
export type WoCreateInput = z.infer<typeof woCreateSchema>;

export const woUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  title: trimmed('Nama WO', 160).optional(),
  typeId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  plannedStart: isoDate.optional(),
  deadline: isoDate.optional(),
  urgent: z.boolean().optional(),
  weight: z.number().min(0).max(100).nullable().optional(),
  detail: z.string().trim().max(5000).optional(),
});

export const woStatusSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(WO_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const logbookCreateSchema = z
  .object({
    clientId: z.uuid(),
    body: z.string().trim().max(5000).default(''),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
    clientCreatedAt: z.iso.datetime({ offset: true }).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    category: z.enum(LOGBOOK_CATEGORIES).optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => v.body || v.attachmentIds.length || v.progress !== undefined, {
    message: 'Isi catatan, lampiran, atau progres',
    path: ['body'],
  })
  .refine((v) => v.progress === undefined || v.expectedUpdatedAt !== undefined, {
    message: 'Versi WO wajib untuk memperbarui progres',
    path: ['expectedUpdatedAt'],
  });
export type LogbookCreateInput = z.infer<typeof logbookCreateSchema>;

const materialFields = {
  partNo: z.string().trim().max(120).default(''),
  description: trimmed('Description', 500),
  material: z.string().trim().max(200).default(''),
  specification: z.string().trim().max(500).default(''),
  quantity: z
    .number()
    .positive()
    .max(999999999)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001, 'QTY maksimal 3 desimal'),
  unit: trimmed('Satuan', 30),
  status: z.enum(MATERIAL_STATUSES).default('not_available'),
  receivedAt: isoDate
    .refine(
      (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      'Tanggal tidak valid',
    )
    .nullable()
    .default(null),
  note: z.string().trim().max(2000).default(''),
};
export const materialFieldsSchema = z.object(materialFields).strict();
export type MaterialInput = z.infer<typeof materialFieldsSchema>;
export function materialIdentity(
  row: Pick<MaterialInput, 'partNo' | 'description' | 'material' | 'specification' | 'unit'>,
): string {
  return JSON.stringify(
    [row.partNo, row.description, row.material, row.specification, row.unit].map((v) =>
      v.trim().toLowerCase().replace(/\s+/g, ' '),
    ),
  );
}
export const materialCreateSchema = z.object({ clientId: z.uuid(), ...materialFields }).strict();
export const materialImportSchema = z
  .object({ rows: z.array(materialCreateSchema).min(1).max(500) })
  .strict()
  .refine(
    (v) => new Set(v.rows.map((r) => r.clientId)).size === v.rows.length,
    'ID material tidak boleh berulang',
  );
export const materialUpdateSchema = z
  .object({ ...materialFields, expectedUpdatedAt: z.iso.datetime({ offset: true }) })
  .strict();
export const materialDeleteSchema = materialUpdateSchema.pick({ expectedUpdatedAt: true });
export const materialLinkSchema = z.object({ woId: z.uuid() }).strict();

export const helpRequestSchema = z.object({
  clientId: z.uuid(),
  body: trimmed('Kendala', 1000),
  showFlag: z.boolean().default(true),
});

export const helpReplySchema = z.object({
  clientId: z.uuid(),
  body: trimmed('Balasan', 5000),
  resolve: z.boolean().default(false),
});

export const woTypeSchema = z.object({
  name: trimmed('Nama jenis', 60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Kode 2–4 huruf'),
  category: z.enum(WO_CATEGORIES),
  isPunchList: z.boolean().default(false),
  active: z.boolean().default(true),
});

/** FR-093: ubah sebagian field jenis WO; urutan lewat `woTypeOrderSchema`. */
export const woTypeUpdateSchema = z.object({
  name: woTypeSchema.shape.name.optional(),
  code: woTypeSchema.shape.code.optional(),
  category: z.enum(WO_CATEGORIES).optional(),
  isPunchList: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const woTypeOrderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) });
