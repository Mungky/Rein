import {
  materialDeleteSchema,
  materialIdentity,
  materialImportSchema,
  materialLinkSchema,
  materialSelectionSchema,
  materialUpdateSchema,
} from '@rein/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import { assertCan, canDo, loadProjectAccess } from '../auth/project-access';
import type { AppEnv } from '../context';
import type { Db } from '../db/client';
import {
  projectMaterials,
  projectMembers,
  projects,
  workOrderMaterials,
  workOrders,
} from '../db/schema';
import { sha256Hex } from '../lib/crypto';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { publishToUsers } from '../notify/bus';

async function publishChange(db: Db, projectId: string) {
  const members = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  publishToUsers(
    members.map((m) => m.id),
    { type: 'project', projectId },
  );
}

const duplicate = () =>
  new HttpError(
    409,
    'MATERIAL_DUPLICATE',
    'Material yang sama sudah ada. Ubah item yang ada untuk memperbarui jumlah atau status.',
  );

async function changeDeleted(
  c: Context<AppEnv>,
  projectId: string,
  items: Array<{ id: string; expectedUpdatedAt: string }>,
  deleting: boolean,
) {
  const a = authOf(c);
  const { db } = c.var.deps;
  const acc = await loadProjectAccess(db, a, projectId);
  assertCan(a, 'wo.create', acc.res);
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    const rows = await tx
      .select()
      .from(projectMaterials)
      .where(
        and(
          eq(projectMaterials.projectId, projectId),
          inArray(
            projectMaterials.id,
            items.map((item) => item.id),
          ),
        ),
      )
      .for('update');
    const byId = new Map(rows.map((row) => [row.id, row]));
    const identities = new Set<string>();
    if (!deleting) {
      const active = await tx
        .select()
        .from(projectMaterials)
        .where(and(eq(projectMaterials.projectId, projectId), isNull(projectMaterials.deletedAt)));
      for (const row of active) identities.add(materialIdentity(row));
    }
    for (const item of items) {
      const row = byId.get(item.id);
      if (!row || Boolean(row.deletedAt) === deleting)
        throw notFound(deleting ? 'Material tidak ditemukan' : 'Material terhapus tidak ditemukan');
      if (row.updatedAt.getTime() !== new Date(item.expectedUpdatedAt).getTime())
        throw new HttpError(409, 'STALE', 'Material sudah berubah. Muat ulang lalu coba lagi.');
      if (!deleting) {
        const identity = materialIdentity(row);
        if (identities.has(identity)) throw duplicate();
        identities.add(identity);
      }
    }
    const updated = await tx
      .update(projectMaterials)
      .set({ deletedAt: deleting ? new Date() : null })
      .where(
        and(
          eq(projectMaterials.projectId, projectId),
          inArray(
            projectMaterials.id,
            items.map((item) => item.id),
          ),
        ),
      )
      .returning({ id: projectMaterials.id, updatedAt: projectMaterials.updatedAt });
    for (const { id } of items)
      await audit(tx, {
        actorId: a.user.id,
        action: deleting ? 'material.deleted' : 'material.restored',
        entityType: 'project',
        entityId: projectId,
        diff: deleting ? { materialId: id, before: byId.get(id) } : { materialId: id },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    return updated;
  });
  await publishChange(db, projectId);
  return result;
}

export const materialRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .get('/:id/materials', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const rows = await db
      .select()
      .from(projectMaterials)
      .where(
        and(eq(projectMaterials.projectId, acc.project.id), isNull(projectMaterials.deletedAt)),
      )
      .orderBy(asc(projectMaterials.createdAt), asc(projectMaterials.id));
    const links = await db
      .select({
        materialId: workOrderMaterials.materialId,
        woId: workOrders.id,
        numberLabel: workOrders.numberLabel,
        title: workOrders.title,
      })
      .from(workOrderMaterials)
      .innerJoin(workOrders, eq(workOrders.id, workOrderMaterials.woId))
      .where(and(eq(workOrders.projectId, acc.project.id), isNull(workOrders.deletedAt)));
    return c.json({
      materials: rows.map((r) => ({
        ...r,
        receivedAt: r.status === 'po' ? r.receivedAt : null,
        woLinks: links.filter((l) => l.materialId === r.id),
      })),
      canManage: canDo(a, 'wo.create', acc.res),
    });
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
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, acc.project.id))
        .for('update');
      const saved = await tx
        .select()
        .from(projectMaterials)
        .where(
          inArray(
            projectMaterials.id,
            rows.map((r) => r.id),
          ),
        );
      const savedById = new Map(saved.map((r) => [r.id, r]));
      for (const row of rows) {
        const existing = savedById.get(row.id);
        if (
          existing &&
          (existing.projectId !== row.projectId ||
            existing.createdBy !== a.user.id ||
            existing.creationHash !== row.creationHash)
        )
          throw new HttpError(409, 'CLIENT_ID_REUSED', 'ID material sudah dipakai untuk data lain');
      }
      const active = await tx
        .select()
        .from(projectMaterials)
        .where(
          and(eq(projectMaterials.projectId, acc.project.id), isNull(projectMaterials.deletedAt)),
        );
      const identities = new Set(active.map(materialIdentity));
      const pending = [];
      let skipped = 0;
      for (const row of rows) {
        if (savedById.has(row.id)) continue;
        const identity = materialIdentity(row);
        if (identities.has(identity)) {
          skipped++;
          continue;
        }
        identities.add(identity);
        pending.push({ ...row, receivedAt: row.status === 'po' ? row.receivedAt : null });
      }
      const added = pending.length
        ? await tx
            .insert(projectMaterials)
            .values(pending)
            .onConflictDoNothing()
            .returning({ id: projectMaterials.id })
        : [];
      if (added.length !== pending.length)
        throw new HttpError(409, 'CLIENT_ID_REUSED', 'ID material sudah dipakai untuk data lain');
      if (added.length)
        await audit(tx, {
          actorId: a.user.id,
          action: 'material.created',
          entityType: 'project',
          entityId: acc.project.id,
          diff: { materialIds: added.map((r) => r.id), source: body.source },
          ip: c.var.ip,
          userAgent: userAgent(c),
        });
      return { inserted: added.length, skipped };
    });
    if (result.inserted) await publishChange(db, acc.project.id);
    return c.json(result, result.inserted ? 201 : 200);
  })
  .patch('/:id/materials/:materialId', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'wo.create', acc.res, 'Anda tidak punya izin mengelola material project');
    const { expectedUpdatedAt, ...values } = await readJson(c, materialUpdateSchema);
    if (values.status !== 'po') values.receivedAt = null;
    const materialId = c.req.param('materialId');
    if (!/^[0-9a-f-]{36}$/i.test(materialId)) throw notFound('Material tidak ditemukan');
    const row = await db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, acc.project.id))
        .for('update');
      const [before] = await tx
        .select()
        .from(projectMaterials)
        .where(
          and(
            eq(projectMaterials.id, materialId),
            eq(projectMaterials.projectId, acc.project.id),
            isNull(projectMaterials.deletedAt),
          ),
        )
        .for('update');
      if (!before) throw notFound('Material tidak ditemukan');
      if (before.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime())
        throw new HttpError(
          409,
          'STALE',
          'Material sudah diubah orang lain. Muat ulang lalu coba lagi.',
        );
      if (materialIdentity(before) !== materialIdentity(values)) {
        const others = await tx
          .select()
          .from(projectMaterials)
          .where(
            and(eq(projectMaterials.projectId, acc.project.id), isNull(projectMaterials.deletedAt)),
          );
        if (
          others.some(
            (r) => r.id !== materialId && materialIdentity(r) === materialIdentity(values),
          )
        )
          throw duplicate();
      }
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
    await publishChange(db, acc.project.id);
    return c.json(row);
  })
  .on(['DELETE', 'POST'], '/:id/materials/selection', async (c) => {
    const { rows } = await readJson(c, materialSelectionSchema);
    return c.json({
      rows: await changeDeleted(c, c.req.param('id'), rows, c.req.method === 'DELETE'),
    });
  })
  .delete('/:id/materials/:materialId', async (c) => {
    const id = c.req.param('materialId').toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Material tidak ditemukan');
    const version = await readJson(c, materialDeleteSchema);
    const [deleted] = await changeDeleted(c, c.req.param('id'), [{ id, ...version }], true);
    return c.json(deleted!);
  })
  .post('/:id/materials/:materialId/restore', async (c) => {
    const id = c.req.param('materialId').toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Material tidak ditemukan');
    const version = await readJson(c, materialDeleteSchema);
    await changeDeleted(c, c.req.param('id'), [{ id, ...version }], false);
    return c.json({ restored: true });
  })
  .on(['POST', 'DELETE'], '/:id/materials/:materialId/work-orders', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'wo.create', acc.res);
    const { woId } = await readJson(c, materialLinkSchema);
    const materialId = c.req.param('materialId');
    if (!/^[0-9a-f-]{36}$/i.test(materialId)) throw notFound('Material tidak ditemukan');
    const linking = c.req.method === 'POST';
    await db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, acc.project.id))
        .for('update');
      const material = await tx.query.projectMaterials.findFirst({
        where: and(
          eq(projectMaterials.id, materialId),
          eq(projectMaterials.projectId, acc.project.id),
          isNull(projectMaterials.deletedAt),
        ),
      });
      const wo = await tx.query.workOrders.findFirst({
        where: and(
          eq(workOrders.id, woId),
          eq(workOrders.projectId, acc.project.id),
          isNull(workOrders.deletedAt),
        ),
      });
      if (!material || !wo) throw notFound('Material atau WO tidak ditemukan di project ini');
      const changed = linking
        ? await tx
            .insert(workOrderMaterials)
            .values({ woId, materialId })
            .onConflictDoNothing()
            .returning()
        : await tx
            .delete(workOrderMaterials)
            .where(
              and(eq(workOrderMaterials.woId, woId), eq(workOrderMaterials.materialId, materialId)),
            )
            .returning();
      if (changed.length)
        await audit(tx, {
          actorId: a.user.id,
          action: linking ? 'material.linked' : 'material.unlinked',
          entityType: 'project',
          entityId: acc.project.id,
          diff: { materialId, woId },
          ip: c.var.ip,
          userAgent: userAgent(c),
        });
    });
    await publishChange(db, acc.project.id);
    return c.json({ linked: linking });
  });
