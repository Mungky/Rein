import { PERMISSIONS, rolePermissionsSchema, type PermissionKey } from '@rein/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requirePermission, requireVerified } from '../auth/middleware';
import { permissionsForRole, permissionsForUser } from '../auth/permissions';
import type { AppEnv } from '../context';
import { roles, userPermissions, users } from '../db/schema';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';

export const userAccessRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .get('/users/:id/access', requirePermission('admin.roles'), async (c) => {
    const { db } = c.var.deps;
    const user = await db.query.users.findFirst({ where: eq(users.id, c.req.param('id')) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const role = await db.query.roles.findFirst({ where: eq(roles.id, user.roleId) });
    const rows = await db.select().from(userPermissions).where(eq(userPermissions.userId, user.id));
    return c.json({
      roleName: role!.name,
      systemKey: role!.systemKey,
      inherited: await permissionsForRole(db, user.roleId),
      overrides: Object.fromEntries(rows.map((r) => [r.permissionKey, r.scope])),
      catalog: Object.entries(PERMISSIONS).map(([key, p]) => ({ key, ...p })),
    });
  })
  .put('/users/:id/access', requirePermission('admin.roles'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const user = await db.query.users.findFirst({ where: eq(users.id, c.req.param('id')) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const role = await db.query.roles.findFirst({ where: eq(roles.id, user.roleId) });
    const { permissions } = await readJson(c, rolePermissionsSchema);
    const next = new Map<PermissionKey, (typeof permissions)[number]['scope']>();
    for (const p of permissions) {
      const key = p.permission as PermissionKey;
      if (p.scope !== 'none' && !(PERMISSIONS[key].scopes as readonly string[]).includes(p.scope))
        throw new HttpError(422, 'VALIDATION', 'Cakupan izin tidak valid');
      next.set(key, p.scope);
    }
    const effective = {
      ...(await permissionsForRole(db, user.roleId)),
      ...Object.fromEntries(next),
    };
    for (const key of ['admin.roles', 'admin.users'] as const) {
      if (
        (role!.systemKey === 'admin' || (user.id === a.user.id && a.permissions[key] === 'all')) &&
        effective[key] !== 'all'
      ) {
        throw new HttpError(409, 'ADMIN_LOCKED', 'Akses administrasi akun ini harus tetap aktif');
      }
    }
    const before = await permissionsForUser(db, user.id, user.roleId);
    await db.transaction(async (tx) => {
      await tx.delete(userPermissions).where(eq(userPermissions.userId, user.id));
      if (next.size)
        await tx
          .insert(userPermissions)
          .values(
            [...next].map(([permissionKey, scope]) => ({ userId: user.id, permissionKey, scope })),
          );
      await audit(tx, {
        actorId: a.user.id,
        action: 'user.permissions_changed',
        entityType: 'user',
        entityId: user.id,
        diff: { before, after: effective, overrides: Object.fromEntries(next) },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ ok: true });
  });
