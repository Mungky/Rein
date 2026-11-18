import type { WoDetail } from './types';

export function woEditFields(wo: WoDetail) {
  return {
    title: wo.title,
    typeId: wo.type.id,
    assigneeId: wo.assignee.id,
    plannedStart: wo.plannedStart,
    deadline: wo.deadline,
    urgent: wo.urgent,
    weight: wo.weight == null ? '' : String(wo.weight),
    detail: wo.detail,
  };
}

type Fields = ReturnType<typeof woEditFields>;

export function woEditPatch(
  baseline: { updatedAt: string; fields: Fields; can: WoDetail['can'] },
  draft: Fields,
) {
  const { fields, can } = baseline;
  const patch: Record<string, unknown> = { expectedUpdatedAt: baseline.updatedAt };
  if (can.editCore) {
    const core = { ...draft, title: draft.title.trim() };
    for (const key of [
      'title',
      'typeId',
      'assigneeId',
      'plannedStart',
      'deadline',
      'urgent',
    ] as const)
      if (core[key] !== fields[key]) patch[key] = core[key];
  }
  if (can.editDetail && draft.detail !== fields.detail) patch.detail = draft.detail;
  if (can.editWeight && draft.weight !== fields.weight)
    patch.weight = draft.weight.trim() === '' ? null : Number(draft.weight.replace(',', '.'));
  return patch;
}
