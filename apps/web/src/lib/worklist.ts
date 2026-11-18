import { WO_CATEGORY_META, WO_STATUS_LABEL, type WoStatus } from '@rein/shared';
import type { WoRow } from './types';

export type WorklistGroup = 'status' | 'category' | 'type' | 'pic' | 'none';
export type WorklistSort = 'deadline' | 'number' | 'updated';

const STATUS_ORDER: WoStatus[] = ['in_progress', 'review', 'todo', 'backlog', 'done', 'canceled'];

export function groupWorklist(rows: WoRow[], group: WorklistGroup) {
  if (group === 'none') return [{ id: 'all', label: '', status: null, items: rows }];
  if (group === 'status')
    return STATUS_ORDER.map((status) => ({
      id: status,
      label: WO_STATUS_LABEL[status],
      status,
      items: rows.filter((row) => row.status === status),
    })).filter((item) => item.items.length);
  const groups = new Map<string, { id: string; label: string; status: null; items: WoRow[] }>();
  for (const row of rows) {
    const { id, label } =
      group === 'category'
        ? { id: row.type.category, label: WO_CATEGORY_META[row.type.category].label }
        : group === 'type'
          ? { id: row.type.id, label: row.type.name }
          : { id: row.assignee.id, label: row.assignee.fullName };
    const found = groups.get(id);
    if (found) found.items.push(row);
    else groups.set(id, { id, label, status: null, items: [row] });
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

export function sortWorklist(rows: WoRow[], sort: WorklistSort) {
  return [...rows].sort((a, b) => {
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt) || a.seq - b.seq;
    if (sort === 'deadline') return a.deadline.localeCompare(b.deadline) || a.seq - b.seq;
    return a.seq - b.seq;
  });
}
