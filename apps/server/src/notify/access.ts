import { can } from '@rein/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { permissionsForUser } from '../auth/permissions';
import type { Db } from '../db/client';
import { projectMembers, projects, users } from '../db/schema';

/** Antrean lama tidak boleh mengirim isi project setelah akses penerima dicabut. */
export async function canReceiveProjectNotification(
  db: Db,
  userId: string,
  projectId: string | null,
): Promise<boolean> {
  if (!projectId) return true;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
  });
  if (!user || !project) return false;
  const member = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  });
  return can(
    {
      id: userId,
      status: user.status,
      permissions: await permissionsForUser(db, userId, user.roleId),
    },
    'project.view',
    { project: { isMember: !!member, isManager: !!member?.isProjectManager } },
  );
}
