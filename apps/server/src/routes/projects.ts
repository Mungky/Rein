/**
 * Project (PRD §3.3, FR-020–FR-025): daftar, buat, detail, edit, status, anggota,
 * progres per kategori, syarat Selesai. Izin selalu lewat can() + resource project.
 */
import {
  categorySummaries,
  checkProjectTransition,
  memberUpsertSchema,
  projectCreateSchema,
  projectProgress,
  projectStatusSchema,
  projectUpdateSchema,
  PROJECT_STATUS_LABEL,
  type WoProgressInput,
} from '@rein/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import {
  assertCan,
  canDo,
  loadProjectAccess,
  projectCapabilities,
  type ProjectAccess,
} from '../auth/project-access';
import type { AppEnv, AuthContext, Deps } from '../context';
import {
  attachments,
  clients,
  projectMembers,
  projects,
  projectStatusHistory,
  roles,
  users,
  woTypes,
  workOrders,
} from '../db/schema';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { publishToUsers } from '../notify/bus';
import { enqueueNotifications, type Tx } from '../notify/outbox';

type Db = Deps['db'];
type ProgressRow = WoProgressInput & { urgent: boolean; isPunchList: boolean };

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
      isPunchList: woTypes.isPunchList,
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

/** FR-024: syarat Selesai — punch list habis, tanggal serah terima, minimal 1 BAST. */
async function completion(db: Db, p: { id: string; handoverDate: string | null }) {
  const [punch] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workOrders)
    .innerJoin(woTypes, eq(woTypes.id, workOrders.typeId))
    .where(
      and(
        eq(workOrders.projectId, p.id),
        isNull(workOrders.deletedAt),
        eq(woTypes.isPunchList, true),
        sql`${workOrders.status} not in ('done','canceled')`,
      ),
    );
  const [bast] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, 'project'),
        eq(attachments.ownerId, p.id),
        eq(attachments.category, 'bast'),
        isNull(attachments.deletedAt),
      ),
    );
  const openPunch = punch?.n ?? 0;
  const bastCount = bast?.n ?? 0;
  const checks = {
    punchListClear: openPunch === 0,
    handoverDate: Boolean(p.handoverDate),
    bastUploaded: bastCount > 0,
  };
  return {
    ...checks,
    openPunch,
    bastCount,
    ready: checks.punchListClear && checks.handoverDate && checks.bastUploaded,
  };
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
  const nonPunch = wos.filter((w) => !w.isPunchList && w.status !== 'canceled');
  return {
    id: p.id,
    name: p.name,
    rpoNumber: p.rpoNumber,
    client: { id: client?.id ?? null, name: client?.name ?? '' },
    location: p.location,
    startDate: p.startDate,
    endDate: p.endDate,
    description: p.description,
    status: p.status,
    onHoldReason: p.onHoldReason,
    handoverDate: p.handoverDate,
    doneAt: p.doneAt,
    updatedAt: p.updatedAt,
    progress: projectProgress(wos),
    categories: categorySummaries(wos),
    woCount: wos.length,
    members: await memberList(db, p.id),
    completion: await completion(db, p),
    /** Hint PRD §4.4: semua WO non-punch-list selesai. */
    allWorkDone: nonPunch.length > 0 && nonPunch.every((w) => w.status === 'done'),
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

export const projectRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  /** FR-025: daftar project yang boleh dilihat user. */
  .get('/', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const q = c.req.query('q')?.trim();
    const seeAll = a.permissions['project.view'] === 'all';
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
          createdBy: a.user.id,
        })
        .returning({ id: projects.id });
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
        diff: { name: body.name, rpo: body.rpoNumber, client: body.clientName },
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

  /** FR-021: edit info project (konkurensi optimistik — pelajaran v1). */
  .patch('/:id', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    assertCan(a, 'project.edit', acc.res);
    const body = await readJson(c, projectUpdateSchema);
    const p = acc.project;
    if (new Date(body.expectedUpdatedAt).getTime() !== p.updatedAt.getTime()) {
      throw new HttpError(
        409,
        'STALE',
        'Project sudah diubah orang lain. Muat ulang lalu coba lagi.',
      );
    }
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
    const { expectedUpdatedAt: _ignored, clientName, ...fields } = body;
    await db.transaction(async (tx) => {
      const patch: Partial<typeof projects.$inferInsert> = {};
      if (clientName) patch.clientId = await upsertClient(tx, clientName);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
      }
      await tx.update(projects).set(patch).where(eq(projects.id, p.id));
      await audit(tx, {
        actorId: a.user.id,
        action: 'project.updated',
        entityType: 'project',
        entityId: p.id,
        diff: { ...fields, ...(clientName ? { clientName } : {}) },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    const fresh = await loadProjectAccess(db, a, p.id);
    return c.json(await projectDetail(db, a, fresh));
  })

  /** PRD §4.4: Berjalan ⇄ Ditunda, → Selesai (dengan syarat FR-024), buka kembali. */
  .post('/:id/status', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const body = await readJson(c, projectStatusSchema);
    const p = acc.project;
    const check = checkProjectTransition(p.status, body.status, {
      canEdit: canDo(a, 'project.edit', acc.res),
      canClose: canDo(a, 'project.close', acc.res),
      canCloseAll: a.permissions['project.close'] === 'all',
    });
    if (!check.ok) throw new HttpError(403, 'FORBIDDEN', check.message);
    if (check.reasonRequired && !body.note) {
      throw new HttpError(422, 'VALIDATION', 'Isi alasan', { note: 'Alasan wajib diisi' });
    }
    if (body.status === 'done' && !(await completion(db, p)).ready) {
      throw new HttpError(
        422,
        'COMPLETION_REQUIRED',
        'Syarat Selesai belum terpenuhi: punch list habis, tanggal serah terima, dan BAST',
      );
    }
    const recipients = (await memberList(db, p.id)).map((m) => m.userId);
    const notified = await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          status: body.status,
          onHoldReason: body.status === 'on_hold' ? (body.note ?? null) : null,
          doneAt: body.status === 'done' ? new Date() : null,
        })
        .where(eq(projects.id, p.id));
      await tx.insert(projectStatusHistory).values({
        projectId: p.id,
        fromStatus: p.status,
        toStatus: body.status,
        changedBy: a.user.id,
        note: body.note ?? null,
      });
      await audit(tx, {
        actorId: a.user.id,
        action: 'project.status_changed',
        entityType: 'project',
        entityId: p.id,
        diff: { from: p.status, to: body.status, note: body.note },
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
        title: `${p.name}: ${PROJECT_STATUS_LABEL[body.status]}`,
        body: body.note ?? `${a.user.fullName} mengubah status project`,
        url: `/project/${p.id}`,
      });
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

  /** Lampiran tingkat project (FR-023). */
  .get('/:id/attachments', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('id'));
    const rows = await db
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mime: attachments.mime,
        sizeBytes: attachments.sizeBytes,
        category: attachments.category,
        createdAt: attachments.createdAt,
        uploadedBy: users.fullName,
        hasThumb: sql<boolean>`${attachments.thumbKey} is not null`,
      })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploadedBy))
      .where(
        and(
          eq(attachments.ownerType, 'project'),
          eq(attachments.ownerId, acc.project.id),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(desc(attachments.createdAt));
    return c.json({ attachments: rows });
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
