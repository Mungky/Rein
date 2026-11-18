import { materialImportSchema, materialUpdateSchema } from '@rein/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import { assertCan, canDo, loadProjectAccess } from '../auth/project-access';
import type { AppEnv } from '../context';
import { projectMaterials, projectMembers, projects } from '../db/schema';
import { sha256Hex } from '../lib/crypto';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { publishToUsers } from '../notify/bus';

export const materialRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .get('/:id/materials', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const rows = await db
      .select()
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, acc.project.id))
      .orderBy(asc(projectMaterials.createdAt), asc(projectMaterials.id));
    return c.json({ materials: rows, canManage: canDo(a, 'wo.create', acc.res) });
  })
  .post('/:id/materials', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'wo.create', acc.res, 'Anda tidak punya izin mengelola material project');
    const body = await readJson(c, materialImportSchema);
    const rows = body.rows.map(({ clientId, ...v }) => ({
      ...v,
      id: clientId,
      projectId: acc.project.id,
      createdBy: a.user.id,
      creationHash: sha256Hex(JSON.stringify(v)),
    }));
    const inserted = await db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, acc.project.id))
        .for('update');
      const added = await tx
        .insert(projectMaterials)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: projectMaterials.id });
      const saved = await tx
        .select()
        .from(projectMaterials)
        .where(
          inArray(
            projectMaterials.id,
            rows.map((r) => r.id),
          ),
        );
      for (const row of rows) {
        const existing = saved.find((r) => r.id === row.id);
        if (
          !existing ||
          existing.projectId !== row.projectId ||
          existing.createdBy !== a.user.id ||
          existing.creationHash !== row.creationHash
        )
          throw new HttpError(409, 'CLIENT_ID_REUSED', 'ID material sudah dipakai untuk data lain');
      }
      if (added.length)
        await audit(tx, {
          actorId: a.user.id,
          action: 'material.created',
          entityType: 'project',
          entityId: acc.project.id,
          diff: { materialIds: added.map((r) => r.id) },
          ip: c.var.ip,
          userAgent: userAgent(c),
        });
      return added.length;
    });
    const members = await db
      .select({ id: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, acc.project.id));
    publishToUsers(
      members.map((m) => m.id),
      { type: 'project', projectId: acc.project.id },
    );
    return c.json({ inserted }, inserted ? 201 : 200);
  })
  .patch('/:id/materials/:materialId', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'wo.create', acc.res, 'Anda tidak punya izin mengelola material project');
    const { expectedUpdatedAt, ...values } = await readJson(c, materialUpdateSchema);
    const materialId = c.req.param('materialId');
    if (!/^[0-9a-f-]{36}$/i.test(materialId)) throw notFound('Material tidak ditemukan');
    const row = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projectMaterials)
        .where(
          and(eq(projectMaterials.id, materialId), eq(projectMaterials.projectId, acc.project.id)),
        )
        .for('update');
      if (!before) throw notFound('Material tidak ditemukan');
      if (before.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime())
        throw new HttpError(
          409,
          'STALE',
          'Material sudah diubah orang lain. Muat ulang lalu coba lagi.',
        );
      const [updated] = await tx
        .update(projectMaterials)
        .set(values)
        .where(eq(projectMaterials.id, materialId))
        .returning();
      await audit(tx, {
        actorId: a.user.id,
        action: 'material.updated',
        entityType: 'project',
        entityId: acc.project.id,
        diff: { materialId, before, after: values },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return updated;
    });
    const members = await db
      .select({ id: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, acc.project.id));
    publishToUsers(
      members.map((m) => m.id),
      { type: 'project', projectId: acc.project.id },
    );
    return c.json(row);
  });
