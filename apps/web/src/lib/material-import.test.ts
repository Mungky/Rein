import { describe, expect, it } from 'vitest';
import { materialPreview } from './material-import';
import platform from './fixtures/material-platform.json';

describe('Pratinjau material Excel', () => {
  it('membaca 13 item layout file Platform, memilih Part No. tabel dan satuan setelah QTY', () => {
    const result = materialPreview([
      { sheet: 'Platform', data: platform },
      { sheet: 'Sheet1', data: [[2000, 3, 6000]] },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(13);
    expect(result.sheets).toEqual(['Platform']);
    expect(result.rows[0]).toMatchObject({
      partNo: '1',
      description: 'Frame',
      material: 'AISI 304',
      specification: 'Square 50 x 50 x 6000 x t2',
      quantity: 4,
      unit: 'Btg',
      status: 'not_available',
    });
    expect(result.rows.at(-1)).toMatchObject({ partNo: '13', quantity: 6, unit: 'Pcs' });
  });
  const header = [
    'Part No.',
    'Description',
    'Material',
    'Size or Spesification',
    'QTY',
    'Satuan',
    'Status',
    'Recieved',
    'Note',
  ];
  it('mendukung header ringkas, desimal, tanggal Excel, status, note dan QTY gabungan', () => {
    const p = materialPreview([
      {
        sheet: 'List',
        data: [
          header,
          [
            '001',
            'Frame',
            'SS',
            '50x50',
            '1,25',
            'Btg',
            'Instock',
            new Date('2026-11-18T00:00:00Z'),
            'Siap',
          ],
          ['002', 'Bolt', '', '', '2 Pcs', null, 'PO', '19/11/2026', 'Menunggu'],
          ['003', 'Gasket', '', '', '2 Pcs', null, 'Need review', 'belum diisi'],
        ],
      },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({
      partNo: '001',
      quantity: 1.25,
      status: 'in_stock',
      receivedAt: null,
      note: 'Siap',
    });
    expect(p.rows[1]).toMatchObject({
      quantity: 2,
      unit: 'Pcs',
      status: 'po',
      receivedAt: '2026-11-19',
    });
    expect(p.rows[2]).toMatchObject({ status: 'need_review', receivedAt: null });
  });
  it('kolom stok dan PO pada template dikenali tanpa menganggap grup sebagai item', () => {
    const p = materialPreview([
      {
        sheet: 'List',
        data: [
          ['Part No.', 'Description', 'QTY', '', 'STOCK', 'PO'],
          ['A.'],
          ['1', 'Frame', 3, 'Btg', 3],
          ['2', 'Plate', 4, 'Lbr', null, 'PO-123'],
        ],
      },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => r.status)).toEqual(['in_stock', 'po']);
  });
  it('baris rusak dilaporkan dengan nomor baris, bukan diimpor diam-diam', () => {
    const p = materialPreview([
      {
        sheet: 'List',
        data: [
          header,
          ['1', 'Frame', '', '', 0, 'Pcs'],
          ['2', 'Plate', '', '', 2, null],
          ['3', 'Bolt', '', '', 1, 'Pcs', 'tidak dikenal'],
        ],
      },
    ]);
    expect(p.rows).toEqual([]);
    expect(p.errors).toHaveLength(3);
    expect(p.errors[0]).toContain('baris 2');
    expect(p.errors[0]).toContain('QTY “0” tidak valid');
    const invalid = materialPreview([
      { sheet: 'Lembar', data: [header, ['1', 'Baut', '', '', 'empat', 'Pcs']] },
    ]);
    expect(invalid.rows).toEqual([]);
    expect(invalid.errors[0]).toContain('Lembar, baris 2: QTY “empat” tidak valid');
    expect(materialPreview([{ sheet: 'Kosong', data: [] }]).errors[0]).toContain('Header');
    expect(materialPreview([{ sheet: 'Kosong', data: [header] }]).errors[0]).toContain(
      'Tidak ada baris',
    );
  });
  it('menolak QTY teks parsial dan satuan yang bertentangan', () => {
    const p = materialPreview([
      {
        sheet: 'List',
        data: [header, ['1', 'Bolt', '', '', '1e3', 'Pcs'], ['2', 'Plate', '', '', '2 Lbr', 'Pcs']],
      },
    ]);
    expect(p.rows).toHaveLength(0);
    expect(p.errors).toHaveLength(2);
    expect(p.errors[1]).toContain('satuan');
  });
});
