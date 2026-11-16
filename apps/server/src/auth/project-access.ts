import { can, type PermissionKey, type PolicyResource, type PolicySubject } from '@rein/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../context';
import type { Db } from '../db/client';
import { logbookEntries, projectMembers, projects, workOrders, type Project } from '../db/schema';
import { forbidden, notFound } from '../lib/http';

export function subjectOf(a: AuthContext): PolicySubject {
  return { id: a.user.id, status: a.user.status, permissions: a.permissions };
}

export function canDo(a: AuthContext, permission: PermissionKey, res?: PolicyResource): boolean {
  return can(subjectOf(a), permission, res);
}

export function assertCan(
  a: AuthContext,
  permission: PermissionKey,
  res?: PolicyResource,
  message?: string,
): void {
  if (!canDo(a, permission, res)) throw forbidden(message);
}

export interface ProjectAccess {
  project: Project;
  isMember: boolean;
  isManager: boolean;
  res: PolicyResource;
}

/**
 * Muat project + relasi user. Project yang tidak boleh dilihat dibalas 404 (bukan 403)
 * agar keberadaannya tidak bocor. Semua cek izin project memakai `res` ini (PRD §2.2).
 */
export async function loadProjectAccess(
  db: Db,
  a: AuthContext,
  projectId: string,
): Promise<ProjectAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound('Project tidak ditemukan');
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
  });
  if (!project) throw notFound('Project tidak ditemukan');
  const member = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, a.user.id)),
  });
  const res: PolicyResource = {
    project: { isMember: Boolean(member), isManager: Boolean(member?.isProjectManager) },
  };
  if (!canDo(a, 'project.view', res)) throw notFound('Project tidak ditemukan');
  return {
    project,
    isMember: Boolean(member),
    isManager: Boolean(member?.isProjectManager),
    res,
  };
}

/** Kemampuan user pada project — dikirim ke UI untuk menampilkan/menyembunyikan aksi. */
export function projectCapabilities(a: AuthContext, acc: ProjectAccess) {
  return {
    edit: canDo(a, 'project.edit', acc.res),
    manageMembers: canDo(a, 'project.members.manage', acc.res),
    close: canDo(a, 'project.close', acc.res),
    reopen: a.permissions['project.close'] === 'all',
    createWo: canDo(a, 'wo.create', acc.res),
    editAnyWo: canDo(a, 'wo.edit.any', acc.res),
    editWeight: canDo(a, 'wo.weight.edit', acc.res),
    deleteWo: canDo(a, 'wo.delete', acc.res),
    upload: canDo(a, 'attachment.upload', acc.res),
    writeLogbook: canDo(a, 'logbook.create', acc.res),
  };
}

/** Project pemilik lampiran (project / WO / entri logbook) untuk cek izin. */
export async function resolveOwner(
  db: Db,
  ownerType: 'project' | 'wo' | 'logbook',
  ownerId: string,
): Promise<{ projectId: string; authorId?: string } | null> {
  if (ownerType === 'project') {
    const p = await db.query.projects.findFirst({
      where: and(eq(projects.id, ownerId), isNull(projects.deletedAt)),
    });
    return p ? { projectId: p.id } : null;
  }
  if (ownerType === 'wo') {
    const w = await db.query.workOrders.findFirst({
      where: and(eq(workOrders.id, ownerId), isNull(workOrders.deletedAt)),
    });
    return w ? { projectId: w.projectId } : null;
  }
  const [row] = await db
    .select({ projectId: workOrders.projectId, authorId: logbookEntries.authorId })
    .from(logbookEntries)
    .innerJoin(workOrders, eq(workOrders.id, logbookEntries.woId))
    .where(and(eq(logbookEntries.id, ownerId), isNull(logbookEntries.deletedAt)))
    .limit(1);
  return row ?? null;
}
