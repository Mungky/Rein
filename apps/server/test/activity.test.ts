import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { attachments, auditLogs, logbookEntries, projectMembers } from '../src/db/schema';
import { closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);

async function fixture() {
  const f = makeApp();
  const manager = await createUser({ role: 'manager' });
  const { a } = await login(f.app, manager.username, manager.password!);
  const project = async (name: string) => {
    const result = await a.post('/api/projects', {
      clientName: 'Klien aktivitas',
      rpoNumber: randomUUID(),
      name,
      startDate: '2026-11-01',
      endDate: '2026-12-01',
    });
    expect(result.status).toBe(201);
    return (await result.json()).id as string;
  };
  const projectId = await project('Project aktivitas');
  const type = await testDb().query.woTypes.findFirst();
  const woId = randomUUID();
  const created = await a.post(`/api/projects/${projectId}/work-orders`, {
    clientId: woId,
    title: 'Uji aktivitas WO',
    typeId: type!.id,
    assigneeId: manager.id,
    plannedStart: '2026-11-01',
    deadline: '2026-12-01',
  });
  expect(created.status).toBe(201);
  return { ...f, a, manager, projectId, woId, project };
}

describe.skipIf(!hasDb)('Aktivitas dan Logbook', () => {
  it('membatasi aktivitas ke project yang terlihat dan merangkum mutasi tanpa isi Logbook', async () => {
    const f = await fixture();
    const engineer = await createUser();
    const { a: member } = await login(f.app, engineer.username, engineer.password!);
    await testDb().insert(projectMembers).values({
      projectId: f.projectId,
      userId: engineer.id,
      projectRole: 'Engineer',
      addedBy: f.manager.id,
    });
    const privateProject = await f.project('Project terbatas');
    const path = `/api/work-orders/${f.woId}`;
    const note = await f.a.post(`${path}/logbook`, {
      clientId: randomUUID(),
      body: 'Isi privat catatan contoh',
    });
    expect(note.status).toBe(201);
    const noteId = (await note.json()).id;
    expect((await f.a.post(`${path}/status`, { status: 'in_progress' })).status).toBe(200);
    expect(
      (await f.a.post(`${path}/help`, { clientId: randomUUID(), body: 'Rincian bantuan contoh' }))
        .status,
    ).toBe(201);
    const material = await f.a.post(`/api/projects/${f.projectId}/materials`, {
      source: 'excel',
      rows: [
        { clientId: randomUUID(), partNo: 'CTH', description: 'Gasket', quantity: 1, unit: 'Pcs' },
      ],
    });
    expect(material.status).toBe(201);
    await testDb().insert(attachments).values({
      ownerType: 'project',
      ownerId: f.projectId,
      fileName: 'Spesifikasi.pdf',
      mime: 'application/pdf',
      sizeBytes: 12,
      sha256: randomUUID(),
      storageKey: 'test/example',
      uploadedBy: f.manager.id,
    });
    const response = await member.get('/api/activity?period=all');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'menambahkan Logbook', noteId, woId: f.woId }),
        expect.objectContaining({ text: 'mengubah status WO dari Belum Mulai ke Dikerjakan' }),
        expect.objectContaining({ text: 'mengimpor 1 material', target: 'materials' }),
        expect.objectContaining({ subject: 'Spesifikasi.pdf', target: 'files' }),
      ]),
    );
    expect(JSON.stringify(data)).not.toMatch(
      /Isi privat catatan|Rincian bantuan contoh|Project terbatas/,
    );
    expect((await (await f.a.get('/api/activity?period=all')).json()).items).toContainEqual(
      expect.objectContaining({ projectId: privateProject }),
    );
    const scoped = await f.a.get(`/api/activity?period=all&project=${f.projectId}`);
    expect(scoped.status).toBe(200);
    const scopedIds = (await scoped.json()).items.map(
      (item: { projectId: string }) => item.projectId,
    );
    expect(new Set(scopedIds)).toEqual(new Set([f.projectId]));
    expect((await member.get(`/api/activity?period=all&project=${privateProject}`)).status).toBe(
      404,
    );
    const local = await (await member.get(`/api/activity?period=all&wo=${f.woId}`)).json();
    expect(local.items).toContainEqual(
      expect.objectContaining({ text: 'meminta bantuan', detail: 'Rincian bantuan contoh' }),
    );
    expect(local.items).not.toContainEqual(
      expect.objectContaining({ text: 'menambahkan Logbook' }),
    );
  });

  it('memfilter rentang WIB sebelum paginasi Aktivitas dan mempertahankan pembatas halaman', async () => {
    const f = await fixture();
    const event = {
      actorId: f.manager.id,
      entityId: f.woId,
      entityType: 'wo',
      action: 'wo.updated',
    };
    await testDb()
      .insert(auditLogs)
      .values([
        { ...event, createdAt: new Date('2025-01-05T16:59:59Z') },
        ...Array.from({ length: 21 }, () => ({
          ...event,
          createdAt: new Date('2025-01-05T17:00:00Z'),
        })),
        { ...event, createdAt: new Date('2025-01-12T16:59:59Z') },
        { ...event, createdAt: new Date('2025-01-12T17:00:00Z') },
      ]);
    const route = `/api/activity?date=2025-01-08&wo=${f.woId}&period=week`;
    const first = await (await f.a.get(route)).json();
    const second = await (await f.a.get(route + '&page=2')).json();
    expect(first).toMatchObject({ hasNext: true });
    expect(first.items).toHaveLength(20);
    expect(first.items[0].happenedAt).toBe('2025-01-12T16:59:59.000Z');
    expect(second).toMatchObject({ hasNext: false });
    expect(second.items).toHaveLength(2);
    expect(second.items[1].happenedAt).toBe('2025-01-05T17:00:00.000Z');
    expect(new Set([...first.items, ...second.items].map((entry) => entry.id)).size).toBe(22);
    const nextMonday = await (
      await f.a.get(`/api/activity?period=day&date=2025-01-13&wo=${f.woId}`)
    ).json();
    expect(nextMonday.items.map((entry: { happenedAt: string }) => entry.happenedAt)).toEqual([
      '2025-01-12T17:00:00.000Z',
    ]);
  });

  it('memisahkan entri otomatis sebelum paginasi catatan dan membuka tautan ke catatan lama', async () => {
    const f = await fixture();
    const context = { woId: f.woId, authorId: f.manager.id };
    const sameTime = new Date('2025-01-06T03:30:00Z');
    const notes = await testDb()
      .insert(logbookEntries)
      .values([
        ...Array.from({ length: 24 }, (_, i) => ({
          ...context,
          kind: 'system' as const,
          body: 'Sistem',
          createdAt: new Date(sameTime.getTime() + i + 1),
        })),
        ...Array.from({ length: 21 }, (_, i) => ({
          ...context,
          kind: 'note' as const,
          body: `Pekerjaan ${i}`,
          createdAt: sameTime,
        })),
      ])
      .returning({ id: logbookEntries.id, kind: logbookEntries.kind });
    const path = `/api/work-orders/${f.woId}/logbook?view=notes`;
    const scoped = path + '&date=2025-01-06&period=day';
    const first = await (await f.a.get(scoped)).json();
    const last = await (await f.a.get(scoped + '&before=' + first.nextCursor)).json();
    expect(first.entries).toHaveLength(20);
    expect(last.entries).toHaveLength(1);
    expect([...first.entries, ...last.entries].every((entry) => entry.kind === 'note')).toBe(true);
    expect(new Set([...first.entries, ...last.entries].map((entry) => entry.id)).size).toBe(21);
    const id = notes.find((entry) => entry.kind === 'note')!.id;
    const focused = await (await f.a.get(path + '&entry=' + id)).json();
    expect(focused.entries).toEqual([expect.objectContaining({ id })]);
  });
});
