import { expect, it } from 'vitest';
import type { WoRow } from './types';
import { groupWorklist, sortWorklist } from './worklist';

const rows = [
  {
    id: 'first',
    seq: 1,
    status: 'done',
    deadline: '2026-11-20',
    updatedAt: '2026-11-18T04:00:00Z',
    type: { id: 'design', category: 'engineering', name: 'Gambar Detail' },
    assignee: { id: 'ani', fullName: 'Ani' },
  },
  {
    id: 'second',
    seq: 2,
    status: 'in_progress',
    deadline: '2026-11-18',
    updatedAt: '2026-11-17T04:00:00Z',
    type: { id: 'design', category: 'engineering', name: 'Gambar Detail' },
    assignee: { id: 'budi', fullName: 'Budi' },
  },
] as WoRow[];

it('menyortir tenggat, nomor WO, dan perubahan terbaru', () => {
  expect(sortWorklist(rows, 'deadline').map((row) => row.id)).toEqual(['second', 'first']);
  expect(sortWorklist(rows, 'number').map((row) => row.id)).toEqual(['first', 'second']);
  expect(sortWorklist(rows, 'updated').map((row) => row.id)).toEqual(['first', 'second']);
});

it('mengelompokkan WO berdasarkan pilihan dan menjaga urutan dalam grup', () => {
  const sorted = sortWorklist(rows, 'deadline');
  expect(groupWorklist(sorted, 'category')[0]).toMatchObject({
    label: 'Engineering',
    items: sorted,
  });
  expect(groupWorklist(sorted, 'type')[0]).toMatchObject({ label: 'Gambar Detail', items: sorted });
  expect(groupWorklist(sorted, 'pic').map((group) => group.label)).toEqual(['Ani', 'Budi']);
  expect(groupWorklist(sorted, 'status').map((group) => group.id)).toEqual(['in_progress', 'done']);
  expect(groupWorklist(sorted, 'none')).toEqual([
    { id: 'all', label: '', status: null, items: sorted },
  ]);
});
