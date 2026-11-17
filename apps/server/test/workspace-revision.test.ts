import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  attachments,
  auditLogs,
  logbookEntries,
  projectMembers,
  progressEvents,
  workOrders,
  woTypes,
  userPermissions,
} from '../src/db/schema';
import { closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);
async function fixture() {
  const f = makeApp();
  const manager = await createUser({ role: 'manager' });
  const { a } = await login(f.app, manager.username, manager.password!);
  const createProject = async () => {
    const res = await a.post('/api/projects', {
      clientName: 'Klien revisi',
      rpoNumber: randomUUID(),
      name: 'Project revisi',
      startDate: '2026-11-01',
      endDate: '2026-12-31',
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  };
  const id = await createProject();
  const type = await testDb().query.woTypes.findFirst({ where: eq(woTypes.isPunchList, true) });
  const woId = randomUUID();
  const created = await a.post(`/api/projects/${id}/work-orders`, {
    clientId: woId,
    title: 'Punch List belum selesai',
    typeId: type!.id,
    assigneeId: manager.id,
    plannedStart: '2026-11-01',
    deadline: '2026-12-01',
  });
  expect(created.status).toBe(201);
  return { ...f, manager, a, id, woId, createProject };
}
async function file(
  userId: string,
  ownerType: 'project' | 'wo' | 'logbook' | 'user',
  ownerId: string,
  deletedAt: Date | null = null,
) {
  const id = randomUUID();
  await testDb()
    .insert(attachments)
    .values({
      id,
      ownerType,
      ownerId,
      fileName: `${id}.pdf`,
      mime: 'application/pdf',
      sizeBytes: 123,
      sha256: id,
      storageKey: `test/${id}`,
      uploadedBy: userId,
      deletedAt,
    });
  return id;
}
describe.skipIf(!hasDb)('Revisi project, logbook, lampiran dan Beranda', () => {
  it('staging milik sendiri tetap memerlukan izin unggah saat dilampirkan ke WO atau logbook', async () => {
    const f = await fixture();
    const stagingId = await file(f.manager.id, 'user', f.manager.id);
    await testDb()
      .insert(userPermissions)
      .values({ userId: f.manager.id, permissionKey: 'attachment.upload', scope: 'none' });
    const source = await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) });
    const wo = {
      clientId: randomUUID(),
      title: 'WO tanpa izin lampiran',
      typeId: source!.typeId,
      assigneeId: f.manager.id,
      plannedStart: '2026-11-01',
      deadline: '2026-12-01',
      attachmentIds: [stagingId],
    };
    expect((await f.a.post(`/api/projects/${f.id}/work-orders`, wo)).status).toBe(403);
    expect(
      await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, wo.clientId) }),
    ).toBeUndefined();
    expect(
      (await f.a.post(`/api/projects/${f.id}/work-orders`, { ...wo, attachmentIds: [] })).status,
    ).toBe(201);
    const entry = {
      clientId: randomUUID(),
      body: 'Catatan dengan staging',
      attachmentIds: [stagingId],
    };
    expect((await f.a.post(`/api/work-orders/${f.woId}/logbook`, entry)).status).toBe(403);
    expect(
      (await f.a.post(`/api/work-orders/${f.woId}/logbook`, { ...entry, attachmentIds: [] }))
        .status,
    ).toBe(201);
    expect(
      (await testDb().query.attachments.findFirst({ where: eq(attachments.id, stagingId) }))!
        .ownerType,
    ).toBe('user');
  });
  it('project dapat ditandai Selesai manual meski punch list masih terbuka tanpa BAST/tanggal serah terima', async () => {
    const f = await fixture();
    const detail = await (await f.a.get(`/api/projects/${f.id}`)).json();
    expect(detail.completion).toBeUndefined();
    expect(detail.handoverDate).toBeUndefined();
    const member = await createUser();
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: member.id,
      projectRole: 'Anggota',
      addedBy: f.manager.id,
    });
    const { a } = await login(f.app, member.username, member.password!);
    expect((await a.post(`/api/projects/${f.id}/status`, { status: 'done' })).status).toBe(403);
    expect((await f.a.post(`/api/projects/${f.id}/status`, { status: 'done' })).status).toBe(200);
    expect((await (await f.a.get(`/api/projects/${f.id}`)).json()).status).toBe('done');
    expect((await (await f.a.get(`/api/projects/${f.id}`)).json()).can.createWo).toBe(false);
    expect(
      (await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) }))!.status,
    ).toBe('todo');
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, 'project.status_changed')),
      }),
    ).toBeTruthy();
  });
  it('logbook catatan/lampiran idempoten tidak mengubah progres atau status; payload lama ditolak', async () => {
    const f = await fixture();
    const before = await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) });
    const body = { clientId: randomUUID(), body: 'Pemeriksaan dimensi selesai' };
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          ...body,
          progress: 100,
          status: 'done',
        })
      ).status,
    ).toBe(422);
    expect(
      (await f.a.post(`/api/work-orders/${f.woId}/logbook`, { clientId: randomUUID(), body: '' }))
        .status,
    ).toBe(422);
    const first = await f.a.post(`/api/work-orders/${f.woId}/logbook`, body);
    expect(first.status).toBe(201);
    const { id } = await first.json();
    expect(await (await f.a.post(`/api/work-orders/${f.woId}/logbook`, body)).json()).toMatchObject(
      { id, duplicate: true },
    );
    const after = await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) });
    expect([after!.progress, after!.status]).toEqual([before!.progress, before!.status]);
    const events = await testDb()
      .select()
      .from(progressEvents)
      .where(eq(progressEvents.woId, f.woId));
    expect(events).toHaveLength(1);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'logbook.created')),
      }),
    ).toBeTruthy();
  });
  it('lampiran Project merangkum project, WO, logbook; menyaring project lain dan entitas dihapus', async () => {
    const f = await fixture();
    const result = await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
      clientId: randomUUID(),
      body: 'Foto inspeksi',
    });
    const entry = (await result.json()).id as string;
    const projectFile = await file(f.manager.id, 'project', f.id);
    const woFile = await file(f.manager.id, 'wo', f.woId);
    const logFile = await file(f.manager.id, 'logbook', entry);
    await file(f.manager.id, 'project', await f.createProject());
    await file(f.manager.id, 'wo', f.woId, new Date());
    let rows = (await (await f.a.get(`/api/projects/${f.id}/attachments`)).json()).attachments;
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(
      [projectFile, woFile, logFile].sort(),
    );
    expect(rows.find((r: { id: string }) => r.id === logFile).ownerType).toBe('logbook');
    await testDb()
      .update(logbookEntries)
      .set({ deletedAt: new Date() })
      .where(eq(logbookEntries.id, entry));
    rows = (await (await f.a.get(`/api/projects/${f.id}/attachments`)).json()).attachments;
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([projectFile, woFile].sort());
    await testDb()
      .update(workOrders)
      .set({ deletedAt: new Date() })
      .where(eq(workOrders.id, f.woId));
    rows = (await (await f.a.get(`/api/projects/${f.id}/attachments`)).json()).attachments;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([projectFile]);
    const outsider = await createUser();
    const { a } = await login(f.app, outsider.username, outsider.password!);
    expect((await a.get(`/api/projects/${f.id}/attachments`)).status).toBe(404);
    expect((await a.get(`/api/projects/${f.id}/scurve`)).status).toBe(404);
  });
  it('file logbook dari WO yang dihapus tidak dapat diunduh lagi', async () => {
    const f = await fixture();
    const entry = (
      await (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          body: 'Lampiran inspeksi',
        })
      ).json()
    ).id;
    const attachment = await file(f.manager.id, 'logbook', entry);
    await testDb()
      .update(workOrders)
      .set({ deletedAt: new Date() })
      .where(eq(workOrders.id, f.woId));
    expect((await f.a.get(`/files/${attachment}/original`)).status).toBe(404);
  });

  it('S-Curve memakai histori asli, mendukung filter, dan memvalidasi query', async () => {
    const f = await fixture();
    await testDb()
      .update(workOrders)
      .set({ progress: 50, status: 'in_progress' })
      .where(eq(workOrders.id, f.woId));
    await testDb()
      .insert(progressEvents)
      .values({ woId: f.woId, progress: 50, status: 'in_progress' });
    const data = await (await f.a.get(`/api/projects/${f.id}/scurve`)).json();
    expect(data.actual).toBe(50);
    expect(data.points.length).toBeLessThanOrEqual(120);
    expect(data.weights[0]).toMatchObject({ id: f.woId, weight: 100, contribution: 50 });
    expect(
      (await (await f.a.get(`/api/projects/${f.id}/scurve?urgent=true`)).json()).weights,
    ).toEqual([]);
    expect((await f.a.get(`/api/projects/${f.id}/scurve?category=rahasia`)).status).toBe(422);
  });
  it('izin Melihat S-Curve dapat dicabut per pengguna tanpa mencabut akses project', async () => {
    const f = await fixture();
    await testDb()
      .insert(userPermissions)
      .values({ userId: f.manager.id, permissionKey: 'view.scurve', scope: 'none' });
    expect((await f.a.get(`/api/projects/${f.id}/scurve`)).status).toBe(403);
    const detail = await f.a.get(`/api/projects/${f.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).can.scurve).toBe(false);
  });

  it('Beranda berisi tugas asli dan tidak membocorkan WO setelah keanggotaan dicabut', async () => {
    const f = await fixture();
    const member = await createUser();
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: member.id,
      projectRole: 'Anggota',
      addedBy: f.manager.id,
    });
    await testDb()
      .update(workOrders)
      .set({ assigneeId: member.id, urgent: true })
      .where(eq(workOrders.id, f.woId));
    const { a } = await login(f.app, member.username, member.password!);
    let data = await (await a.get('/api/home')).json();
    expect(data.stats.myTasks).toBe(1);
    expect(data.stats.urgent).toBe(1);
    expect(data.tasks[0].id).toBe(f.woId);
    await testDb()
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, f.id), eq(projectMembers.userId, member.id)));
    data = await (await a.get('/api/home')).json();
    expect(data.tasks).toEqual([]);
    expect(data.stats.myTasks).toBe(0);
  });
  it('daftar tugas Beranda dapat dimuat bertahap tanpa memotong akses tugas lainnya', async () => {
    const f = await fixture();
    const type = await testDb().query.woTypes.findFirst();
    for (let i = 0; i < 11; i++) {
      const created = await f.a.post(`/api/projects/${f.id}/work-orders`, {
        clientId: randomUUID(),
        title: `Tugas tambahan ${i}`,
        typeId: type!.id,
        assigneeId: f.manager.id,
        plannedStart: '2026-11-01',
        deadline: '2026-12-01',
      });
      expect(created.status).toBe(201);
    }
    const first = await (await f.a.get('/api/home')).json();
    expect(first.stats.myTasks).toBe(12);
    expect(first.tasks).toHaveLength(10);
    expect(first.nextOffset).toBe(10);
    const rest = await (await f.a.get(`/api/home?offset=${first.nextOffset}&limit=30`)).json();
    expect(rest.tasks).toHaveLength(2);
    expect(rest.nextOffset).toBeNull();
    expect(new Set([...first.tasks, ...rest.tasks].map((t: { id: string }) => t.id)).size).toBe(12);
    expect((await f.a.get('/api/home?limit=999')).status).toBe(422);
  });
});
