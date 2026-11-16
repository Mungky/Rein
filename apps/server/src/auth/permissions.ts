import { isPermissionKey, type PermissionMap } from '@rein/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { rolePermissions, userPermissions } from '../db/schema';

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
