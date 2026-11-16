import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_ROLES, seedOrganizationRoles } from '../src/db/organization-roles';
import { auditLogs, rolePermissions, roles } from '../src/db/schema';
import { agent, closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

describe.runIf(hasDb)('role organisasi & pengaturan akses', () => {
  afterAll(closeTestDb);

  it('menambah 13 role dengan izin sesuai pembagian, idempoten dan menjaga izin yang diubah', async () => {
    const db = testDb();
    expect(await seedOrganizationRoles(db)).toBe(13);
    expect(await seedOrganizationRoles(db)).toBe(0);
    const managers = ['Direktur', 'Engineering Manager', 'Warehouse Manager', 'Production Manager'];
    for (const preset of ORGANIZATION_ROLES) {
      const role = await db.query.roles.findFirst({ where: eq(roles.name, preset.name) });
      expect(role).toBeDefined();
      const perms = await db
        .select()
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role!.id));
      const map = Object.fromEntries(perms.map((p) => [p.permissionKey, p.scope]));
      expect(map['project.create']).toBe(managers.includes(preset.name) ? 'all' : undefined);
      expect(map['project.view']).toBe(managers.includes(preset.name) ? 'all' : 'member');
      expect(map['admin.users']).toBeUndefined();
      expect(map['admin.roles']).toBeUndefined();
      expect(
        await db.query.auditLogs.findFirst({
          where: and(eq(auditLogs.entityId, role!.id), eq(auditLogs.action, 'role.created')),
        }),
      ).toBeDefined();
    }
    const director = await db.query.roles.findFirst({ where: eq(roles.name, 'Direktur') });
    await db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, director!.id),
          eq(rolePermissions.permissionKey, 'project.create'),
        ),
      );
    expect(await seedOrganizationRoles(db)).toBe(0);
    expect(
      await db.query.rolePermissions.findFirst({
        where: and(
          eq(rolePermissions.roleId, director!.id),
          eq(rolePermissions.permissionKey, 'project.create'),
        ),
      }),
    ).toBeUndefined();
  });

  it('menolak tanpa izin, mengganti role dan menerapkan izin pada sesi yang sudah ada', async () => {
    const { app } = makeApp();
    const admin = await createUser({ role: 'admin' });
    const worker = await createUser();
    const { a } = await login(app, admin.username, admin.password!);
    const { a: w } = await login(app, worker.username, worker.password!);
    const project = {
      clientName: 'Klien uji akses',
      rpoNumber: `RPO-${randomUUID()}`,
      name: 'Uji akses project',
      startDate: '2026-11-16',
      endDate: '2026-12-16',
    };
    expect((await w.get('/api/admin/roles/detail')).status).toBe(403);
    expect((await w.post('/api/projects', project)).status).toBe(403);
    const created = await a.post('/api/admin/roles', { name: `Role uji ${randomUUID()}` });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const put = (roleId: string, permissions: unknown[]) =>
      app.request(`/api/admin/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: {
          cookie: [...a.jar].map(([k, v]) => `${k}=${v}`).join('; '),
          'content-type': 'application/json',
          'x-requested-with': 'rein',
        },
        body: JSON.stringify({ permissions }),
      });
    expect((await put(id, [{ permission: 'project.create', scope: 'member' }])).status).toBe(422);
    expect(
      (
        await put(id, [
          { permission: 'project.create', scope: 'all' },
          { permission: 'project.view', scope: 'all' },
        ])
      ).status,
    ).toBe(200);
    expect((await w.post(`/api/admin/users/${admin.id}/role`, { roleId: id })).status).toBe(403);
    expect((await a.post(`/api/admin/users/${admin.id}/role`, { roleId: id })).status).toBe(409);
    expect(
      (await a.post(`/api/admin/users/${worker.id}/role`, { roleId: randomUUID() })).status,
    ).toBe(422);
    expect((await a.post(`/api/admin/users/${worker.id}/role`, { roleId: id })).status).toBe(200);
    const me = await (await w.get('/api/auth/me')).json();
    expect(me.permissions['project.create']).toBe('all');
    expect((await w.post('/api/projects', project)).status).toBe(201);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, worker.id), eq(auditLogs.action, 'user.role_changed')),
      }),
    ).toBeDefined();
    const list = await (await a.get('/api/admin/roles/detail')).json();
    const adminRole = list.roles.find((r: { systemKey: string }) => r.systemKey === 'admin');
    expect((await put(adminRole.id, [])).status).toBe(409);
    expect((await agent(app).get('/api/admin/roles/detail')).status).toBe(401);
  });
});
