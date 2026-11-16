import { describe, expect, it } from 'vitest';
import type { WoStatus } from './enums';
import { checkProjectTransition, checkWoTransition, woTargets, type WoActor } from './workflow';

const PIC: WoActor = { isAssignee: true, isCreator: false, canEditAny: false };
const CREATOR: WoActor = { isAssignee: false, isCreator: true, canEditAny: false };
const MANAGER: WoActor = { isAssignee: false, isCreator: false, canEditAny: true };
const OTHER: WoActor = { isAssignee: false, isCreator: false, canEditAny: false };
const LOG = { hasLogbook: true };

describe('state machine WO (PRD §4.5)', () => {
  it.each<[WoStatus, WoStatus, WoActor, boolean]>([
    ['todo', 'in_progress', PIC, true],
    ['backlog', 'in_progress', MANAGER, true],
    ['todo', 'in_progress', OTHER, false],
    ['todo', 'in_progress', CREATOR, false],
    ['in_progress', 'review', PIC, true],
    ['review', 'done', CREATOR, true],
    ['review', 'done', MANAGER, true],
    ['review', 'done', PIC, false],
    ['review', 'in_progress', CREATOR, true],
    ['in_progress', 'canceled', MANAGER, true],
    ['in_progress', 'canceled', PIC, false],
    ['done', 'canceled', MANAGER, false],
    ['done', 'in_progress', MANAGER, true],
    ['done', 'in_progress', PIC, false],
    ['todo', 'done', MANAGER, false],
    ['canceled', 'todo', MANAGER, false],
  ])('%s → %s', (from, to, actor, ok) => {
    expect(checkWoTransition(from, to, actor, LOG).ok).toBe(ok);
  });

  it('alasan wajib: kembalikan dari review, batalkan, buka kembali', () => {
    expect(checkWoTransition('review', 'in_progress', CREATOR, LOG)).toEqual({
      ok: true,
      reasonRequired: true,
    });
    expect(checkWoTransition('todo', 'canceled', MANAGER, LOG)).toMatchObject({
      reasonRequired: true,
    });
    expect(checkWoTransition('todo', 'in_progress', PIC, LOG)).toMatchObject({
      reasonRequired: false,
    });
  });

  it('ke Review butuh minimal 1 logbook (keputusan D6)', () => {
    expect(checkWoTransition('in_progress', 'review', PIC, { hasLogbook: false })).toMatchObject({
      ok: false,
      code: 'LOGBOOK_REQUIRED',
    });
  });

  it('woTargets dipakai UI: PIC di Dikerjakan hanya bisa ke Belum Mulai / Review', () => {
    expect(woTargets('in_progress', PIC, LOG)).toEqual(['todo', 'review']);
    expect(woTargets('in_progress', MANAGER, LOG)).toEqual(['todo', 'review', 'canceled']);
    expect(woTargets('done', OTHER, LOG)).toEqual([]);
  });
});

describe('state machine project (PRD §4.4)', () => {
  const mgr = { canEdit: true, canClose: true, canCloseAll: false };
  it('Berjalan → Ditunda butuh alasan', () => {
    expect(checkProjectTransition('active', 'on_hold', mgr)).toEqual({
      ok: true,
      reasonRequired: true,
    });
  });
  it('buka kembali Selesai hanya dengan project.close scope all', () => {
    expect(checkProjectTransition('done', 'active', mgr).ok).toBe(false);
    expect(checkProjectTransition('done', 'active', { ...mgr, canCloseAll: true }).ok).toBe(true);
  });
  it('Ditunda → Selesai tidak sah', () => {
    expect(checkProjectTransition('on_hold', 'done', mgr).ok).toBe(false);
  });
});
