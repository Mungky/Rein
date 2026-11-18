/**
 * Project (PRD §3.3, FR-020–FR-025): daftar, buat, detail, edit, status, anggota,
 * progres per kategori, penutupan manual. Izin selalu lewat can() + resource project.
 */
import {
  categorySummaries,
  checkProjectTransition,
  memberUpsertSchema,
  projectCreateSchema,
  projectMediaSchema,
  projectProgress,
  projectStatusSchema,
  projectUpdateSchema,
  PROJECT_STATUS_LABEL,
  type WoProgressInput,
  buildSCurve,
  WO_CATEGORIES,
  WO_STATUSES,
  todayWib,
} from '@rein/shared';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import {
  assertCan,
  canDo,
  loadProjectAccess,
  projectCapabilities,
  resolveOwner,
  type ProjectAccess,
} from '../auth/project-access';
import type { AppEnv, AuthContext, Deps } from '../context';
import {
  attachments,
  helpRequests,
  clients,
  projectMembers,
  projects,
  projectStatusHistory,
  roles,
  users,
  woTypes,
  workOrders,
  logbookEntries,
  progressEvents,
  woReferences,
} from '../db/schema';
import { HttpError, notFound, readJson, validate } from '../lib/http';
import { userAgent } from '../lib/ip';
import { claimProjectImage } from '../lib/project-media';
import { publishToUsers } from '../notify/bus';
import { enqueueNotifications, type Tx } from '../notify/outbox';

type Db = Deps['db'];
type ProgressRow = WoProgressInput & { urgent: boolean };

const conflict = (message: string, field?: string) =>
  new HttpError(409, 'CONFLICT', message, field ? { [field]: message } : undefined);

const ACTIVE = (s: string) => s !== 'done' && s !== 'canceled';

/** WO yang dihitung untuk progres (tidak dihapus). */
export async function progressInputs(db: Db, projectIds: string[]) {
  const map = new Map<string, ProgressRow[]>();
  if (!projectIds.length) return map;
  const rows = await db
    .select({
      id: workOrders.id,
      projectId: workOrders.projectId,
      status: workOrders.status,
      weight: workOrders.weight,
      progress: workOrders.progress,
      category: woTypes.category,
      urgent: workOrders.urgent,
    })
    .from(workOrders)
    .innerJoin(woTypes, eq(woTypes.id, workOrders.typeId))
    .where(and(inArray(workOrders.projectId, projectIds), isNull(workOrders.deletedAt)));
  for (const r of rows) {
    const list = map.get(r.projectId) ?? [];
    list.push({ ...r, weight: r.weight ?? null });
    map.set(r.projectId, list);
  }
  return map;
}

async function upsertClient(tx: Tx, name: string): Promise<string> {
  const [row] = await tx
    .insert(clients)
    .values({ name })
    .onConflictDoUpdate({ target: clients.name, set: { updatedAt: new Date() } })
    .returning({ id: clients.id });
  return row!.id;
}

async function assertRpoFree(db: Db, rpo: string, exceptId?: string) {
  const other = await db.query.projects.findFirst({
    where: and(eq(projects.rpoNumber, rpo), exceptId ? ne(projects.id, exceptId) : undefined),
  });
  if (other) throw conflict(`No RPO sudah dipakai project ${other.name}`, 'rpoNumber');
}

export async function memberList(db: Db, projectId: string) {
  const rows = await db
    .select({
      userId: projectMembers.userId,
      fullName: users.fullName,
      username: users.username,
      avatarAttachmentId: users.avatarAttachmentId,
      roleName: roles.name,
      projectRole: projectMembers.projectRole,
      isProjectManager: projectMembers.isProjectManager,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(desc(projectMembers.isProjectManager), asc(users.fullName));
  return rows.map((m) => ({ ...m, avatarUrl: avatarUrl(m.avatarAttachmentId) }));
}

export const avatarUrl = (id: string | null) => (id ? `/files/${id}/original` : null);

async function projectDetail(db: Db, a: AuthContext, acc: ProjectAccess) {
  const p = acc.project;
  const client = await db.query.clients.findFirst({ where: eq(clients.id, p.clientId) });
  const wos = (await progressInputs(db, [p.id])).get(p.id) ?? [];
  return {
    id: p.id,
    name: p.name,
    rpoNumber: p.rpoNumber,
    client: { id: client?.id ?? null, name: client?.name ?? '' },
    location: p.location,
    startDate: p.startDate,
    endDate: p.endDate,
    description: p.description,
    logoUrl: avatarUrl(p.logoAttachmentId),
    bannerUrl: avatarUrl(p.bannerAttachmentId),
    status: p.status,
    onHoldReason: p.onHoldReason,
    doneAt: p.doneAt,
    updatedAt: p.updatedAt,
    progress: projectProgress(wos),
    categories: categorySummaries(wos),
    woCount: wos.length,
    members: await memberList(db, p.id),
    can: projectCapabilities(a, acc),
  };
}

async function assertNotLastManager(db: Db, projectId: string, userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.isProjectManager, true),
        ne(projectMembers.userId, userId),
      ),
    );
  if ((row?.n ?? 0) === 0) throw conflict('Project harus punya minimal satu pengelola');
}

type StatusChange = z.infer<typeof projectStatusSchema>;

function assertProjectTransition(a: AuthContext, acc: ProjectAccess, change: StatusChange) {
  const check = checkProjectTransition(acc.project.status, change.status, {
    canEdit: canDo(a, 'project.edit', acc.res),
    canClose: canDo(a, 'project.close', acc.res),
    canCloseAll: a.permissions['project.close'] === 'all',
  });
  if (!check.ok) throw new HttpError(403, 'FORBIDDEN', check.message);
  if (check.reasonRequired && !change.note) {
    throw new HttpError(422, 'VALIDATION', 'Isi alasan', { note: 'Alasan wajib diisi' });
  }
}

function statusFields({ status, note }: StatusChange) {
  return {
    status,
    onHoldReason: status === 'on_hold' ? (note ?? null) : null,
    doneAt: status === 'done' ? new Date() : null,
  };
}

const staleProject = () =>
  new HttpError(409, 'STALE', 'Project sudah diubah orang lain. Muat ulang lalu coba lagi.');

async function updateProject(
  tx: Tx,
  p: ProjectAccess['project'],
  fields: Partial<typeof projects.$inferInsert>,
) {
  const [updated] = await tx
    .update(projects)
    .set({ ...fields, updatedAt: new Date(Math.max(Date.now(), p.updatedAt.getTime() + 1)) })
    .where(
      and(
        eq(projects.id, p.id),
        sql`date_trunc('milliseconds', ${projects.updatedAt}) = ${p.updatedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: projects.id });
  if (!updated) throw staleProject();
}

async function recordProjectStatus(
  tx: Tx,
  c: Context<AppEnv>,
  p: ProjectAccess['project'],
  { status, note }: StatusChange,
  recipients: string[],
  name = p.name,
) {
  const a = authOf(c);
  await tx.insert(projectStatusHistory).values({
    projectId: p.id,
    fromStatus: p.status,
    toStatus: status,
    changedBy: a.user.id,
    note: note ?? null,
  });
  await audit(tx, {
    actorId: a.user.id,
    action: 'project.status_changed',
    entityType: 'project',
    entityId: p.id,
    diff: { from: p.status, to: status, note },
    ip: c.var.ip,
    userAgent: userAgent(c),
  });
  return enqueueNotifications(tx, {
    event: 'project.status_changed',
    recipients,
    actorId: a.user.id,
    projectId: p.id,
    entityType: 'project',
    entityId: p.id,
    title: `${name}: ${PROJECT_STATUS_LABEL[status]}`,
    body: note ?? `${a.user.fullName} mengubah status project`,
    url: `/project/${p.id}`,
  });
}

export const projectRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  /** FR-025: daftar project yang boleh dilihat user. */
  .get('/', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const q = c.req.query('q')?.trim();
    const seeAll = a.permissions['project.view'] === 'all';
    if (!seeAll && a.permissions['project.view'] !== 'member')
      return c.json({ projects: [], can: { create: canDo(a, 'project.create') } });
    const memberOf = db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, a.user.id));
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        rpoNumber: projects.rpoNumber,
        clientName: clients.name,
        logoAttachmentId: projects.logoAttachmentId,
        status: projects.status,
        onHoldReason: projects.onHoldReason,
        startDate: projects.startDate,
        endDate: projects.endDate,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(
        and(
          isNull(projects.deletedAt),
          seeAll ? undefined : inArray(projects.id, memberOf),
          q
            ? or(
                ilike(projects.name, `%${q}%`),
                ilike(projects.rpoNumber, `%${q}%`),
                ilike(clients.name, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(projects.endDate));

    const ids = rows.map((r) => r.id);
    const wos = await progressInputs(db, ids);
    const team = ids.length
      ? await db
          .select({
            projectId: projectMembers.projectId,
            userId: users.id,
            fullName: users.fullName,
            avatarAttachmentId: users.avatarAttachmentId,
          })
          .from(projectMembers)
          .innerJoin(users, eq(users.id, projectMembers.userId))
          .where(inArray(projectMembers.projectId, ids))
          .orderBy(desc(projectMembers.isProjectManager), asc(users.fullName))
      : [];

    return c.json({
      projects: rows.map((r) => {
        const list = wos.get(r.id) ?? [];
        const members = team.filter((t) => t.projectId === r.id);
        const active = list.filter((w) => ACTIVE(w.status));
        return {
          ...r,
          logoUrl: avatarUrl(r.logoAttachmentId),
          progress: projectProgress(list),
          activeCategories: categorySummaries(active).map((s) => s.category),
          urgentCount: active.filter((w) => w.urgent).length,
          memberCount: members.length,
          team: members.slice(0, 3).map((m) => ({
            id: m.userId,
            fullName: m.fullName,
            avatarUrl: avatarUrl(m.avatarAttachmentId),
          })),
        };
      }),
      can: { create: canDo(a, 'project.create') },
    });
  })

  /** FR-020: buat project (hanya `project.create`). Pembuat = pengelola. */
  .post('/', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    assertCan(a, 'project.create', undefined, 'Hanya Manager yang dapat membuat project');
    const body = await readJson(c, projectCreateSchema);
    await assertRpoFree(db, body.rpoNumber);
    const id = await db.transaction(async (tx) => {
      const clientId = await upsertClient(tx, body.clientName);
      const [p] = await tx
        .insert(projects)
        .values({
          clientId,
          rpoNumber: body.rpoNumber,
          name: body.name,
          location: body.location || null,
          startDate: body.startDate,
          endDate: body.endDate,
          description: body.description || null,
          logoAttachmentId: body.logoAttachmentId,
          bannerAttachmentId: body.bannerAttachmentId,
          createdBy: a.user.id,
        })
        .returning({ id: projects.id });
      for (const imageId of [body.logoAttachmentId, body.bannerAttachmentId]) {
        if (imageId) await claimProjectImage(tx, a.user.id, p!.id, imageId);
      }
      await tx.insert(projectMembers).values({
        projectId: p!.id,
        userId: a.user.id,
        projectRole: 'Project Manager',
        isProjectManager: true,
        addedBy: a.user.id,
      });
      await tx.insert(projectStatusHistory).values({
        projectId: p!.id,
        fromStatus: null,
        toStatus: 'active',
        changedBy: a.user.id,
      });
      await audit(tx, {
        actorId: a.user.id,
        action: 'project.created',
        entityType: 'project',
        entityId: p!.id,
        diff: {
          name: body.name,
          rpo: body.rpoNumber,
          client: body.clientName,
          logoAttachmentId: body.logoAttachmentId,
          bannerAttachmentId: body.bannerAttachmentId,
        },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return p!.id;
    });
    return c.json({ id }, 201);
  })

  .get('/:id', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    return c.json(await projectDetail(db, a, acc));
  })

  /** FR-021 / §7: foto/logo dan banner memakai project.edit, termasuk saat menghapus. */
  .put('/:id/media', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'project.edit', acc.res);
    const body = await readJson(c, projectMediaSchema);
    await db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, acc.project.id))
        .for('update');
      if (!p || p.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()) {
        throw new HttpError(
          409,
          'STALE',
          'Project sudah diubah orang lain. Muat ulang lalu coba lagi.',
        );
      }
      const patch: Partial<typeof projects.$inferInsert> = {};
      const removed: string[] = [];
      for (const key of ['logoAttachmentId', 'bannerAttachmentId'] as const) {
        const next = body[key];
        if (next === undefined || next === p[key]) continue;
        if (next) await claimProjectImage(tx, a.user.id, p.id, next);
        patch[key] = next;
        if (p[key]) removed.push(p[key]);
      }
      if (!Object.keys(patch).length) return;
      await tx.update(projects).set(patch).where(eq(projects.id, p.id));
      const keep = [
        body.logoAttachmentId === undefined ? p.logoAttachmentId : body.logoAttachmentId,
        body.bannerAttachmentId === undefined ? p.bannerAttachmentId : body.bannerAttachmentId,
      ];
      for (const id of removed) {
        if (keep.includes(id)) continue;
        await tx
          .update(attachments)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(attachments.id, id),
              eq(attachments.ownerType, 'project'),
              eq(attachments.ownerId, p.id),
            ),
          );
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'project.media_changed',
        entityType: 'project',
        entityId: p.id,
        diff: {
          before: {
            logoAttachmentId: p.logoAttachmentId,
            bannerAttachmentId: p.bannerAttachmentId,
          },
          after: patch,
        },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    publishToUsers(
      (await memberList(db, acc.project.id)).map((m) => m.userId),
      { type: 'project', projectId: acc.project.id },
    );
    return c.json(await projectDetail(db, a, await loadProjectAccess(db, a, acc.project.id)));
  })

  /** FR-021: edit info project (konkurensi optimistik — pelajaran v1). */
  .patch('/:id', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const body = await readJson(c, projectUpdateSchema);
    const p = acc.project;
    const { expectedUpdatedAt, clientName, statusChange, ...fields } = body;
    const hasInfo = !!clientName || Object.keys(fields).length > 0;
    if (hasInfo || !statusChange) assertCan(a, 'project.edit', acc.res);
    if (statusChange) assertProjectTransition(a, acc, statusChange);
    if (new Date(expectedUpdatedAt).getTime() !== p.updatedAt.getTime()) throw staleProject();
    if (body.rpoNumber && body.rpoNumber !== p.rpoNumber) {
      await assertRpoFree(db, body.rpoNumber, p.id);
    }
    const start = body.startDate ?? p.startDate;
    const end = body.endDate ?? p.endDate;
    if (end < start) {
      throw new HttpError(422, 'VALIDATION', 'Tanggal selesai tidak boleh sebelum tanggal mulai', {
        endDate: 'Tanggal selesai tidak boleh sebelum tanggal mulai',
      });
    }
    const recipients = (await memberList(db, p.id)).map((m) => m.userId);
    try {
      const notified = await db.transaction(async (tx) => {
        const patch: Partial<typeof projects.$inferInsert> = { ...fields };
        if (clientName) patch.clientId = await upsertClient(tx, clientName);
        await updateProject(tx, p, { ...patch, ...(statusChange && statusFields(statusChange)) });
        if (hasInfo || !statusChange)
          await audit(tx, {
            actorId: a.user.id,
            action: 'project.updated',
            entityType: 'project',
            entityId: p.id,
            diff: { ...fields, ...(clientName ? { clientName } : {}) },
            ip: c.var.ip,
            userAgent: userAgent(c),
          });
        return statusChange
          ? recordProjectStatus(tx, c, p, statusChange, recipients, fields.name)
          : [];
      });
      publishToUsers(notified, { type: 'notification' });
    } catch (err) {
      if (body.rpoNumber) await assertRpoFree(db, body.rpoNumber, p.id);
      throw err;
    }
    const fresh = await loadProjectAccess(db, a, p.id);
    publishToUsers(recipients, { type: 'project', projectId: p.id });
    return c.json(await projectDetail(db, a, fresh));
  })

  /** PRD §4.4: Berjalan ⇄ Ditunda, → Selesai (dengan syarat FR-024), buka kembali. */
  .post('/:id/status', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const body = await readJson(c, projectStatusSchema);
    const p = acc.project;
    assertProjectTransition(a, acc, body);
    const recipients = (await memberList(db, p.id)).map((m) => m.userId);
    const notified = await db.transaction(async (tx) => {
      await updateProject(tx, p, statusFields(body));
      return recordProjectStatus(tx, c, p, body, recipients);
    });
    publishToUsers(notified, { type: 'notification' });
    publishToUsers(recipients, { type: 'project', projectId: p.id });
    const fresh = await loadProjectAccess(db, a, p.id);
    return c.json(await projectDetail(db, a, fresh));
  })

  /** FR-020 AC3 / FR-021: tambah atau ubah anggota. */
  .put('/:id/members', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'project.members.manage', acc.res);
    const body = await readJson(c, memberUpsertSchema);
    const target = await db.query.users.findFirst({ where: eq(users.id, body.userId) });
    if (!target || target.status === 'disabled') throw notFound('Pengguna tidak ditemukan');
    const p = acc.project;
    const existing = await db.query.projectMembers.findFirst({
      where: and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, body.userId)),
    });
    if (existing?.isProjectManager && !body.isProjectManager) {
      await assertNotLastManager(db, p.id, body.userId);
    }
    const notified = await db.transaction(async (tx) => {
      await tx
        .insert(projectMembers)
        .values({ projectId: p.id, ...body, addedBy: a.user.id })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { projectRole: body.projectRole, isProjectManager: body.isProjectManager },
        });
      await audit(tx, {
        actorId: a.user.id,
        action: existing ? 'project.member_updated' : 'project.member_added',
        entityType: 'project',
        entityId: p.id,
        diff: { userId: body.userId, role: body.projectRole, manager: body.isProjectManager },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      if (existing) return [];
      return enqueueNotifications(tx, {
        event: 'project.member_added',
        recipients: [body.userId],
        actorId: a.user.id,
        projectId: p.id,
        entityType: 'project',
        entityId: p.id,
        title: `Anda ditambahkan ke ${p.name}`,
        body: `Peran: ${body.projectRole} · oleh ${a.user.fullName}`,
        url: `/project/${p.id}`,
        waText: [
          'Anda ditambahkan ke project',
          `*${p.name}*`,
          `RPO: ${p.rpoNumber}`,
          `Peran: ${body.projectRole}`,
          `Dari: ${a.user.fullName}`,
          `Buka project: ${env.APP_URL}/project/${p.id}`,
        ].join('\n'),
      });
    });
    publishToUsers(notified, { type: 'notification' });
    return c.json({ members: await memberList(db, p.id) });
  })

  .delete('/:id/members/:userId', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'project.members.manage', acc.res);
    const userId = c.req.param('userId');
    const p = acc.project;
    const m = await db.query.projectMembers.findFirst({
      where: and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId)),
    });
    if (!m) throw notFound('Anggota tidak ditemukan');
    if (m.isProjectManager) await assertNotLastManager(db, p.id, userId);
    const [activeWo] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.projectId, p.id),
          eq(workOrders.assigneeId, userId),
          isNull(workOrders.deletedAt),
          sql`${workOrders.status} not in ('done','canceled')`,
        ),
      );
    if ((activeWo?.n ?? 0) > 0) {
      throw conflict('Anggota ini masih PIC WO aktif. Pindahkan PIC-nya dulu.');
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId)));
      await audit(tx, {
        actorId: a.user.id,
        action: 'project.member_removed',
        entityType: 'project',
        entityId: p.id,
        diff: { userId },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ members: await memberList(db, p.id) });
  })

  .get('/:id/scurve', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'view.scurve', acc.res);
    const query = validate(
      z.object({
        category: z.enum(WO_CATEGORIES).optional(),
        assignee: z.uuid().optional(),
        urgent: z.enum(['true']).optional(),
        kind: z.uuid().optional(),
        status: z.enum(WO_STATUSES).optional(),
        help: z.enum(['true']).optional(),
        activeDeadline: z.enum(['late', 'next7']).optional(),
        dueFrom: z.iso.date().optional(),
        dueTo: z.iso.date().optional(),
      }),
      c.req.query(),
    );
    const rows = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        numberLabel: workOrders.numberLabel,
        plannedStart: workOrders.plannedStart,
        deadline: workOrders.deadline,
        weight: workOrders.weight,
        progress: workOrders.progress,
        status: workOrders.status,
        category: woTypes.category,
      })
      .from(workOrders)
      .innerJoin(woTypes, eq(woTypes.id, workOrders.typeId))
      .where(
        and(
          eq(workOrders.projectId, acc.project.id),
          isNull(workOrders.deletedAt),
          query.category ? eq(woTypes.category, query.category) : undefined,
          query.assignee ? eq(workOrders.assigneeId, query.assignee) : undefined,
          query.urgent ? eq(workOrders.urgent, true) : undefined,
          query.kind ? eq(workOrders.typeId, query.kind) : undefined,
          query.status ? eq(workOrders.status, query.status) : undefined,
          query.help
            ? exists(
                db
                  .select({ id: helpRequests.id })
                  .from(helpRequests)
                  .where(
                    and(eq(helpRequests.woId, workOrders.id), eq(helpRequests.status, 'open')),
                  ),
              )
            : undefined,
          query.activeDeadline
            ? and(ne(workOrders.status, 'done'), ne(workOrders.status, 'canceled'))
            : undefined,
          query.activeDeadline === 'late' ? lt(workOrders.deadline, todayWib()) : undefined,
          query.dueFrom ? gte(workOrders.deadline, query.dueFrom) : undefined,
          query.dueTo ? lte(workOrders.deadline, query.dueTo) : undefined,
        ),
      );
    const ids = rows.map((w) => w.id);
    const history = ids.length
      ? await db
          .select({
            woId: progressEvents.woId,
            progress: progressEvents.progress,
            status: progressEvents.status,
            recordedAt: progressEvents.recordedAt,
          })
          .from(progressEvents)
          .where(inArray(progressEvents.woId, ids))
          .orderBy(asc(progressEvents.recordedAt), asc(progressEvents.id))
      : [];
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const result = buildSCurve(
      rows,
      history.map((event) => ({ ...event, recordedAt: event.recordedAt.toISOString() })),
      today,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return c.json({
      ...result,
      weights: result.weights.map((w) => ({
        ...w,
        title: byId.get(w.id)!.title,
        numberLabel: byId.get(w.id)!.numberLabel,
      })),
    });
  })

  /** Lampiran project mencakup WO dan logbook yang masih aktif. */
  .get('/:id/attachments', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const woIds = db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(eq(workOrders.projectId, acc.project.id), isNull(workOrders.deletedAt)));
    const logIds = db
      .select({ id: logbookEntries.id })
      .from(logbookEntries)
      .where(and(inArray(logbookEntries.woId, woIds), isNull(logbookEntries.deletedAt)));
    const rows = await db
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mime: attachments.mime,
        sizeBytes: attachments.sizeBytes,
        category: attachments.category,
        ownerType: attachments.ownerType,
        ownerId: attachments.ownerId,
        createdAt: attachments.createdAt,
        uploadedBy: users.fullName,
        hasThumb: sql<boolean>`${attachments.thumbKey} is not null`,
      })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploadedBy))
      .where(
        and(
          or(
            and(eq(attachments.ownerType, 'project'), eq(attachments.ownerId, acc.project.id)),
            and(eq(attachments.ownerType, 'wo'), inArray(attachments.ownerId, woIds)),
            and(eq(attachments.ownerType, 'logbook'), inArray(attachments.ownerId, logIds)),
          ),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(desc(attachments.createdAt));
    const links = await db
      .select({
        attachmentId: woReferences.attachmentId,
        woId: workOrders.id,
        numberLabel: workOrders.numberLabel,
        title: workOrders.title,
      })
      .from(woReferences)
      .innerJoin(workOrders, eq(workOrders.id, woReferences.woId))
      .where(
        and(
          eq(woReferences.kind, 'attachment'),
          eq(workOrders.projectId, acc.project.id),
          isNull(workOrders.deletedAt),
        ),
      );
    return c.json({
      attachments: rows.map((f) => ({
        ...f,
        woLinks: links.filter((l) => l.attachmentId === f.id),
      })),
    });
  })
  .post('/:id/attachments/:attachmentId/link', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'attachment.upload', acc.res);
    const body = await readJson(c, z.object({ woId: z.uuid() }).strict());
    const attachmentId = validate(z.uuid(), c.req.param('attachmentId'));
    const result = await db.transaction(async (tx) => {
      // Serialize attachment links while preserving the file's original owner.
      const [file] = await tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)))
        .for('update');
      if (!file || !['project', 'wo', 'logbook'].includes(file.ownerType))
        throw notFound('Dokumen tidak ditemukan');
      const owner = await resolveOwner(
        tx,
        file.ownerType as 'project' | 'wo' | 'logbook',
        file.ownerId,
      );
      if (owner?.projectId !== acc.project.id) throw notFound('Dokumen tidak ditemukan');
      const [wo] = await tx
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.id, body.woId),
            eq(workOrders.projectId, acc.project.id),
            isNull(workOrders.deletedAt),
          ),
        );
      if (!wo) throw notFound('WO tidak ditemukan di project ini');
      const existing = await tx.query.woReferences.findFirst({
        where: and(
          eq(woReferences.woId, wo.id),
          eq(woReferences.attachmentId, file.id),
          eq(woReferences.kind, 'attachment'),
        ),
      });
      if (existing || (file.ownerType === 'wo' && file.ownerId === wo.id)) return { linked: true };
      await tx
        .insert(woReferences)
        .values({ woId: wo.id, attachmentId: file.id, kind: 'attachment', label: file.fileName });
      await audit(tx, {
        actorId: a.user.id,
        action: 'attachment.linked',
        entityType: 'project',
        entityId: acc.project.id,
        diff: { attachmentId: file.id, woId: wo.id },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return { linked: true };
    });
    const members = await db
      .select({ id: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, acc.project.id));
    publishToUsers(
      members.map((m) => m.id),
      { type: 'wo', woId: body.woId, projectId: acc.project.id },
    );
    return c.json(result);
  });

/** Direktori ringkas untuk pemilih anggota & PIC, autocomplete klien, dan jenis WO aktif. */
export const directoryRoutes = new Hono<AppEnv>()
  .use(requireVerified)
  .get('/users', async (c) => {
    authOf(c);
    const q = c.req.query('q')?.trim() ?? '';
    const rows = await c.var.deps.db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        roleName: roles.name,
        division: roles.divisionLabel,
        avatarAttachmentId: users.avatarAttachmentId,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(
        and(
          eq(users.status, 'active'),
          q
            ? or(
                ilike(users.fullName, `%${q}%`),
                ilike(users.username, `%${q}%`),
                ilike(roles.divisionLabel, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(users.fullName))
      .limit(30);
    return c.json({
      users: rows.map((r) => ({ ...r, avatarUrl: avatarUrl(r.avatarAttachmentId) })),
    });
  })
  .get('/clients', async (c) => {
    authOf(c);
    const q = c.req.query('q')?.trim() ?? '';
    const rows = await c.var.deps.db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(q ? ilike(clients.name, `%${q}%`) : undefined)
      .orderBy(asc(clients.name))
      .limit(20);
    return c.json({ clients: rows });
  })
  .get('/wo-types', async (c) => {
    authOf(c);
    const rows = await c.var.deps.db
      .select()
      .from(woTypes)
      .where(eq(woTypes.active, true))
      .orderBy(asc(woTypes.sortOrder));
    return c.json({ woTypes: rows });
  });
