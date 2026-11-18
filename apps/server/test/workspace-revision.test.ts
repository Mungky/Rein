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
  projectMaterials,
  workOrderMaterials,
  woReferences,
} from '../src/db/schema';
import { subscribeUser, type BusEvent } from '../src/notify/bus';
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
  it('mengedit dan menyembunyikan catatan sendiri tanpa menghapus riwayat progres', async () => {
    const f = await fixture();
    const outsider = await createUser();
    const { a: other } = await login(f.app, outsider.username, outsider.password!);
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: outsider.id,
      projectRole: 'Engineer',
      addedBy: f.manager.id,
    });
    const att = await file(f.manager.id, 'user', f.manager.id);
    const wo = `/api/work-orders/${f.woId}`;
    const created = await f.a.post(`${wo}/logbook`, {
      clientId: randomUUID(),
      expectedUpdatedAt: (await (await f.a.get(wo)).json()).updatedAt,
      progress: 30,
      body: 'Catatan awal',
      attachmentIds: [att],
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const url = `${wo}/logbook/${id}`;
    const body = { expectedEditedAt: null, body: 'Catatan koreksi' };
    expect((await other.patch(url, body)).status).toBe(403);
    expect((await f.a.patch(url, body)).status).toBe(200);
    expect((await f.a.patch(url, body)).status).toBe(409);
    const modified = (await (await f.a.get(`${wo}/logbook`)).json()).entries[0];
    expect(modified).toMatchObject({
      body: 'Catatan koreksi',
      editedAt: expect.any(String),
      canEdit: true,
      attachments: [expect.objectContaining({ id: att })],
    });
    const version = { expectedEditedAt: modified.editedAt };
    await testDb()
      .update(logbookEntries)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(logbookEntries.id, id));
    expect((await f.a.delete(url, version)).status).toBe(403);
    await testDb()
      .update(logbookEntries)
      .set({ createdAt: new Date() })
      .where(eq(logbookEntries.id, id));
    expect((await f.a.delete(url, version)).status).toBe(200);
    expect((await (await f.a.get(`${wo}/logbook`)).json()).entries).not.toContainEqual(
      expect.objectContaining({ id }),
    );
    expect(
      (await (await f.a.get(`/api/projects/${f.id}/attachments`)).json()).attachments,
    ).not.toContainEqual(expect.objectContaining({ id: att }));
    expect(
      await testDb().query.progressEvents.findFirst({
        where: eq(progressEvents.sourceEntryId, id),
      }),
    ).toMatchObject({ progress: 30 });
    expect((await (await f.a.get(wo)).json()).progress).toBe(30);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'logbook.updated')),
      }),
    ).toMatchObject({
      diffJson: { before: 'Catatan awal', after: 'Catatan koreksi', woId: f.woId },
    });
  });

  it('memvalidasi perubahan info project dan menampilkannya di daftar dan detail', async () => {
    const f = await fixture();
    const url = `/api/projects/${f.id}`;
    const second = await f.createProject();
    const before = await (await f.a.get(url)).json();
    const other = await (await f.a.get(`/api/projects/${second}`)).json();
    const expectedUpdatedAt = before.updatedAt;
    expect(
      await (await f.a.patch(url, { expectedUpdatedAt, rpoNumber: other.rpoNumber })).json(),
    ).toMatchObject({ error: { fields: { rpoNumber: expect.stringContaining(other.name) } } });
    expect((await f.a.patch(url, { expectedUpdatedAt, endDate: '2026-10-31' })).status).toBe(422);
    const changes = {
      name: 'Nama baru project',
      clientName: 'Klien baru',
      rpoNumber: randomUUID(),
      location: 'Bandung',
      description: 'Catatan project',
      startDate: '2026-11-03',
      endDate: '2026-12-22',
    };
    expect((await f.a.patch(url, { expectedUpdatedAt, ...changes })).status).toBe(200);
    expect(await (await f.a.get(url)).json()).toMatchObject({
      name: changes.name,
      client: { name: changes.clientName },
      rpoNumber: changes.rpoNumber,
      location: changes.location,
      description: changes.description,
      startDate: changes.startDate,
      endDate: changes.endDate,
    });
    expect((await (await f.a.get('/api/projects')).json()).projects).toContainEqual(
      expect.objectContaining({ id: f.id, name: changes.name }),
    );
  });

  it('mengatur Jenis WO dan menolak penghapusan jenis yang dipakai', async () => {
    const f = await fixture();
    const admin = await createUser({ role: 'admin' });
    const { a } = await login(f.app, admin.username, admin.password!);
    const path = '/api/admin/wo-types';
    const engineer = await createUser();
    const { a: unauthorized } = await login(f.app, engineer.username, engineer.password!);
    expect((await unauthorized.get(path)).status).toBe(403);
    const code = Array.from(randomUUID().replaceAll('-', '').slice(0, 4), (c) =>
      String.fromCharCode(65 + parseInt(c, 16)),
    ).join('');
    const created = await a.post(path, { name: `Jenis audit ${code}`, code, category: 'general' });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    try {
      expect(
        (
          await a.patch(`${path}/${id}`, {
            active: false,
            name: `Jenis baru ${code}`,
            category: 'production',
          })
        ).status,
      ).toBe(200);
      const rows = (await (await a.get(path)).json()).types;
      expect(rows.find((row: { id: string }) => row.id === id)).toMatchObject({
        active: false,
        name: `Jenis baru ${code}`,
        category: 'production',
      });
      const ids = [id, ...rows.flatMap((row: { id: string }) => (row.id !== id ? [row.id] : []))];
      expect(
        (
          await f.app.request(`${path}/order`, {
            method: 'PUT',
            headers: {
              'x-requested-with': 'rein',
              'content-type': 'application/json',
              cookie: [...a.jar].map(([k, v]) => `${k}=${v}`).join('; '),
            },
            body: JSON.stringify({ ids }),
          })
        ).status,
      ).toBe(200);
      expect((await (await a.get(path)).json()).types[0].id).toBe(id);
      const wo = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
      expect((await a.delete(`${path}/${wo.type.id}`, {})).status).toBe(409);
    } finally {
      await a.delete(`${path}/${id}`, {});
    }
  });
  it('menyegarkan Beranda peminta bantuan yang bukan PIC atau pengikut WO', async () => {
    const f = await fixture();
    const engineer = await createUser();
    const { a: requester } = await login(f.app, engineer.username, engineer.password!);
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: engineer.id,
      projectRole: 'Engineer',
      addedBy: f.manager.id,
    });
    const url = `/api/work-orders/${f.woId}`;
    const before = await (await requester.get(url)).json();
    expect(before.isWatching).toBe(false);
    expect(before.assignee.id).not.toBe(engineer.id);
    expect(
      (
        await requester.post(`${url}/help`, {
          clientId: randomUUID(),
          body: 'Butuh instruksi',
          showFlag: true,
        })
      ).status,
    ).toBe(201);
    expect((await (await requester.get('/api/home')).json()).stats.help).toBe(1);
    const live: BusEvent[] = [];
    const unsubscribe = subscribeUser(engineer.id, (event) => live.push(event));
    try {
      expect(
        (
          await f.a.post(`${url}/help/reply`, {
            clientId: randomUUID(),
            body: 'Instruksi dibagikan',
            resolve: true,
          })
        ).status,
      ).toBe(201);
      expect(live).toContainEqual({ type: 'notification' });
      expect(live).toContainEqual({ type: 'wo', projectId: f.id, woId: f.woId });
      expect(await (await requester.get('/api/home')).json()).toMatchObject({
        stats: { help: 0 },
        help: [],
      });
    } finally {
      unsubscribe();
    }
  });
  it('menolak edit WO yang basi pada field berbeda dan field yang sama', async () => {
    const f = await fixture();
    const engineer = await createUser();
    const { a: pic } = await login(f.app, engineer.username, engineer.password!);
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: engineer.id,
      projectRole: 'Engineer',
      addedBy: f.manager.id,
    });
    const url = `/api/work-orders/${f.woId}`;
    const created = await (await f.a.get(url)).json();
    expect(
      (await f.a.patch(url, { expectedUpdatedAt: created.updatedAt, assigneeId: engineer.id }))
        .status,
    ).toBe(200);
    const before = await (await pic.get(url)).json();
    expect(before.can).toMatchObject({ editCore: false, editDetail: true, editWeight: false });
    expect(
      (await pic.patch(url, { expectedUpdatedAt: before.updatedAt, title: 'Terlarang' })).status,
    ).toBe(403);
    expect(
      (await pic.patch(url, { expectedUpdatedAt: before.updatedAt, detail: 'Detail PIC' })).status,
    ).toBe(200);
    for (const patch of [{ title: 'Judul Manager' }, { detail: 'Detail Manager' }]) {
      const stale = await f.a.patch(url, { expectedUpdatedAt: before.updatedAt, ...patch });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: 'STALE' } });
    }
    const current = await (await f.a.get(url)).json();
    expect(current).toMatchObject({ title: before.title, detail: 'Detail PIC' });
    const nextType = await testDb().query.woTypes.findFirst({
      where: eq(woTypes.isPunchList, false),
    });
    expect(
      (await f.a.patch(url, { expectedUpdatedAt: current.updatedAt, plannedStart: '2026-12-02' }))
        .status,
    ).toBe(422);
    expect(
      (
        await f.a.patch(url, {
          expectedUpdatedAt: current.updatedAt,
          plannedStart: '2026-11-05',
          typeId: nextType!.id,
        })
      ).status,
    ).toBe(200);
    expect(await (await f.a.get(url)).json()).toMatchObject({
      plannedStart: '2026-11-05',
      type: { id: nextType!.id },
    });
  });

  it('hanya satu penulisan bersamaan dapat menggunakan versi WO yang sama', async () => {
    const f = await fixture();
    const url = `/api/work-orders/${f.woId}`;
    const { updatedAt } = await (await f.a.get(url)).json();
    const results = await Promise.all([
      f.a.patch(url, { expectedUpdatedAt: updatedAt, detail: 'Simpanan pertama' }),
      f.a.patch(url, { expectedUpdatedAt: updatedAt, detail: 'Simpanan kedua' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('progres Logbook opsional disimpan atomik, idempoten, tercatat dalam S-Curve dan status catatan terpisah', async () => {
    const f = await fixture();
    const before = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    const payload = {
      clientId: randomUUID(),
      progress: 45,
      category: 'activity',
      expectedUpdatedAt: before.updatedAt,
    };
    const created = await f.a.post(`/api/work-orders/${f.woId}/logbook`, payload);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await f.a.post(`/api/work-orders/${f.woId}/logbook`, payload)).status).toBe(200);
    const after = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    expect([after.progress, after.status]).toEqual([45, before.status]);
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          ...payload,
          expectedUpdatedAt: after.updatedAt,
        })
      ).status,
    ).toBe(200);
    const entry = await testDb().query.logbookEntries.findFirst({
      where: eq(logbookEntries.id, id),
    });
    expect(entry).toMatchObject({ category: 'activity', progressFrom: 0, progressTo: 45 });
    const event = await testDb().query.progressEvents.findFirst({
      where: eq(progressEvents.sourceEntryId, id),
    });
    expect(event).toMatchObject({ progress: 45, status: before.status });
    const curve = await (await f.a.get(`/api/projects/${f.id}/scurve`)).json();
    expect(JSON.stringify(curve)).toContain('45');
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          ...payload,
          clientId: randomUUID(),
          progress: 50,
        })
      ).status,
    ).toBe(409);
    expect(
      await testDb()
        .select()
        .from(logbookEntries)
        .where(eq(logbookEntries.clientUuid, payload.clientId)),
    ).toHaveLength(1);
  });
  it('dua progres bersamaan tidak saling menimpa; perubahan status membaca progres terbaru', async () => {
    const f = await fixture();
    const current = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    const results = await Promise.all(
      [30, 60].map((progress) =>
        f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          progress,
          expectedUpdatedAt: current.updatedAt,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const after = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/status`, {
          status: 'in_progress',
          expectedUpdatedAt: current.updatedAt,
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.a.post(`/api/work-orders/${f.woId}/status`, { status: 'in_progress' })).status,
    ).toBe(200);
    expect((await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).progress).toBe(
      after.progress,
    );
  });
  it('anggota dapat mencatat Dokumen/Kendala tetapi tidak mengubah progres WO orang lain; override izin dihormati', async () => {
    const f = await fixture();
    const u = await createUser();
    await testDb()
      .insert(projectMembers)
      .values({ projectId: f.id, userId: u.id, projectRole: 'Anggota', addedBy: f.manager.id });
    const { a } = await login(f.app, u.username, u.password!);
    const wo = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    expect(
      (
        await a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          body: 'Dokumen diperiksa',
          category: 'document',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          body: 'Kendala bahan',
          category: 'issue',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          progress: 10,
          expectedUpdatedAt: wo.updatedAt,
        })
      ).status,
    ).toBe(403);
    await testDb()
      .insert(userPermissions)
      .values({ userId: f.manager.id, permissionKey: 'wo.edit.any', scope: 'none' });
    await testDb()
      .insert(userPermissions)
      .values({ userId: f.manager.id, permissionKey: 'wo.edit.own', scope: 'none' });
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          progress: 10,
          expectedUpdatedAt: wo.updatedAt,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          body: 'Catatan tetap boleh',
        })
      ).status,
    ).toBe(201);
  });
  it('Review memerlukan Logbook dan Selesai hanya oleh pembuat/izin edit semua; progres WO tertutup dilindungi', async () => {
    const f = await fixture();
    expect(
      (await f.a.post(`/api/work-orders/${f.woId}/status`, { status: 'in_progress' })).status,
    ).toBe(200);
    const detail = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    expect(detail.statusHint).toContain('Logbook');
    expect(detail.can.statusTargets).not.toContain('review');
    expect((await f.a.post(`/api/work-orders/${f.woId}/status`, { status: 'review' })).status).toBe(
      422,
    );
    await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
      clientId: randomUUID(),
      body: 'Hasil pekerjaan',
    });
    expect((await f.a.post(`/api/work-orders/${f.woId}/status`, { status: 'review' })).status).toBe(
      200,
    );
    expect((await f.a.post(`/api/work-orders/${f.woId}/status`, { status: 'done' })).status).toBe(
      200,
    );
    const done = await (await f.a.get(`/api/work-orders/${f.woId}`)).json();
    expect(done.progress).toBe(100);
    expect(done.can.updateProgress).toBe(false);
    expect(
      (
        await f.a.post(`/api/work-orders/${f.woId}/logbook`, {
          clientId: randomUUID(),
          progress: 20,
          expectedUpdatedAt: done.updatedAt,
        })
      ).status,
    ).toBe(422);
  });
  it('Material input manual/impor atomik dan idempoten, edit dengan versi, izin project dan audit', async () => {
    const f = await fixture();
    const rows = [
      {
        clientId: randomUUID(),
        partNo: '001',
        description: 'Frame',
        material: 'AISI 304',
        specification: '50 x 50',
        quantity: 4,
        unit: 'Btg',
      },
      {
        clientId: randomUUID(),
        description: 'Plate',
        quantity: 2,
        unit: 'Lbr',
        status: 'po',
        receivedAt: '2026-11-18',
      },
    ];
    const endpoint = `/api/projects/${f.id}/materials`;
    expect((await f.a.post(endpoint, { rows })).status).toBe(201);
    expect(await (await f.a.post(endpoint, { rows })).json()).toMatchObject({ inserted: 0 });
    const list = await (await f.a.get(endpoint)).json();
    expect(list.canManage).toBe(true);
    expect(list.materials).toHaveLength(2);
    const item = list.materials.find((r: { id: string }) => r.id === rows[0]!.clientId);
    const update = {
      ...rows[0]!,
      clientId: undefined,
      status: 'in_stock',
      expectedUpdatedAt: item.updatedAt,
    };
    expect((await f.a.patch(`${endpoint}/${item.id}`, update)).status).toBe(200);
    expect((await f.a.patch(`${endpoint}/${item.id}`, update)).status).toBe(409);
    expect(
      (
        await f.a.post(endpoint, {
          rows: [
            { ...rows[0], clientId: randomUUID() },
            { ...rows[1], clientId: randomUUID(), quantity: 0 },
          ],
        })
      ).status,
    ).toBe(422);
    expect((await (await f.a.get(endpoint)).json()).materials).toHaveLength(2);
    const outsider = await createUser();
    const { a } = await login(f.app, outsider.username, outsider.password!);
    expect((await a.get(endpoint)).status).toBe(404);
    expect((await a.post(endpoint, { rows })).status).toBe(404);
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: outsider.id,
      projectRole: 'Purchasing',
      addedBy: f.manager.id,
    });
    expect(
      (
        await a.post(endpoint, {
          rows: [{ ...rows[0], description: 'Frame kedua', clientId: randomUUID() }],
        })
      ).status,
    ).toBe(201);
    await testDb()
      .insert(userPermissions)
      .values({ userId: outsider.id, permissionKey: 'wo.create', scope: 'none' });
    expect(
      (await a.post(endpoint, { rows: [{ ...rows[0], clientId: randomUUID() }] })).status,
    ).toBe(403);
    expect((await a.patch(`${endpoint}/${item.id}`, update)).status).toBe(403);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, 'material.updated')),
      }),
    ).toBeTruthy();
    expect(
      (await testDb().query.projectMaterials.findFirst({
        where: eq(projectMaterials.id, item.id),
      }))!.status,
    ).toBe('in_stock');
  });
  it('Material duplikat manual, impor, dan dua request bersamaan dilewati tanpa menimpa jumlah atau catatan', async () => {
    const f = await fixture();
    const endpoint = `/api/projects/${f.id}/materials`;
    const row = {
      partNo: 'M-01',
      description: 'Base plate',
      material: 'AISI 304',
      specification: '105 x 105',
      quantity: 4,
      unit: 'Pcs',
      note: 'Catatan awal',
    };
    expect(
      await (await f.a.post(endpoint, { rows: [{ ...row, clientId: randomUUID() }] })).json(),
    ).toEqual({ inserted: 1, skipped: 0 });
    const copy = {
      ...row,
      partNo: 'm-01',
      description: '  BASE   plate ',
      quantity: 99,
      status: 'po',
      note: 'Jangan menimpa catatan awal',
    };
    expect(
      await (await f.a.post(endpoint, { rows: [{ ...copy, clientId: randomUUID() }] })).json(),
    ).toEqual({ inserted: 0, skipped: 1 });
    expect(
      await (
        await f.a.post(endpoint, {
          rows: [
            { ...copy, clientId: randomUUID() },
            { ...row, partNo: 'M-02', clientId: randomUUID() },
            { ...row, partNo: 'M-02', clientId: randomUUID() },
          ],
        })
      ).json(),
    ).toEqual({ inserted: 1, skipped: 2 });
    const requests = await Promise.all(
      [1, 2].map(() =>
        f.a.post(endpoint, { rows: [{ ...row, partNo: 'M-03', clientId: randomUUID() }] }),
      ),
    );
    expect(
      (await Promise.all(requests.map((r) => r.json()))).map((r) => r.inserted).sort(),
    ).toEqual([0, 1]);
    const list = (await (await f.a.get(endpoint)).json()).materials;
    expect(list).toHaveLength(3);
    const original = list.find((r: { partNo: string }) => r.partNo === 'M-01');
    expect(original).toMatchObject({ quantity: 4, note: 'Catatan awal', status: 'not_available' });
    const { clientId: _id, ...values } = { ...row, clientId: randomUUID() };
    expect(
      (
        await f.a.patch(
          `${endpoint}/${list.find((r: { partNo: string }) => r.partNo === 'M-02').id}`,
          {
            ...values,
            expectedUpdatedAt: list.find((r: { partNo: string }) => r.partNo === 'M-02').updatedAt,
          },
        )
      ).status,
    ).toBe(409);
    const other = await f.createProject();
    expect(
      (
        await f.a.post(`/api/projects/${other}/materials`, {
          rows: [{ ...row, clientId: randomUUID() }],
        })
      ).status,
    ).toBe(201);
  });
  it('Material dapat di-attach ke beberapa WO, lepas idempoten; sumber/WO lintas project ditolak', async () => {
    const f = await fixture();
    const endpoint = `/api/projects/${f.id}/materials`;
    const materialId = randomUUID();
    await f.a.post(endpoint, {
      rows: [{ clientId: materialId, description: 'Frame', quantity: 4, unit: 'Btg' }],
    });
    const link = `${endpoint}/${materialId}/work-orders`;
    expect((await f.a.post(link, { woId: f.woId })).status).toBe(200);
    expect((await f.a.post(link, { woId: f.woId })).status).toBe(200);
    expect(
      (await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).materials.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([materialId]);
    const wo = await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) });
    const wo2 = randomUUID();
    await f.a.post(`/api/projects/${f.id}/work-orders`, {
      clientId: wo2,
      title: 'WO kedua',
      typeId: wo!.typeId,
      assigneeId: f.manager.id,
      deadline: '2026-12-01',
    });
    await f.a.post(link, { woId: wo2 });
    expect((await (await f.a.get(endpoint)).json()).materials[0].woLinks).toHaveLength(2);
    expect(
      await testDb()
        .select()
        .from(workOrderMaterials)
        .where(eq(workOrderMaterials.materialId, materialId)),
    ).toHaveLength(2);
    const otherProject = await f.createProject();
    const foreignWo = randomUUID();
    await f.a.post(`/api/projects/${otherProject}/work-orders`, {
      clientId: foreignWo,
      title: 'WO project lain',
      typeId: wo!.typeId,
      assigneeId: f.manager.id,
      deadline: '2026-12-01',
    });
    expect((await f.a.post(link, { woId: foreignWo })).status).toBe(404);
    expect(
      (
        await f.a.post(`/api/projects/${otherProject}/materials/${materialId}/work-orders`, {
          woId: foreignWo,
        })
      ).status,
    ).toBe(404);
    expect((await f.a.delete(link, { woId: f.woId })).status).toBe(200);
    expect((await f.a.delete(link, { woId: f.woId })).status).toBe(200);
    expect((await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).materials).toEqual([]);
    expect((await (await f.a.get(`/api/work-orders/${wo2}`)).json()).materials).toHaveLength(1);
    await testDb().update(workOrders).set({ deletedAt: new Date() }).where(eq(workOrders.id, wo2));
    expect((await (await f.a.get(endpoint)).json()).materials[0].woLinks).toEqual([]);
    for (const action of ['material.linked', 'material.unlinked'])
      expect(
        await testDb().query.auditLogs.findFirst({
          where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, action)),
        }),
      ).toBeTruthy();
  });
  it('hapus material menjaga riwayat, menyembunyikan dari WO, bisa dibatalkan dan mencegah pemulihan duplikat', async () => {
    const f = await fixture();
    const endpoint = `/api/projects/${f.id}/materials`;
    const row = { clientId: randomUUID(), description: 'Frame', quantity: 4, unit: 'Btg' };
    await f.a.post(endpoint, { rows: [row] });
    await f.a.post(`${endpoint}/${row.clientId}/work-orders`, { woId: f.woId });
    const current = (await (await f.a.get(endpoint)).json()).materials[0];
    expect(
      (
        await f.a.delete(`${endpoint}/${row.clientId}`, {
          expectedUpdatedAt: '2000-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(409);
    const removed = await f.a.delete(`${endpoint}/${row.clientId}`, {
      expectedUpdatedAt: current.updatedAt,
    });
    expect(removed.status).toBe(200);
    let removedVersion = (await removed.json()).updatedAt;
    expect((await (await f.a.get(endpoint)).json()).materials).toEqual([]);
    expect((await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).materials).toEqual([]);
    expect(
      (await testDb().query.projectMaterials.findFirst({
        where: eq(projectMaterials.id, row.clientId),
      }))!.deletedAt,
    ).toBeTruthy();
    expect(
      (await f.a.post(`${endpoint}/${row.clientId}/work-orders`, { woId: f.woId })).status,
    ).toBe(404);
    expect(
      (
        await f.a.patch(`${endpoint}/${row.clientId}`, {
          ...row,
          clientId: undefined,
          expectedUpdatedAt: current.updatedAt,
        })
      ).status,
    ).toBe(404);
    expect(
      (await f.a.post(`${endpoint}/${row.clientId}/restore`, { expectedUpdatedAt: removedVersion }))
        .status,
    ).toBe(200);
    expect((await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).materials).toHaveLength(1);
    const restored = (await (await f.a.get(endpoint)).json()).materials[0];
    removedVersion = (
      await (
        await f.a.delete(`${endpoint}/${row.clientId}`, { expectedUpdatedAt: restored.updatedAt })
      ).json()
    ).updatedAt;
    await f.a.post(endpoint, { rows: [{ ...row, clientId: randomUUID() }] });
    expect(
      (await f.a.post(`${endpoint}/${row.clientId}/restore`, { expectedUpdatedAt: removedVersion }))
        .status,
    ).toBe(409);
    for (const action of ['material.deleted', 'material.restored'])
      expect(
        await testDb().query.auditLogs.findFirst({
          where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, action)),
        }),
      ).toBeTruthy();
  });
  it('izin Material berlaku untuk hapus, pulihkan, attach dan lepas', async () => {
    const f = await fixture();
    const materialId = randomUUID();
    const endpoint = `/api/projects/${f.id}/materials/${materialId}`;
    await f.a.post(`/api/projects/${f.id}/materials`, {
      rows: [{ clientId: materialId, description: 'Plate', quantity: 2, unit: 'Lbr' }],
    });
    const viewer = await createUser();
    const { a } = await login(f.app, viewer.username, viewer.password!);
    expect((await a.delete(endpoint, { expectedUpdatedAt: new Date().toISOString() })).status).toBe(
      404,
    );
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: viewer.id,
      projectRole: 'Anggota',
      addedBy: f.manager.id,
    });
    await testDb()
      .insert(userPermissions)
      .values({ userId: viewer.id, permissionKey: 'wo.create', scope: 'none' });
    expect((await a.delete(endpoint, { expectedUpdatedAt: new Date().toISOString() })).status).toBe(
      403,
    );
    expect(
      (await a.post(`${endpoint}/restore`, { expectedUpdatedAt: new Date().toISOString() })).status,
    ).toBe(403);
    expect((await a.post(`${endpoint}/work-orders`, { woId: f.woId })).status).toBe(403);
    expect((await a.delete(`${endpoint}/work-orders`, { woId: f.woId })).status).toBe(403);
  });
  it('Attach menghubungkan tanpa memindahkan/menduplikasi file; menolak sumber/WO lintas project dan izin unggah', async () => {
    const f = await fixture();
    const doc = await file(f.manager.id, 'project', f.id);
    const endpoint = `/api/projects/${f.id}/attachments/${doc}/link`;
    expect((await f.a.post(endpoint, { woId: f.woId })).status).toBe(200);
    expect((await f.a.post(endpoint, { woId: f.woId })).status).toBe(200);
    expect(
      (await testDb().query.attachments.findFirst({ where: eq(attachments.id, doc) }))!.ownerType,
    ).toBe('project');
    const refs = await testDb()
      .select()
      .from(woReferences)
      .where(eq(woReferences.attachmentId, doc));
    expect(refs).toHaveLength(1);
    const list = await (await f.a.get(`/api/projects/${f.id}/attachments`)).json();
    expect(list.attachments.find((r: { id: string }) => r.id === doc).woLinks[0].woId).toBe(f.woId);
    expect(
      (await (await f.a.get(`/api/work-orders/${f.woId}`)).json()).attachments.map(
        (r: { id: string }) => r.id,
      ),
    ).toContain(doc);
    const otherProject = await f.createProject();
    expect(
      (await f.a.post(`/api/projects/${otherProject}/attachments/${doc}/link`, { woId: f.woId }))
        .status,
    ).toBe(404);
    const foreignDoc = await file(f.manager.id, 'project', otherProject);
    expect(
      (await f.a.post(`/api/projects/${f.id}/attachments/${foreignDoc}/link`, { woId: f.woId }))
        .status,
    ).toBe(404);
    const wo = await testDb().query.workOrders.findFirst({ where: eq(workOrders.id, f.woId) });
    const foreignWoId = randomUUID();
    await f.a.post(`/api/projects/${otherProject}/work-orders`, {
      clientId: foreignWoId,
      title: 'WO project lain',
      typeId: wo!.typeId,
      assigneeId: f.manager.id,
      deadline: '2026-12-01',
    });
    expect((await f.a.post(endpoint, { woId: foreignWoId })).status).toBe(404);
    await testDb()
      .insert(userPermissions)
      .values({ userId: f.manager.id, permissionKey: 'attachment.upload', scope: 'none' });
    expect((await f.a.post(endpoint, { woId: f.woId })).status).toBe(403);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, 'attachment.linked')),
      }),
    ).toBeTruthy();
  });
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
