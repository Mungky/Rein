import { describe, expect, it } from 'vitest';
import type { WoDetail } from './types';
import { woEditFields, woEditPatch } from './wo-edit';

const wo = {
  title: 'Nama awal',
  type: { id: 'type' },
  assignee: { id: 'pic' },
  plannedStart: '2026-11-01',
  deadline: '2026-12-01',
  detail: 'Detail awal',
  urgent: false,
  weight: null,
  updatedAt: '2026-11-18T08:11:11Z',
  can: { editCore: true, editDetail: true, editWeight: true },
} as WoDetail;

describe('Edit WO', () => {
  const baseline = { updatedAt: wo.updatedAt, fields: woEditFields(wo), can: wo.can };
  const live = { ...wo, detail: 'Detail Engineer', updatedAt: '2026-11-18T08:12:02Z' };

  it('sends only the title and the original version after a realtime detail update', () => {
    const draft = { ...baseline.fields, title: 'Nama baru' };
    expect(woEditPatch(baseline, draft)).toEqual({
      title: 'Nama baru',
      expectedUpdatedAt: wo.updatedAt,
    });
  });

  it('keeps the original version when the draft and realtime update edit the same field', () => {
    const draft = { ...baseline.fields, detail: 'Detail Manager' };
    expect(woEditPatch(baseline, draft)).toEqual({
      detail: draft.detail,
      expectedUpdatedAt: wo.updatedAt,
    });
    expect(woEditPatch(baseline, draft).expectedUpdatedAt).not.toBe(live.updatedAt);
  });
});
