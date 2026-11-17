import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { attachments, auditLogs, projectMembers, projects, users } from '../src/db/schema';
import { closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);
type User = Awaited<ReturnType<typeof createUser>>;
async function staged(user: User, opts: { mime?: string; deletedAt?: Date } = {}) {
  const id = randomUUID();
  await testDb()
    .insert(attachments)
    .values({
      id,
      ownerType: 'user',
      ownerId: user.id,
      category: 'photo',
      fileName: 'gambar.webp',
      mime: opts.mime ?? 'image/webp',
      sizeBytes: 100,
      sha256: id,
      storageKey: `test/${id}`,
      uploadedBy: user.id,
      deletedAt: opts.deletedAt,
    });
  return id;
}
async function fixture() {
  const { app } = makeApp();
  const manager = await createUser({ role: 'manager' });
  const { a } = await login(app, manager.username, manager.password!);
  const body = {
    clientName: 'Klien media',
    rpoNumber: `RPO-${randomUUID()}`,
    name: 'Project media',
    startDate: '2026-11-16',
    endDate: '2026-12-16',
    logoAttachmentId: await staged(manager),
    bannerAttachmentId: await staged(manager),
  };
  const created = await a.post('/api/projects', body);
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const detail = () => a.get(`/api/projects/${id}`).then((r) => r.json());
  const put = (client: typeof a, payload: unknown) =>
    app.request(`/api/projects/${id}/media`, {
      method: 'PUT',
      headers: {
        cookie: [...client.jar].map(([k, v]) => `${k}=${v}`).join('; '),
        'content-type': 'application/json',
        'x-requested-with': 'rein',
      },
      body: JSON.stringify(payload),
    });
  return { app, a, manager, id: id as string, body, detail, put };
}

describe.runIf(hasDb)('foto/logo dan banner project', () => {
  it('menautkan gambar saat create, URL tetap mengikuti akses project', async () => {
    const { app, manager, body, detail, id } = await fixture();
    const p = await detail();
    expect(p.logoUrl).toBe(`/files/${body.logoAttachmentId}/original`);
    expect(p.bannerUrl).toBe(`/files/${body.bannerAttachmentId}/original`);
    const att = await testDb().query.attachments.findFirst({
      where: eq(attachments.id, body.logoAttachmentId),
    });
    expect([att?.ownerType, att?.ownerId, att?.uploadedBy]).toEqual(['project', id, manager.id]);
    const outsider = await createUser();
    const { a: outside } = await login(app, outsider.username, outsider.password!);
    const denied = await app.request(p.logoUrl, {
      headers: { cookie: `rein_sid=${outside.jar.get('rein_sid')}` },
    });
    expect(denied.status).toBe(404);
  });

  it('anggota dengan attachment.upload dan manager di luar scope tidak boleh mengubah gambar; Admin boleh tanpa izin upload umum', async () => {
    const f = await fixture();
    const member = await createUser();
    await testDb().insert(projectMembers).values({
      projectId: f.id,
      userId: member.id,
      projectRole: 'Anggota',
      addedBy: f.manager.id,
    });
    const { a: worker } = await login(f.app, member.username, member.password!);
    const p = await f.detail();
    expect(
      (await f.put(worker, { expectedUpdatedAt: p.updatedAt, logoAttachmentId: null })).status,
    ).toBe(403);
    const otherManager = await createUser({ role: 'manager' });
    const { a: other } = await login(f.app, otherManager.username, otherManager.password!);
    expect(
      (await f.put(other, { expectedUpdatedAt: p.updatedAt, bannerAttachmentId: null })).status,
    ).toBe(403);
    const admin = await createUser({ role: 'admin' });
    const { a: adm } = await login(f.app, admin.username, admin.password!);
    const logoAttachmentId = await staged(admin);
    const saved = await f.put(adm, { expectedUpdatedAt: p.updatedAt, logoAttachmentId });
    expect(saved.status).toBe(200);
    expect((await saved.json()).logoUrl).toBe(`/files/${logoAttachmentId}/original`);
    expect(
      (await f.put(adm, { expectedUpdatedAt: p.updatedAt, bannerAttachmentId: null })).status,
    ).toBe(409);
  });

  it('menolak file asing, bukan gambar, terhapus, atau foto profil dan membatalkan seluruh perubahan', async () => {
    const f = await fixture();
    const p = await f.detail();
    const other = await createUser();
    const avatarId = await staged(f.manager);
    await testDb()
      .update(users)
      .set({ avatarAttachmentId: avatarId })
      .where(eq(users.id, f.manager.id));
    const valid = await staged(f.manager);
    for (const bad of [
      await staged(other),
      await staged(f.manager, { mime: 'application/pdf' }),
      await staged(f.manager, { deletedAt: new Date() }),
      avatarId,
      f.body.logoAttachmentId,
    ]) {
      const res = await f.put(f.a, {
        expectedUpdatedAt: p.updatedAt,
        logoAttachmentId: valid,
        bannerAttachmentId: bad,
      });
      expect(res.status).toBe(422);
      expect((await f.detail()).logoUrl).toBe(p.logoUrl);
      const att = await testDb().query.attachments.findFirst({ where: eq(attachments.id, valid) });
      expect(att?.ownerType).toBe('user');
    }
  });

  it('mengganti/menghapus gambar lama, mempertahankan gambar lainnya dan mencatat audit', async () => {
    const f = await fixture();
    const p = await f.detail();
    const logoAttachmentId = await staged(f.manager);
    const replace = await f.put(f.a, { expectedUpdatedAt: p.updatedAt, logoAttachmentId });
    expect(replace.status).toBe(200);
    const updated = await replace.json();
    expect(updated.bannerUrl).toBe(p.bannerUrl);
    const old = await testDb().query.attachments.findFirst({
      where: eq(attachments.id, f.body.logoAttachmentId),
    });
    expect(old?.deletedAt).not.toBeNull();
    const removed = await f.put(f.a, {
      expectedUpdatedAt: updated.updatedAt,
      logoAttachmentId: null,
      bannerAttachmentId: null,
    });
    expect(removed.status).toBe(200);
    const cleared = await removed.json();
    expect([cleared.logoUrl, cleared.bannerUrl]).toEqual([null, null]);
    for (const id of [logoAttachmentId, f.body.bannerAttachmentId]) {
      const att = await testDb().query.attachments.findFirst({ where: eq(attachments.id, id) });
      expect(att?.deletedAt).not.toBeNull();
    }
    expect(
      (await f.put(f.a, { expectedUpdatedAt: cleared.updatedAt, logoAttachmentId: null })).status,
    ).toBe(200);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, 'project.media_changed')),
      }),
    ).toBeDefined();
    expect(await testDb().query.projects.findFirst({ where: eq(projects.id, f.id) })).toBeDefined();
  });
});
