/**
 * Admin — Role & izin (FR-092), Jenis WO (FR-093), sesi WhatsApp (keputusan D5).
 * Semua dicek di server lewat requirePermission (can()).
 */
import {
  PERMISSIONS,
  roleCreateSchema,
  rolePermissionsSchema,
  roleUpdateSchema,
  woTypeOrderSchema,
  woTypeSchema,
  woTypeUpdateSchema,
  type PermissionKey,
} from '@rein/shared';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requirePermission, requireVerified } from '../auth/middleware';
import { invalidatePermissionCache } from '../auth/permissions';
import type { AppEnv, Deps } from '../context';
import { rolePermissions, roles, systemState, users, woTypes, workOrders } from '../db/schema';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { WA_SESSION_STATE_KEY } from './webhooks';

type Db = Deps['db'];

/** Izin yang tidak boleh dicabut dari role Admin bawaan (mencegah terkunci dari Admin). */
const ADMIN_LOCKED: PermissionKey[] = ['admin.roles', 'admin.users'];

const conflict = (code: string, message: string, field?: string) =>
  new HttpError(409, code, message, field ? { [field]: message } : undefined);

async function roleOr404(db: Db, id: string) {
  const role = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!role) throw notFound('Role tidak ditemukan');
  return role;
}

async function permissionMap(db: Db, roleId: string) {
  const rows = await db
    .select({ key: rolePermissions.permissionKey, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return Object.fromEntries(rows.map((r) => [r.key, r.scope]));
}

export const adminSettingsRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  // ---------------------------------------------------------------- Role & izin (FR-092)
  .get('/roles/detail', requirePermission('admin.roles'), async (c) => {
    const { db } = c.var.deps;
    const list = await db.select().from(roles).orderBy(asc(roles.name));
    const counts = await db
      .select({ roleId: users.roleId, n: count() })
      .from(users)
      .groupBy(users.roleId);
    const perms = await db.select().from(rolePermissions);
    return c.json({
      catalog: Object.entries(PERMISSIONS).map(([key, p]) => ({
        key,
        label: p.label,
        scopes: p.scopes,
      })),
      roles: list.map((r) => ({
        id: r.id,
        name: r.name,
        divisionLabel: r.divisionLabel,
        systemKey: r.systemKey,
        userCount: counts.find((x) => x.roleId === r.id)?.n ?? 0,
        permissions: Object.fromEntries(
          perms.filter((p) => p.roleId === r.id).map((p) => [p.permissionKey, p.scope]),
        ),
      })),
    });
  })

  .post('/roles', requirePermission('admin.roles'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const body = await readJson(c, roleCreateSchema);
    if (await db.query.roles.findFirst({ where: eq(roles.name, body.name) })) {
      throw conflict('ROLE_NAME_TAKEN', 'Nama role sudah dipakai', 'name');
    }
    const source = body.copyFrom ? await roleOr404(db, body.copyFrom) : null;
    const id = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(roles)
        .values({ name: body.name, divisionLabel: body.divisionLabel })
        .returning({ id: roles.id });
      if (source) {
        const rows = await tx
          .select()
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, source.id));
        if (rows.length) {
          await tx
            .insert(rolePermissions)
            .values(
              rows.map((p) => ({ roleId: r!.id, permissionKey: p.permissionKey, scope: p.scope })),
            );
        }
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'role.created',
        entityType: 'role',
        entityId: r!.id,
        diff: { name: body.name, copyFrom: source?.name ?? null },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return r!.id;
    });
    return c.json({ id }, 201);
  })

  .patch('/roles/:id', requirePermission('admin.roles'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const role = await roleOr404(db, c.req.param('id'));
    const body = await readJson(c, roleUpdateSchema);
    if (body.name && body.name !== role.name) {
      const taken = await db.query.roles.findFirst({
        where: and(eq(roles.name, body.name), ne(roles.id, role.id)),
      });
      if (taken) throw conflict('ROLE_NAME_TAKEN', 'Nama role sudah dipakai', 'name');
    }
    await db
      .update(roles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(roles.id, role.id));
    await audit(db, {
      actorId: a.user.id,
      action: 'role.updated',
      entityType: 'role',
      entityId: role.id,
      diff: { from: { name: role.name, divisionLabel: role.divisionLabel }, to: body },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  /** Hanya role tanpa user; Admin wajib tetap tersedia. */
  .delete('/roles/:id', requirePermission('admin.roles'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const role = await roleOr404(db, c.req.param('id'));
    if (role.systemKey === 'admin') throw conflict('ROLE_SYSTEM', 'Role Admin tidak bisa dihapus');
    const [used] = await db.select({ n: count() }).from(users).where(eq(users.roleId, role.id));
    if ((used?.n ?? 0) > 0) {
      throw conflict('ROLE_IN_USE', `Role masih dipakai ${used!.n} pengguna`);
    }
    await db.transaction(async (tx) => {
      if (role.systemKey)
        await tx
          .insert(systemState)
          .values({ key: `deleted_role:${role.systemKey}`, value: { name: role.name } })
          .onConflictDoNothing();
      await tx.delete(roles).where(eq(roles.id, role.id));
    });
    invalidatePermissionCache(role.id);
    await audit(db, {
      actorId: a.user.id,
      action: 'role.deleted',
      entityType: 'role',
      entityId: role.id,
      diff: { name: role.name },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  /** Ganti seluruh izin role. Scope harus salah satu yang diizinkan untuk permission itu. */
  .put('/roles/:id/permissions', requirePermission('admin.roles'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const role = await roleOr404(db, c.req.param('id'));
    const { permissions } = await readJson(c, rolePermissionsSchema);
    const next = new Map<PermissionKey, (typeof permissions)[number]['scope']>();
    for (const p of permissions) {
      const key = p.permission as PermissionKey;
      if (p.scope === 'none') continue;
      if (!(PERMISSIONS[key].scopes as readonly string[]).includes(p.scope)) {
        throw new HttpError(422, 'VALIDATION', `Scope "${p.scope}" tidak berlaku untuk ${key}`);
      }
      next.set(key, p.scope);
    }
    if (role.systemKey === 'admin') {
      for (const k of ADMIN_LOCKED) {
        if (next.get(k) !== 'all') {
          throw conflict('ADMIN_LOCKED', `Izin "${PERMISSIONS[k].label}" wajib untuk role Admin`);
        }
      }
    }
    const before = await permissionMap(db, role.id);
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (next.size) {
        await tx
          .insert(rolePermissions)
          .values(
            [...next].map(([permissionKey, scope]) => ({ roleId: role.id, permissionKey, scope })),
          );
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: role.id,
        diff: { before, after: Object.fromEntries(next) },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    invalidatePermissionCache(role.id);
    return c.json({ ok: true });
  })

  // ---------------------------------------------------------------- Jenis WO (FR-093)
  .get('/wo-types', requirePermission('admin.wo_types'), async (c) => {
    const { db } = c.var.deps;
    const list = await db.select().from(woTypes).orderBy(asc(woTypes.sortOrder), asc(woTypes.name));
    const used = await db
      .select({ typeId: workOrders.typeId, n: count() })
      .from(workOrders)
      .groupBy(workOrders.typeId);
    return c.json({
      types: list.map((t) => ({ ...t, usage: used.find((u) => u.typeId === t.id)?.n ?? 0 })),
    });
  })

  .post('/wo-types', requirePermission('admin.wo_types'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const body = await readJson(c, woTypeSchema);
    await assertTypeUnique(db, body.name, body.code);
    const [last] = await db
      .select({ max: sql<number>`coalesce(max(${woTypes.sortOrder}), 0)` })
      .from(woTypes);
    const [row] = await db
      .insert(woTypes)
      .values({ ...body, sortOrder: Number(last?.max ?? 0) + 10 })
      .returning();
    await audit(db, {
      actorId: a.user.id,
      action: 'wo_type.created',
      entityType: 'wo_type',
      entityId: row!.id,
      diff: body,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json(row, 201);
  })

  .put('/wo-types/order', requirePermission('admin.wo_types'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { ids } = await readJson(c, woTypeOrderSchema);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(woTypes)
          .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
          .where(eq(woTypes.id, id));
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'wo_type.reordered',
        entityType: 'wo_type',
        diff: { ids },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ ok: true });
  })

  .patch('/wo-types/:id', requirePermission('admin.wo_types'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const type = await db.query.woTypes.findFirst({ where: eq(woTypes.id, id) });
    if (!type) throw notFound('Jenis WO tidak ditemukan');
    const body = await readJson(c, woTypeUpdateSchema);
    await assertTypeUnique(db, body.name, body.code, id);
    await db
      .update(woTypes)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(woTypes.id, id));
    await audit(db, {
      actorId: a.user.id,
      action: 'wo_type.updated',
      entityType: 'wo_type',
      entityId: id,
      diff: {
        from: { name: type.name, code: type.code, category: type.category, active: type.active },
        to: body,
      },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  /** Jenis yang sudah dipakai WO tidak bisa dihapus — nonaktifkan saja. */
  .delete('/wo-types/:id', requirePermission('admin.wo_types'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const type = await db.query.woTypes.findFirst({ where: eq(woTypes.id, id) });
    if (!type) throw notFound('Jenis WO tidak ditemukan');
    const [used] = await db
      .select({ n: count() })
      .from(workOrders)
      .where(eq(workOrders.typeId, id));
    if ((used?.n ?? 0) > 0) {
      throw conflict('WO_TYPE_IN_USE', 'Jenis ini sudah dipakai WO. Nonaktifkan saja.');
    }
    await db.delete(woTypes).where(eq(woTypes.id, id));
    await audit(db, {
      actorId: a.user.id,
      action: 'wo_type.deleted',
      entityType: 'wo_type',
      entityId: id,
      diff: { name: type.name, code: type.code },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  // ---------------------------------------------------------------- WhatsApp (D5)
  .get('/whatsapp', requirePermission('admin.users'), async (c) => {
    const { db, env, wa } = c.var.deps;
    const last = await db.query.systemState.findFirst({
      where: eq(systemState.key, WA_SESSION_STATE_KEY),
    });
    let session: Awaited<ReturnType<typeof wa.session>> | null = null;
    let error: string | null = null;
    try {
      session = await wa.session();
    } catch (err) {
      error = String((err as Error).message ?? err).slice(0, 200);
    }
    const needsQr = session && ['qr_ready', 'created', 'initializing'].includes(session.status);
    return c.json({
      provider: wa.name,
      session,
      lastWebhook: last?.value ?? null,
      qr: needsQr ? await wa.qr() : null,
      reinNumber: env.REIN_WA_NUMBER ?? null,
      error,
    });
  })

  .post('/whatsapp/setup', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { env, wa, db } = c.var.deps;
    if (wa.name !== 'openwa') {
      throw conflict('WA_DISABLED', 'WhatsApp belum dikonfigurasi (OPENWA_URL / OPENWA_API_KEY)');
    }
    try {
      const session = await wa.ensureSetup(env.OPENWA_WEBHOOK_URL, env.OPENWA_WEBHOOK_SECRET!);
      await audit(db, {
        actorId: a.user.id,
        action: 'whatsapp.setup',
        entityType: 'system',
        diff: { status: session.status },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return c.json({ session });
    } catch (err) {
      throw new HttpError(
        502,
        'WA_UNREACHABLE',
        `OpenWA tidak bisa dihubungi: ${String((err as Error).message ?? err).slice(0, 160)}`,
      );
    }
  });

async function assertTypeUnique(db: Db, name?: string, code?: string, exceptId?: string) {
  for (const [field, value] of [
    ['name', name],
    ['code', code],
  ] as const) {
    if (!value) continue;
    const col = field === 'name' ? woTypes.name : woTypes.code;
    const hit = await db.query.woTypes.findFirst({
      where: exceptId ? and(eq(col, value), ne(woTypes.id, exceptId)) : eq(col, value),
    });
    if (hit) {
      throw conflict(
        'WO_TYPE_TAKEN',
        field === 'name' ? 'Nama jenis sudah dipakai' : 'Kode jenis sudah dipakai',
        field,
      );
    }
  }
}
