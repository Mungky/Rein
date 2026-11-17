/**
 * State machine status WO (PRD §4.5) dan status project (PRD §4.4).
 * Satu sumber aturan untuk UI (tombol/kolom Kanban yang ditawarkan) dan server (validasi) —
 * pelajaran REIN v1: UI tidak boleh menawarkan transisi yang nanti ditolak server.
 */
import type { ProjectStatus, WoStatus } from './enums';

/** Hubungan aktor dengan WO; diisi server dari can() + data WO. */
export interface WoActor {
  /** Aktor adalah PIC dan punya `wo.edit.own`. */
  isAssignee: boolean;
  /** Aktor adalah pembuat WO. */
  isCreator: boolean;
  /** Aktor punya `wo.edit.any` pada project ini. */
  canEditAny: boolean;
}

export interface WoContext {
  /** Sudah ada minimal 1 entri logbook non-system (syarat ke Review, keputusan D6). */
  hasLogbook: boolean;
}

type Who = 'assignee' | 'creator' | 'any';

interface Rule {
  from: readonly WoStatus[];
  to: WoStatus;
  who: readonly Who[];
  reason?: boolean;
  needsLogbook?: boolean;
}

const ACTIVE: readonly WoStatus[] = ['backlog', 'todo', 'in_progress', 'review'];

const RULES: readonly Rule[] = [
  { from: ['todo'], to: 'backlog', who: ['assignee', 'creator', 'any'] },
  { from: ['backlog'], to: 'todo', who: ['assignee', 'creator', 'any'] },
  { from: ['backlog', 'todo'], to: 'in_progress', who: ['assignee', 'any'] },
  { from: ['in_progress'], to: 'todo', who: ['assignee', 'any'] },
  { from: ['in_progress'], to: 'review', who: ['assignee', 'any'], needsLogbook: true },
  { from: ['review'], to: 'done', who: ['creator', 'any'] },
  { from: ['review'], to: 'in_progress', who: ['creator', 'any'], reason: true },
  { from: ACTIVE, to: 'canceled', who: ['any'], reason: true },
  { from: ['done'], to: 'in_progress', who: ['any'], reason: true },
];

function allowed(rule: Rule, a: WoActor): boolean {
  return rule.who.some(
    (w) =>
      (w === 'assignee' && a.isAssignee) ||
      (w === 'creator' && a.isCreator) ||
      (w === 'any' && a.canEditAny),
  );
}

export type TransitionCheck =
  | { ok: true; reasonRequired: boolean }
  | {
      ok: false;
      code: 'INVALID_TRANSITION' | 'FORBIDDEN' | 'LOGBOOK_REQUIRED';
      message: string;
    };

/** Validasi satu transisi. Dipakai server sebelum menyimpan perubahan status. */
export function checkWoTransition(
  from: WoStatus,
  to: WoStatus,
  actor: WoActor,
  ctx: WoContext,
): TransitionCheck {
  const rules = RULES.filter((r) => r.to === to && r.from.includes(from));
  if (!rules.length) {
    return { ok: false, code: 'INVALID_TRANSITION', message: 'Perubahan status ini tidak sah' };
  }
  const rule = rules.find((r) => allowed(r, actor));
  if (!rule) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Perubahan status ini tidak tersedia untuk peran Anda',
    };
  }
  if (rule.needsLogbook && !ctx.hasLogbook) {
    return {
      ok: false,
      code: 'LOGBOOK_REQUIRED',
      message: 'Tulis minimal satu logbook hasil pekerjaan sebelum mengirim ke Review',
    };
  }
  return { ok: true, reasonRequired: Boolean(rule.reason) };
}

/** Status tujuan yang sah dari `from` untuk aktor ini (urut sesuai alur). */
export function woTargets(from: WoStatus, actor: WoActor, ctx: WoContext): WoStatus[] {
  const order: WoStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'canceled'];
  return order.filter((to) => to !== from && checkWoTransition(from, to, actor, ctx).ok);
}

export function woReasonRequired(from: WoStatus, to: WoStatus): boolean {
  return RULES.some((r) => r.to === to && r.from.includes(from) && r.reason);
}

/** Project (PRD §4.4): Berjalan ⇄ Ditunda, Berjalan → Selesai, Selesai → Berjalan. */
export interface ProjectActor {
  canEdit: boolean;
  canClose: boolean;
  /** `project.close` dengan scope `all` (syarat buka kembali). */
  canCloseAll: boolean;
}

export type ProjectTransitionCheck =
  { ok: true; reasonRequired: boolean } | { ok: false; message: string };

export function checkProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  actor: ProjectActor,
): ProjectTransitionCheck {
  const deny: ProjectTransitionCheck = {
    ok: false,
    message: 'Anda tidak punya izin mengubah status project ini',
  };
  if (from === to) return { ok: false, message: 'Status tidak berubah' };
  if (from === 'active' && to === 'on_hold') {
    return actor.canEdit ? { ok: true, reasonRequired: true } : deny;
  }
  if (from === 'on_hold' && to === 'active') {
    return actor.canEdit ? { ok: true, reasonRequired: false } : deny;
  }
  if ((from === 'active' || from === 'on_hold') && to === 'done') {
    return actor.canClose ? { ok: true, reasonRequired: false } : deny;
  }
  if (from === 'done' && to === 'active') {
    return actor.canCloseAll ? { ok: true, reasonRequired: true } : deny;
  }
  return { ok: false, message: 'Perubahan status project ini tidak sah' };
}
