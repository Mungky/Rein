import { describe, expect, it } from 'vitest';
import {
  logbookCreateSchema,
  materialFieldsSchema,
  materialIdentity,
  materialImportSchema,
} from './domain-schemas';
let sequence = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;

describe('Logbook revisi 1.8', () => {
  const note = { clientId: randomUUID(), body: 'Fit-up selesai' };
  it('catatan lama dan status catatan tetap opsional; status WO terpisah', () => {
    expect(logbookCreateSchema.safeParse(note).success).toBe(true);
    for (const category of ['activity', 'document', 'issue'])
      expect(logbookCreateSchema.safeParse({ ...note, category }).success).toBe(true);
    expect(logbookCreateSchema.safeParse({ ...note, status: 'done' }).success).toBe(false);
    expect(logbookCreateSchema.safeParse({ ...note, category: 'done' }).success).toBe(false);
    expect(
      logbookCreateSchema.safeParse({ clientId: note.clientId, category: 'activity' }).success,
    ).toBe(false);
  });
  it('progres saja diperbolehkan, 0 tetap tersimpan, versi WO wajib', () => {
    const input = {
      clientId: note.clientId,
      progress: 0,
      expectedUpdatedAt: new Date().toISOString(),
    };
    expect(logbookCreateSchema.parse(input).progress).toBe(0);
    expect(logbookCreateSchema.safeParse({ ...note, progress: 50 }).success).toBe(false);
    for (const progress of [-1, 101, 0.5, NaN])
      expect(logbookCreateSchema.safeParse({ ...input, progress }).success).toBe(false);
  });
});

describe('Material', () => {
  const row = { description: 'Frame', quantity: 4, unit: 'Btg' };
  it('identitas merapikan kapital/spasi dan mengabaikan jumlah/status/catatan', () => {
    const original = materialFieldsSchema.parse({
      ...row,
      partNo: 'M-01',
      material: 'AISI 304',
      specification: '50 x 50',
    });
    expect(materialIdentity(original)).toBe(
      materialIdentity({
        ...original,
        partNo: ' m-01 ',
        description: 'FRAME',
        material: 'aisi   304',
      }),
    );
    expect(materialIdentity(original)).not.toBe(
      materialIdentity({ ...original, specification: '60 x 60' }),
    );
    expect(materialIdentity(original)).not.toBe(materialIdentity({ ...original, unit: 'Pcs' }));
  });
  it('QTY positif, maksimal tiga desimal dan status/tanggal tervalidasi', () => {
    expect(materialFieldsSchema.parse(row)).toMatchObject({
      quantity: 4,
      status: 'not_available',
      receivedAt: null,
    });
    expect(materialFieldsSchema.safeParse({ ...row, quantity: 0.125 }).success).toBe(true);
    for (const quantity of [0, -1, Infinity, 1.0001, 1000000000])
      expect(materialFieldsSchema.safeParse({ ...row, quantity }).success).toBe(false);
    for (const receivedAt of ['2026-02-30', '2026-13-01', '18/11/2026'])
      expect(materialFieldsSchema.safeParse({ ...row, receivedAt }).success).toBe(false);
    expect(
      materialFieldsSchema.safeParse({ ...row, receivedAt: '2026-11-18', status: 'po' }).success,
    ).toBe(true);
    expect(materialFieldsSchema.safeParse({ ...row, unit: '' }).success).toBe(false);
    expect(materialFieldsSchema.safeParse({ ...row, status: 'paid' }).success).toBe(false);
    expect(materialFieldsSchema.safeParse({ ...row, price: 10 }).success).toBe(false);
  });
  it('impor menolak ID berulang dan satu baris invalid agar tidak menyimpan sebagian', () => {
    const entry = { ...row, clientId: randomUUID() };
    expect(materialImportSchema.safeParse({ rows: [entry] }).success).toBe(true);
    expect(materialImportSchema.safeParse({ rows: [entry, entry] }).success).toBe(false);
    expect(
      materialImportSchema.safeParse({
        rows: [entry, { ...entry, clientId: randomUUID(), quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(materialImportSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});
