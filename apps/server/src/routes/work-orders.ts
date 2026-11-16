/**
 * Work Order, logbook, Butuh bantuan (PRD §3.4–3.6, §4.5) + ringkasan Beranda (FR-010).
 * Aturan transisi status dari @rein/shared (sama dengan UI). Pelajaran v1: create idempoten
 * (id = clientId + hash isi), edit dengan expectedUpdatedAt, nomor WO atomik.
 */
import { createHash } from 'node:crypto';
import {
  checkWoTransition,
  helpReplySchema,
  helpRequestSchema,
  isOverdue,
  logbookCreateSchema,
  todayWib,
  WO_STATUS_LABEL,
  woCreateSchema,
  woNumberLabel,
  woStatusSchema,
  woTargets,
  woUpdateSchema,
  type WoStatus,
} from '@rein/shared';
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requireVerified } from '../auth/middleware';
import { assertCan, canDo, loadProjectAccess, type ProjectAccess } from '../auth/project-access';
import type { AppEnv, AuthContext, Deps } from '../context';
import {
  attachments,
  helpRequests,
  logbookEntries,
  projectMembers,
  projects,
  progressEvents,
  users,
  woReferences,
  woTypes,
  woWatchers,
  workOrders,
  type WorkOrder,
} from '../db/schema';
import { forbidden, HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';
import { publishToUsers } from '../notify/bus';
import { enqueueNotifications, type Tx } from '../notify/outbox';
import { avatarUrl } from './projects';

type Db = Deps['db'];

const longDate = (d: string) =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const shortDate = (d: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stale = () =>
  new HttpError(409, 'STALE', 'WO sudah diubah orang lain. Muat ulang lalu coba lagi.');

async function loadWo(db: Db, a: AuthContext, woId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(woId)) throw notFound('WO tidak ditemukan');
  const wo = await db.query.workOrders.findFirst({
    where: and(eq(workOrders.id, woId), isNull(workOrders.deletedAt)),
  });
  if (!wo) throw notFound('WO tidak ditemukan');
  const acc = await loadProjectAccess(db, a, wo.projectId);
  return { wo, acc };
}

function actorOf(a: AuthContext, wo: WorkOrder, acc: ProjectAccess) {
  return {
    isAssignee:
      wo.assigneeId === a.user.id && canDo(a, 'wo.edit.own', { ownerIds: [wo.assigneeId] }),
    isCreator: wo.createdBy === a.user.id,
    canEditAny: canDo(a, 'wo.edit.any', acc.res),
  };
}

async function hasLogbook(db: Db | Tx, woId: string) {
  const row = await db.query.logbookEntries.findFirst({
    where: and(
      eq(logbookEntries.woId, woId),
      ne(logbookEntries.kind, 'system'),
      isNull(logbookEntries.deletedAt),
    ),
  });
  return Boolean(row);
}

async function managersOf(db: Db | Tx, projectId: string) {
  const rows = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isProjectManager, true)));
  return rows.map((r) => r.id);
}

async function watchersOf(db: Db | Tx, woId: string) {
  const rows = await db
    .select({ id: woWatchers.userId })
    .from(woWatchers)
    .where(eq(woWatchers.woId, woId));
  return rows.map((r) => r.id);
}

async function addWatchers(tx: Tx, woId: string, ids: Iterable<string | null | undefined>) {
  const list = [...new Set([...ids].filter((x): x is string => Boolean(x)))];
  if (list.length) {
    await tx
      .insert(woWatchers)
      .values(list.map((userId) => ({ woId, userId })))
      .onConflictDoNothing();
  }
}

/** Pindahkan lampiran staging milik user ke pemilik baru (FR-030 AC0). */
async function claimAttachments(
  tx: Tx,
  userId: string,
  ids: string[],
  owner: { type: 'wo' | 'logbook'; id: string },
) {
  if (!ids.length) return 0;
  const rows = await tx
    .update(attachments)
    .set({ ownerType: owner.type, ownerId: owner.id })
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.ownerType, 'user'),
        eq(attachments.ownerId, userId),
        eq(attachments.uploadedBy, userId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning({ id: attachments.id });
  if (rows.length !== ids.length) {
    throw new HttpError(422, 'ATTACHMENT', 'Sebagian lampiran tidak ditemukan atau sudah dipakai');
  }
  return rows.length;
}

async function isMember(db: Db | Tx, projectId: string, userId: string) {
  return Boolean(
    await db.query.projectMembers.findFirst({
      where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    }),
  );
}

async function systemEntry(
  tx: Tx,
  woId: string,
  authorId: string,
  body: string,
  extra: Partial<typeof logbookEntries.$inferInsert> = {},
) {
  await tx.insert(logbookEntries).values({ woId, authorId, kind: 'system', body, ...extra });
}

/** Baris worklist ringkas (Table/Kanban). */
function listSelect() {
  return {
    id: workOrders.id,
    seq: workOrders.seq,
    numberLabel: workOrders.numberLabel,
    title: workOrders.title,
    status: workOrders.status,
    urgent: workOrders.urgent,
    plannedStart: workOrders.plannedStart,
    deadline: workOrders.deadline,
    progress: workOrders.progress,
    weight: workOrders.weight,
    createdBy: workOrders.createdBy,
    updatedAt: workOrders.updatedAt,
    projectId: workOrders.projectId,
    type: {
      id: woTypes.id,
      name: woTypes.name,
      code: woTypes.code,
      category: woTypes.category,
      isPunchList: woTypes.isPunchList,
    },
    assignee: {
      id: users.id,
      fullName: users.fullName,
      avatarAttachmentId: users.avatarAttachmentId,
    },
    helpOpen: sql<boolean>`exists (select 1 from help_requests h where h.wo_id = ${workOrders.id} and h.status = 'open' and h.show_flag)`,
    hasLogbook: sql<boolean>`exists (select 1 from logbook_entries l where l.wo_id = ${workOrders.id} and l.kind <> 'system' and l.deleted_at is null)`,
  };
}

type ListRow = Awaited<ReturnType<typeof listQuery>>[number];
function listQuery(db: Db) {
  return db
    .select(listSelect())
    .from(workOrders)
    .innerJoin(woTypes, eq(woTypes.id, workOrders.typeId))
    .innerJoin(users, eq(users.id, workOrders.assigneeId));
}

function shapeRow(r: ListRow, today: string) {
  const { avatarAttachmentId, ...assignee } = r.assignee;
  return {
    ...r,
    assignee: { ...assignee, avatarUrl: avatarUrl(avatarAttachmentId) },
    overdue: isOverdue(r.deadline, r.status, today),
  };
}

export const projectWoRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  /** Worklist project (FR-070/071 dasar; filter lanjutan di klien). */
  .get('/:projectId/work-orders', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('projectId'));
    const rows = await listQuery(db)
      .where(and(eq(workOrders.projectId, acc.project.id), isNull(workOrders.deletedAt)))
      .orderBy(asc(workOrders.seq));
    const today = todayWib();
    const canEditAny = canDo(a, 'wo.edit.any', acc.res);
    const canEditOwn = Boolean(a.permissions['wo.edit.own']);
    return c.json({
      workOrders: rows.map((r) => shapeRow(r, today)),
      actor: { userId: a.user.id, canEditAny, canEditOwn },
    });
  })

  /** FR-030: buat WO. Idempoten pada `clientId`. */
  .post('/:projectId/work-orders', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const acc = await loadProjectAccess(db, a, c.req.param('projectId'));
    assertCan(a, 'wo.create', acc.res);
    const body = await readJson(c, woCreateSchema);
    const p = acc.project;
    const digest = hashOf({ ...body, projectId: p.id });

    const existing = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, body.clientId),
    });
    if (existing) {
      if (existing.projectId !== p.id || existing.creationHash !== digest) {
        throw new HttpError(409, 'CLIENT_ID_REUSED', 'ID pembuatan sudah dipakai untuk WO lain');
      }
      return c.json({ id: existing.id, numberLabel: existing.numberLabel, duplicate: true });
    }
    if (p.status === 'done') throw new HttpError(409, 'PROJECT_DONE', 'Project sudah Selesai');
    if (body.weight != null)
      assertCan(a, 'wo.weight.edit', acc.res, 'Anda tidak bisa mengatur bobot');
    const type = await db.query.woTypes.findFirst({
      where: and(eq(woTypes.id, body.typeId), eq(woTypes.active, true)),
    });
    if (!type)
      throw new HttpError(422, 'VALIDATION', 'Jenis WO tidak valid', {
        typeId: 'Jenis WO tidak valid',
      });
    if (!(await isMember(db, p.id, body.assigneeId))) {
      throw new HttpError(422, 'ASSIGNEE_NOT_MEMBER', 'Penanggung jawab harus anggota project', {
        assigneeId: 'Penanggung jawab harus anggota project',
      });
    }
    const assignee = await db.query.users.findFirst({ where: eq(users.id, body.assigneeId) });
    const plannedStart = body.plannedStart ?? todayWib();
    if (body.deadline < plannedStart) {
      throw new HttpError(422, 'VALIDATION', 'Deadline tidak boleh sebelum tanggal mulai', {
        deadline: 'Deadline tidak boleh sebelum tanggal mulai',
      });
    }

    const result = await db.transaction(async (tx) => {
      const [seqRow] = await tx
        .update(projects)
        .set({ nextWoSeq: sql`${projects.nextWoSeq} + 1` })
        .where(eq(projects.id, p.id))
        .returning({ seq: sql<number>`${projects.nextWoSeq} - 1` });
      const seq = seqRow!.seq;
      await tx.insert(workOrders).values({
        id: body.clientId,
        projectId: p.id,
        seq,
        title: body.title,
        typeId: type.id,
        assigneeId: body.assigneeId,
        createdBy: a.user.id,
        status: 'todo',
        urgent: body.urgent,
        plannedStart,
        deadline: body.deadline,
        weight: body.weight ?? null,
        detailJson: body.detail ? { text: body.detail } : null,
        creationHash: digest,
      });
      await addWatchers(tx, body.clientId, [
        a.user.id,
        body.assigneeId,
        ...(await managersOf(tx, p.id)),
      ]);
      if (body.references.length) {
        await tx.insert(woReferences).values(
          body.references.map((r) => ({
            woId: body.clientId,
            kind: r.kind,
            targetWoId: r.targetWoId ?? null,
            url: r.url ?? null,
            label: r.label ?? null,
          })),
        );
      }
      const files = await claimAttachments(tx, a.user.id, body.attachmentIds, {
        type: 'wo',
        id: body.clientId,
      });
      await tx.insert(progressEvents).values({ woId: body.clientId, progress: 0, status: 'todo' });
      await systemEntry(tx, body.clientId, a.user.id, `${a.user.fullName} membuat WO`);
      await audit(tx, {
        actorId: a.user.id,
        action: 'wo.created',
        entityType: 'wo',
        entityId: body.clientId,
        diff: { projectId: p.id, seq, title: body.title, assignee: body.assigneeId, files },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      const label = woNumberLabel(seq);
      const notified = await enqueueNotifications(tx, {
        event: 'wo.assigned',
        recipients: [body.assigneeId],
        actorId: a.user.id,
        projectId: p.id,
        entityType: 'wo',
        entityId: body.clientId,
        title: `${label} — ${body.title}`,
        body: `${a.user.fullName} menugaskan WO baru · deadline ${shortDate(body.deadline)}`,
        url: `/w/${body.clientId}`,
        waText: [
          'WO baru untuk Anda',
          `*${label} — ${body.title}*`,
          `Project: ${p.name}`,
          `RPO: ${p.rpoNumber}`,
          `Jenis: ${type.name}${body.urgent ? ' · *URGENT*' : ''}`,
          `Deadline: ${longDate(body.deadline)}`,
          `Dari: ${a.user.fullName}`,
          ...(files ? [`Lampiran: ${files} file`] : []),
          `Buka WO: ${env.APP_URL}/w/${body.clientId}`,
        ].join('\n'),
      });
      return { seq, label, files, notified };
    });
    publishToUsers(result.notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, body.clientId), {
      type: 'wo',
      woId: body.clientId,
      projectId: p.id,
    });
    return c.json(
      {
        id: body.clientId,
        numberLabel: result.label,
        attachments: result.files,
        assigneeName: assignee?.fullName ?? '',
        whatsappQueued: result.notified.length > 0,
      },
      201,
    );
  });

export const woRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  /** FR-033: detail WO. */
  .get('/:id', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    const [row] = await listQuery(db).where(eq(workOrders.id, wo.id));
    const creator = await db.query.users.findFirst({ where: eq(users.id, wo.createdBy) });
    const watchers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        avatarAttachmentId: users.avatarAttachmentId,
      })
      .from(woWatchers)
      .innerJoin(users, eq(users.id, woWatchers.userId))
      .where(eq(woWatchers.woId, wo.id));
    const refs = await db.select().from(woReferences).where(eq(woReferences.woId, wo.id));
    const files = await db
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mime: attachments.mime,
        sizeBytes: attachments.sizeBytes,
        hasThumb: sql<boolean>`${attachments.thumbKey} is not null`,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, 'wo'),
          eq(attachments.ownerId, wo.id),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(asc(attachments.createdAt));
    const help = await db.query.helpRequests.findFirst({
      where: and(eq(helpRequests.woId, wo.id), eq(helpRequests.status, 'open')),
    });
    const actor = actorOf(a, wo, acc);
    const logbookExists = await hasLogbook(db, wo.id);
    const writeLogbook = canDo(a, 'logbook.create', acc.res);
    return c.json({
      ...shapeRow(row!, todayWib()),
      detail: wo.detailJson?.text ?? '',
      canceledReason: wo.canceledReason,
      completedAt: wo.completedAt,
      createdAt: wo.createdAt,
      project: {
        id: acc.project.id,
        name: acc.project.name,
        rpoNumber: acc.project.rpoNumber,
        status: acc.project.status,
      },
      creator: { id: wo.createdBy, fullName: creator?.fullName ?? '' },
      watchers: watchers.map((w) => ({
        id: w.id,
        fullName: w.fullName,
        avatarUrl: avatarUrl(w.avatarAttachmentId),
      })),
      isWatching: watchers.some((w) => w.id === a.user.id),
      references: refs,
      attachments: files,
      help: help ? { id: help.id, requestedBy: help.requestedBy, createdAt: help.createdAt } : null,
      can: {
        editAny: actor.canEditAny,
        editDetail: actor.canEditAny || actor.isAssignee,
        editWeight: canDo(a, 'wo.weight.edit', acc.res),
        delete: canDo(a, 'wo.delete', acc.res),
        writeLogbook,
        upload: canDo(a, 'attachment.upload', acc.res),
        requestHelp: writeLogbook,
        resolveHelp:
          actor.canEditAny || acc.isManager || actor.isCreator || help?.requestedBy === a.user.id,
        statusTargets: woTargets(wo.status, actor, { hasLogbook: logbookExists }),
      },
    });
  })

  /** FR-031: edit WO; setiap perubahan field dicatat sebagai entri `system`. */
  .patch('/:id', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    const body = await readJson(c, woUpdateSchema);
    if (new Date(body.expectedUpdatedAt).getTime() !== wo.updatedAt.getTime()) throw stale();
    const actor = actorOf(a, wo, acc);
    const touchesCore = [
      'title',
      'typeId',
      'assigneeId',
      'plannedStart',
      'deadline',
      'urgent',
    ].some((k) => body[k as keyof typeof body] !== undefined);
    if (touchesCore && !actor.canEditAny)
      throw forbidden('Hanya pengelola yang dapat mengubah data inti WO');
    if (body.detail !== undefined && !actor.canEditAny && !actor.isAssignee) throw forbidden();
    if (body.weight !== undefined)
      assertCan(a, 'wo.weight.edit', acc.res, 'Anda tidak bisa mengatur bobot');
    if (['done', 'canceled'].includes(wo.status) && touchesCore) {
      throw new HttpError(409, 'WO_CLOSED', 'WO Selesai/Dibatalkan tidak dapat diubah');
    }
    if (body.assigneeId && !(await isMember(db, wo.projectId, body.assigneeId))) {
      throw new HttpError(422, 'ASSIGNEE_NOT_MEMBER', 'Penanggung jawab harus anggota project', {
        assigneeId: 'Penanggung jawab harus anggota project',
      });
    }
    const plannedStart = body.plannedStart ?? wo.plannedStart;
    const deadline = body.deadline ?? wo.deadline;
    if (deadline < plannedStart) {
      throw new HttpError(422, 'VALIDATION', 'Deadline tidak boleh sebelum tanggal mulai', {
        deadline: 'Deadline tidak boleh sebelum tanggal mulai',
      });
    }

    const changes: string[] = [];
    const patch: Partial<typeof workOrders.$inferInsert> = {};
    if (body.title !== undefined && body.title !== wo.title) {
      patch.title = body.title;
      changes.push(`judul → "${body.title}"`);
    }
    if (body.deadline !== undefined && body.deadline !== wo.deadline) {
      patch.deadline = body.deadline;
      changes.push(`deadline ${shortDate(wo.deadline)} → ${shortDate(body.deadline)}`);
    }
    if (body.plannedStart !== undefined && body.plannedStart !== wo.plannedStart) {
      patch.plannedStart = body.plannedStart;
      changes.push(`mulai ${shortDate(wo.plannedStart)} → ${shortDate(body.plannedStart)}`);
    }
    if (body.urgent !== undefined && body.urgent !== wo.urgent) {
      patch.urgent = body.urgent;
      changes.push(body.urgent ? 'menandai Urgent' : 'menghapus tanda Urgent');
    }
    if (body.weight !== undefined && body.weight !== wo.weight) {
      patch.weight = body.weight;
      changes.push(`bobot → ${body.weight ?? 'otomatis'}`);
    }
    if (body.typeId !== undefined && body.typeId !== wo.typeId) {
      const t = await db.query.woTypes.findFirst({ where: eq(woTypes.id, body.typeId) });
      if (!t) throw new HttpError(422, 'VALIDATION', 'Jenis WO tidak valid');
      patch.typeId = t.id;
      changes.push(`jenis → ${t.name}`);
    }
    if (body.detail !== undefined && body.detail !== (wo.detailJson?.text ?? '')) {
      patch.detailJson = { text: body.detail };
      changes.push('detail pekerjaan');
    }
    let newAssignee: { id: string; fullName: string } | null = null;
    if (body.assigneeId !== undefined && body.assigneeId !== wo.assigneeId) {
      const u = await db.query.users.findFirst({ where: eq(users.id, body.assigneeId) });
      if (!u) throw notFound('Pengguna tidak ditemukan');
      patch.assigneeId = u.id;
      newAssignee = { id: u.id, fullName: u.fullName };
      changes.push(`PIC → ${u.fullName}`);
    }
    if (!changes.length) return c.json({ ok: true, unchanged: true });

    const label = wo.numberLabel ?? woNumberLabel(wo.seq);
    const title = patch.title ?? wo.title;
    const notified = await db.transaction(async (tx) => {
      await tx.update(workOrders).set(patch).where(eq(workOrders.id, wo.id));
      await systemEntry(tx, wo.id, a.user.id, `${a.user.fullName} mengubah ${changes.join(', ')}`);
      await audit(tx, {
        actorId: a.user.id,
        action: 'wo.updated',
        entityType: 'wo',
        entityId: wo.id,
        diff: { changes },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      const out: string[] = [];
      if (newAssignee) {
        await addWatchers(tx, wo.id, [newAssignee.id]);
        out.push(
          ...(await enqueueNotifications(tx, {
            event: 'wo.assigned',
            recipients: [newAssignee.id],
            actorId: a.user.id,
            projectId: wo.projectId,
            entityType: 'wo',
            entityId: wo.id,
            title: `${label} — ${title}`,
            body: `${a.user.fullName} menjadikan Anda PIC`,
            url: `/w/${wo.id}`,
            waText: [
              'WO baru untuk Anda',
              `*${label} — ${title}*`,
              `Project: ${acc.project.name}`,
              `RPO: ${acc.project.rpoNumber}`,
              `Deadline: ${longDate(patch.deadline ?? wo.deadline)}`,
              `Dari: ${a.user.fullName}`,
              `Buka WO: ${env.APP_URL}/w/${wo.id}`,
            ].join('\n'),
          })),
          ...(await enqueueNotifications(tx, {
            event: 'wo.unassigned',
            recipients: [wo.assigneeId],
            actorId: a.user.id,
            projectId: wo.projectId,
            entityType: 'wo',
            entityId: wo.id,
            title: `${label} dipindah ke ${newAssignee.fullName}`,
            body: title,
            url: `/w/${wo.id}`,
          })),
        );
      }
      if (patch.deadline || patch.urgent !== undefined || patch.title) {
        out.push(
          ...(await enqueueNotifications(tx, {
            event: 'wo.updated',
            recipients: [patch.assigneeId ?? wo.assigneeId, ...(await watchersOf(tx, wo.id))],
            actorId: a.user.id,
            projectId: wo.projectId,
            entityType: 'wo',
            entityId: wo.id,
            title: `${label} diubah`,
            body: changes.join(', '),
            url: `/w/${wo.id}`,
          })),
        );
      }
      return out;
    });
    publishToUsers(notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, wo.id), {
      type: 'wo',
      woId: wo.id,
      projectId: wo.projectId,
    });
    return c.json({ ok: true, changes });
  })

  /** FR-032 / PRD §4.5: ubah status lewat properti atau Kanban. */
  .post('/:id/status', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    const body = await readJson(c, woStatusSchema);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== wo.updatedAt.getTime()
    ) {
      throw stale();
    }
    const notified = await db.transaction(async (tx) => {
      return changeStatus(tx, a, wo, acc, body.status, body.reason, c.var.ip, userAgent(c));
    });
    publishToUsers(notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, wo.id), {
      type: 'wo',
      woId: wo.id,
      projectId: wo.projectId,
    });
    return c.json({ ok: true, status: body.status });
  })

  /** FR-035: soft delete (izin `wo.delete`, default tidak ada role). */
  .delete('/:id', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    assertCan(a, 'wo.delete', acc.res);
    await db.transaction(async (tx) => {
      await tx.update(workOrders).set({ deletedAt: new Date() }).where(eq(workOrders.id, wo.id));
      await audit(tx, {
        actorId: a.user.id,
        action: 'wo.deleted',
        entityType: 'wo',
        entityId: wo.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ ok: true });
  })

  /** FR-034: ikuti / berhenti ikuti. */
  .post('/:id/watch', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo } = await loadWo(db, a, c.req.param('id'));
    await db.insert(woWatchers).values({ woId: wo.id, userId: a.user.id }).onConflictDoNothing();
    return c.json({ watching: true });
  })
  .delete('/:id/watch', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo } = await loadWo(db, a, c.req.param('id'));
    await db
      .delete(woWatchers)
      .where(and(eq(woWatchers.woId, wo.id), eq(woWatchers.userId, a.user.id)));
    return c.json({ watching: false });
  })

  /** FR-042: logbook terbaru di atas, 20 per halaman (kursor = createdAt ISO). */
  .get('/:id/logbook', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo } = await loadWo(db, a, c.req.param('id'));
    const before = c.req.query('before');
    const rows = await db
      .select({
        id: logbookEntries.id,
        kind: logbookEntries.kind,
        body: logbookEntries.body,
        progressFrom: logbookEntries.progressFrom,
        progressTo: logbookEntries.progressTo,
        statusFrom: logbookEntries.statusFrom,
        statusTo: logbookEntries.statusTo,
        createdAt: logbookEntries.createdAt,
        editedAt: logbookEntries.editedAt,
        author: {
          id: users.id,
          fullName: users.fullName,
          avatarAttachmentId: users.avatarAttachmentId,
        },
      })
      .from(logbookEntries)
      .innerJoin(users, eq(users.id, logbookEntries.authorId))
      .where(
        and(
          eq(logbookEntries.woId, wo.id),
          isNull(logbookEntries.deletedAt),
          before ? lt(logbookEntries.createdAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(logbookEntries.createdAt))
      .limit(21);
    const page = rows.slice(0, 20);
    const ids = page.map((r) => r.id);
    const files = ids.length
      ? await db
          .select({
            id: attachments.id,
            ownerId: attachments.ownerId,
            fileName: attachments.fileName,
            mime: attachments.mime,
            sizeBytes: attachments.sizeBytes,
            hasThumb: sql<boolean>`${attachments.thumbKey} is not null`,
          })
          .from(attachments)
          .where(
            and(
              eq(attachments.ownerType, 'logbook'),
              inArray(attachments.ownerId, ids),
              isNull(attachments.deletedAt),
            ),
          )
      : [];
    return c.json({
      entries: page.map(({ author, ...e }) => ({
        ...e,
        author: {
          id: author.id,
          fullName: author.fullName,
          avatarUrl: avatarUrl(author.avatarAttachmentId),
        },
        attachments: files.filter((f) => f.ownerId === e.id).map(({ ownerId: _o, ...f }) => f),
      })),
      nextCursor: rows.length > 20 ? page[page.length - 1]!.createdAt.toISOString() : null,
    });
  })

  /** FR-040: tulis entri logbook (+ progres, status, lampiran). Idempoten per penulis. */
  .post('/:id/logbook', async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    assertCan(a, 'logbook.create', acc.res, 'Anda bukan anggota project ini');
    const body = await readJson(c, logbookCreateSchema);
    const digest = hashOf(body);
    const dup = await db.query.logbookEntries.findFirst({
      where: and(
        eq(logbookEntries.authorId, a.user.id),
        eq(logbookEntries.clientUuid, body.clientId),
      ),
    });
    if (dup) {
      if (dup.requestHash !== digest) {
        throw new HttpError(409, 'CLIENT_ID_REUSED', 'ID logbook sudah dipakai untuk catatan lain');
      }
      return c.json({ id: dup.id, duplicate: true });
    }
    const actor = actorOf(a, wo, acc);
    if (body.progress != null && body.progress < wo.progress) {
      if (!actor.canEditAny) throw forbidden('Progres tidak boleh turun');
      if (!body.reason) {
        throw new HttpError(422, 'VALIDATION', 'Alasan wajib saat menurunkan progres', {
          reason: 'Alasan wajib',
        });
      }
    }
    if (body.progress != null && !actor.isAssignee && !actor.canEditAny) {
      throw forbidden('Hanya PIC atau pengelola yang dapat mengubah progres');
    }
    const kind = actor.isAssignee || wo.createdBy === a.user.id ? 'note' : 'comment';

    const result = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(logbookEntries)
        .values({
          woId: wo.id,
          authorId: a.user.id,
          kind,
          body: body.body,
          clientUuid: body.clientId,
          requestHash: digest,
          clientCreatedAt: body.clientCreatedAt ? new Date(body.clientCreatedAt) : null,
          progressFrom: body.progress != null ? wo.progress : null,
          progressTo: body.progress ?? null,
        })
        .returning({ id: logbookEntries.id });
      await claimAttachments(tx, a.user.id, body.attachmentIds, { type: 'logbook', id: entry!.id });
      let notified: string[] = [];
      if (body.status && body.status !== wo.status) {
        notified = await changeStatus(
          tx,
          a,
          wo,
          acc,
          body.status,
          body.reason,
          c.var.ip,
          userAgent(c),
          {
            entryId: entry!.id,
            hasLogbook: true,
            progress: body.progress,
          },
        );
      } else if (body.progress != null && body.progress !== wo.progress) {
        await tx
          .update(workOrders)
          .set({ progress: body.progress })
          .where(eq(workOrders.id, wo.id));
        await tx.insert(progressEvents).values({
          woId: wo.id,
          progress: body.progress,
          status: wo.status,
          sourceEntryId: entry!.id,
        });
      } else {
        await tx.update(workOrders).set({ updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
      }
      notified.push(
        ...(await enqueueNotifications(tx, {
          event: 'logbook.created',
          recipients: await watchersOf(tx, wo.id),
          actorId: a.user.id,
          projectId: wo.projectId,
          entityType: 'wo',
          entityId: wo.id,
          title: `${wo.numberLabel ?? woNumberLabel(wo.seq)}: logbook dari ${a.user.fullName}`,
          body: body.body.slice(0, 200),
          url: `/w/${wo.id}`,
        })),
      );
      return { id: entry!.id, notified };
    });
    publishToUsers(result.notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, wo.id), {
      type: 'wo',
      woId: wo.id,
      projectId: wo.projectId,
    });
    return c.json({ id: result.id }, 201);
  })

  /** FR-050: Butuh bantuan. Satu permintaan `open` per WO (permintaan kedua menambah entri). */
  .post('/:id/help', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    assertCan(a, 'logbook.create', acc.res, 'Anda bukan anggota project ini');
    const body = await readJson(c, helpRequestSchema);
    const dup = await db.query.logbookEntries.findFirst({
      where: and(
        eq(logbookEntries.authorId, a.user.id),
        eq(logbookEntries.clientUuid, body.clientId),
      ),
    });
    if (dup) return c.json({ id: dup.id, duplicate: true });
    const label = wo.numberLabel ?? woNumberLabel(wo.seq);
    const notified = await db.transaction(async (tx) => {
      const open = await tx.query.helpRequests.findFirst({
        where: and(eq(helpRequests.woId, wo.id), eq(helpRequests.status, 'open')),
      });
      if (!open) {
        await tx
          .insert(helpRequests)
          .values({ woId: wo.id, requestedBy: a.user.id, showFlag: body.showFlag });
      } else if (body.showFlag && !open.showFlag) {
        await tx.update(helpRequests).set({ showFlag: true }).where(eq(helpRequests.id, open.id));
      }
      await tx.insert(logbookEntries).values({
        woId: wo.id,
        authorId: a.user.id,
        kind: 'help_request',
        body: body.body,
        clientUuid: body.clientId,
        requestHash: hashOf(body),
      });
      await tx.update(workOrders).set({ updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
      await audit(tx, {
        actorId: a.user.id,
        action: 'help.requested',
        entityType: 'wo',
        entityId: wo.id,
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      const excerpt = body.body.length > 140 ? `${body.body.slice(0, 137)}…` : body.body;
      return enqueueNotifications(tx, {
        event: 'help.requested',
        recipients: [...(await managersOf(tx, wo.projectId)), wo.createdBy],
        actorId: a.user.id,
        projectId: wo.projectId,
        entityType: 'wo',
        entityId: wo.id,
        title: `Butuh bantuan di ${label}`,
        body: `${a.user.fullName}: ${excerpt}`,
        url: `/w/${wo.id}`,
        waText: [
          `*Butuh bantuan* di ${label}`,
          wo.title,
          `Dari: ${a.user.fullName}`,
          `"${excerpt}"`,
          `Project: ${acc.project.name}`,
          `Balas di REIN: ${env.APP_URL}/w/${wo.id}`,
        ].join('\n'),
      });
    });
    publishToUsers(notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, wo.id), {
      type: 'wo',
      woId: wo.id,
      projectId: wo.projectId,
    });
    return c.json({ ok: true }, 201);
  })

  /** FR-051: balas (+ tandai selesai). Balasan = entri `comment`. */
  .post('/:id/help/reply', async (c) => {
    const a = authOf(c);
    const { db, env } = c.var.deps;
    const { wo, acc } = await loadWo(db, a, c.req.param('id'));
    assertCan(a, 'logbook.create', acc.res, 'Anda bukan anggota project ini');
    const body = await readJson(c, helpReplySchema);
    const open = await db.query.helpRequests.findFirst({
      where: and(eq(helpRequests.woId, wo.id), eq(helpRequests.status, 'open')),
    });
    const actor = actorOf(a, wo, acc);
    if (body.resolve) {
      if (!open) throw new HttpError(409, 'NO_HELP', 'Tidak ada permintaan bantuan terbuka');
      const allowed =
        actor.canEditAny || acc.isManager || actor.isCreator || open.requestedBy === a.user.id;
      if (!allowed) throw forbidden('Anda tidak bisa menandai bantuan selesai');
    }
    const label = wo.numberLabel ?? woNumberLabel(wo.seq);
    const notified = await db.transaction(async (tx) => {
      await tx.insert(logbookEntries).values({
        woId: wo.id,
        authorId: a.user.id,
        kind: 'comment',
        body: body.body,
        clientUuid: body.clientId,
        requestHash: hashOf(body),
      });
      const out: string[] = [];
      if (body.resolve && open) {
        await tx
          .update(helpRequests)
          .set({ status: 'resolved', resolvedBy: a.user.id, resolvedAt: new Date() })
          .where(eq(helpRequests.id, open.id));
        await tx.insert(logbookEntries).values({
          woId: wo.id,
          authorId: a.user.id,
          kind: 'help_resolved',
          body: `${a.user.fullName} menandai bantuan selesai`,
        });
        out.push(
          ...(await enqueueNotifications(tx, {
            event: 'help.resolved',
            recipients: [open.requestedBy],
            actorId: a.user.id,
            projectId: wo.projectId,
            entityType: 'wo',
            entityId: wo.id,
            title: `Bantuan di ${label} selesai`,
            body: `${a.user.fullName}: ${body.body.slice(0, 200)}`,
            url: `/w/${wo.id}`,
            waText: [
              `Bantuan di ${label} ditandai selesai`,
              `*${wo.title}*`,
              `Oleh: ${a.user.fullName}`,
              `"${body.body.slice(0, 140)}"`,
              `Buka WO: ${env.APP_URL}/w/${wo.id}`,
            ].join('\n'),
          })),
        );
      } else if (open) {
        out.push(
          ...(await enqueueNotifications(tx, {
            event: 'logbook.created',
            recipients: [open.requestedBy],
            actorId: a.user.id,
            projectId: wo.projectId,
            entityType: 'wo',
            entityId: wo.id,
            title: `${a.user.fullName} membalas permintaan bantuan di ${label}`,
            body: body.body.slice(0, 200),
            url: `/w/${wo.id}`,
          })),
        );
      }
      await tx.update(workOrders).set({ updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
      return out;
    });
    publishToUsers(notified, { type: 'notification' });
    publishToUsers(await watchersOf(db, wo.id), {
      type: 'wo',
      woId: wo.id,
      projectId: wo.projectId,
    });
    return c.json({ ok: true }, 201);
  });

/** Ubah status + efek samping (PRD §4.5): progres, entri system, progress_events, notifikasi. */
async function changeStatus(
  tx: Tx,
  a: AuthContext,
  wo: WorkOrder,
  acc: ProjectAccess,
  to: WoStatus,
  reason: string | undefined,
  ip: string,
  ua: string | null,
  opts: { entryId?: string; hasLogbook?: boolean; progress?: number } = {},
): Promise<string[]> {
  const check = checkWoTransition(wo.status, to, actorOf(a, wo, acc), {
    hasLogbook: opts.hasLogbook ?? (await hasLogbook(tx, wo.id)),
  });
  if (!check.ok) {
    throw new HttpError(check.code === 'LOGBOOK_REQUIRED' ? 422 : 403, check.code, check.message);
  }
  if (check.reasonRequired && !reason) {
    throw new HttpError(422, 'VALIDATION', 'Alasan wajib diisi', { reason: 'Alasan wajib diisi' });
  }
  const progress = to === 'done' ? 100 : (opts.progress ?? wo.progress);
  await tx
    .update(workOrders)
    .set({
      status: to,
      progress,
      completedAt: to === 'done' ? new Date() : null,
      canceledReason: to === 'canceled' ? (reason ?? null) : null,
    })
    .where(eq(workOrders.id, wo.id));
  await tx.insert(progressEvents).values({
    woId: wo.id,
    progress,
    status: to,
    sourceEntryId: opts.entryId ?? null,
  });
  const verb =
    wo.status === 'review' && to === 'in_progress'
      ? `Dikembalikan: ${reason}`
      : `${a.user.fullName} mengubah status ${WO_STATUS_LABEL[wo.status]} → ${WO_STATUS_LABEL[to]}${reason ? ` (${reason})` : ''}`;
  await systemEntry(tx, wo.id, a.user.id, verb, { statusFrom: wo.status, statusTo: to });
  await audit(tx, {
    actorId: a.user.id,
    action: 'wo.status_changed',
    entityType: 'wo',
    entityId: wo.id,
    diff: { from: wo.status, to, reason },
    ip,
    userAgent: ua,
  });
  return enqueueNotifications(tx, {
    event: 'wo.status_changed',
    recipients: [wo.createdBy, ...(await watchersOf(tx, wo.id))],
    actorId: a.user.id,
    projectId: wo.projectId,
    entityType: 'wo',
    entityId: wo.id,
    title: `${wo.numberLabel ?? woNumberLabel(wo.seq)}: ${WO_STATUS_LABEL[to]}`,
    body: `${a.user.fullName} · ${wo.title}`,
    url: `/w/${wo.id}`,
  });
}

/** FR-010: Beranda — stat, permintaan bantuan, dan 10 tugas teratas dalam satu request. */
export const homeRoutes = new Hono<AppEnv>().use(requireVerified).get('/', async (c) => {
  const a = authOf(c);
  const { db } = c.var.deps;
  const today = todayWib();
  const in7 = new Date(Date.now() + 7 * 86_400_000 + 7 * 3600_000).toISOString().slice(0, 10);
  const mine = await listQuery(db)
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .where(
      and(
        eq(workOrders.assigneeId, a.user.id),
        isNull(workOrders.deletedAt),
        isNull(projects.deletedAt),
        sql`${workOrders.status} not in ('done','canceled')`,
      ),
    );
  const tasks = mine
    .map((r) => shapeRow(r, today))
    .sort(
      (x, y) =>
        Number(y.overdue) - Number(x.overdue) ||
        Number(y.urgent) - Number(x.urgent) ||
        x.deadline.localeCompare(y.deadline),
    );
  const managed = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, a.user.id), eq(projectMembers.isProjectManager, true)));
  const managedIds = managed.map((m) => m.id);
  const helpRows = await db
    .select({
      woId: workOrders.id,
      numberLabel: workOrders.numberLabel,
      title: workOrders.title,
      projectId: workOrders.projectId,
      projectName: projects.name,
      requestedBy: users.fullName,
      createdAt: helpRequests.createdAt,
      excerpt: sql<string>`(select l.body from logbook_entries l where l.wo_id = ${workOrders.id} and l.kind = 'help_request' order by l.created_at desc limit 1)`,
    })
    .from(helpRequests)
    .innerJoin(workOrders, eq(workOrders.id, helpRequests.woId))
    .innerJoin(projects, eq(projects.id, workOrders.projectId))
    .innerJoin(users, eq(users.id, helpRequests.requestedBy))
    .where(
      and(
        eq(helpRequests.status, 'open'),
        isNull(workOrders.deletedAt),
        managedIds.length
          ? or(inArray(workOrders.projectId, managedIds), eq(helpRequests.requestedBy, a.user.id))
          : eq(helpRequests.requestedBy, a.user.id),
      ),
    )
    .orderBy(desc(helpRequests.createdAt));
  return c.json({
    stats: {
      myTasks: tasks.length,
      urgent: tasks.filter((t) => t.urgent).length,
      dueSoon: tasks.filter((t) => t.deadline >= today && t.deadline <= in7).length,
      help: helpRows.length,
    },
    help: helpRows.slice(0, 3),
    tasks: tasks.slice(0, 10),
  });
});
