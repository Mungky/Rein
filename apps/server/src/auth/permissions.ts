import { can, isPermissionKey, type PermissionMap } from '@rein/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { rolePermissions, userPermissions } from '../db/schema';
import type { AuthContext, AuthUser } from '../context';
import { forbidden } from '../lib/http';

/** Perubahan izin berlaku pada request berikutnya, cache ≤ 60 detik (FR-092). */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; perms: PermissionMap }>();

export async function permissionsForRole(db: Db, roleId: string): Promise<PermissionMap> {
  const hit = cache.get(roleId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.perms;
  const rows = await db
    .select({ key: rolePermissions.permissionKey, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const perms: PermissionMap = {};
  for (const r of rows) if (isPermissionKey(r.key) && r.scope !== 'none') perms[r.key] = r.scope;
  cache.set(roleId, { at: Date.now(), perms });
  return perms;
}

export function invalidatePermissionCache(roleId?: string): void {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

/** Override termasuk none; perubahan izin akun berlaku pada request berikutnya. */
export async function permissionsForUser(
  db: Db,
  userId: string,
  roleId: string,
): Promise<PermissionMap> {
  const permissions = { ...(await permissionsForRole(db, roleId)) };
  const rows = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId));
  for (const row of rows)
    if (isPermissionKey(row.permissionKey)) permissions[row.permissionKey] = row.scope;
  return permissions;
}

export function managesRoles(actor: AuthContext): boolean {
  return can(
    { id: actor.user.id, status: actor.user.status, permissions: actor.permissions },
    'admin.roles',
  );
}

/** admin.users tidak boleh dipakai mengambil alih akun dengan kewenangan admin.roles. */
export async function assertManageableUser(
  db: Db,
  actor: AuthContext,
  user: Pick<AuthUser, 'id' | 'roleId'>,
): Promise<void> {
  if (
    !managesRoles(actor) &&
    (await permissionsForUser(db, user.id, user.roleId))['admin.roles'] === 'all'
  ) {
    throw forbidden('Mengelola akun administrator memerlukan izin Role & izin.');
  }
}

export async function assertAssignableRole(
  db: Db,
  actor: AuthContext,
  roleId: string,
): Promise<void> {
  if (!managesRoles(actor) && (await permissionsForRole(db, roleId))['admin.roles'] === 'all') {
    throw forbidden('Memberikan role administrator memerlukan izin Role & izin.');
  }
}
