import { rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { attachments, users } from '../src/db/schema';
import { closeTestDb, createUser, hasDb, login, makeApp, storageRoot, testDb } from './helpers';

afterAll(async () => {
  await closeTestDb();
  await rm(storageRoot, { recursive: true, force: true });
});

type App = ReturnType<typeof makeApp>['app'];

/** Gambar WebP mini (header RIFF/WEBP valid; isi tidak perlu bisa didekode untuk test server). */
function webp(extra = 'x'): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0, 0, 0]),
      Buffer.from('WEBPVP8 '),
      Buffer.from(extra.repeat(32)),
    ]),
  );
}

async function upload(
  app: App,
  cookie: string,
  fields: Record<string, string>,
  files: Array<{ field: string; name: string; data: Uint8Array }>,
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append(f.field, new Blob([f.data]), f.name);
  return app.request('/api/attachments', {
    method: 'POST',
    headers: { cookie, 'x-requested-with': 'rein', 'x-forwarded-for': '10.1.1.1' },
    body: fd,
  });
}

async function session(app: App, opts: Parameters<typeof createUser>[0] = {}) {
  const u = await createUser(opts);
  const { a } = await login(app, u.username, u.password!);
  return { u, a, cookie: `rein_sid=${a.jar.get('rein_sid')}` };
}

describe.skipIf(!hasDb)('lampiran: upload, akses, foto profil', () => {
  it('upload foto profil (original + thumb) → 201, bisa dibuka lewat /files', async () => {
    const { app } = makeApp();
    const { u, cookie } = await session(app);
    const res = await upload(
      app,
      cookie,
      { ownerType: 'user', ownerId: u.id, category: 'photo', width: '256', height: '256' },
      [
        { field: 'file', name: 'avatar.webp', data: webp('a') },
        { field: 'thumb', name: 'thumb.webp', data: webp('t') },
      ],
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mime).toBe('image/webp');

    const row = await testDb().query.attachments.findFirst({ where: eq(attachments.id, body.id) });
    expect(row?.storageKey).toMatch(/^user\/\d{4}\/\d{2}\/[0-9a-f-]+\/original$/);
    expect(row?.thumbKey).toMatch(/\/thumb$/);
    expect(row?.sha256).toHaveLength(64);

    const file = await app.request(`/files/${body.id}/original`, { headers: { cookie } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/webp');
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(8, 12)
        .toString(),
    ).toBe('WEBP');
    const etag = file.headers.get('etag')!;
    const again = await app.request(`/files/${body.id}/thumb`, { headers: { cookie } });
    expect(again.status).toBe(200);
    const cached = await app.request(`/files/${body.id}/original`, {
      headers: { cookie, 'if-none-match': etag },
    });
    expect(cached.status).toBe(304);

    // tanpa sesi → 401
    expect((await app.request(`/files/${body.id}/original`)).status).toBe(401);

    // jadikan foto profil
    const set = await app.request('/api/me/avatar', {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'rein', 'content-type': 'application/json' },
      body: JSON.stringify({ attachmentId: body.id }),
    });
    expect(set.status).toBe(200);
    const user = await testDb().query.users.findFirst({ where: eq(users.id, u.id) });
    expect(user?.avatarAttachmentId).toBe(body.id);
  });

  it('file sama diunggah ulang → dipakai ulang (deduplikasi SHA-256)', async () => {
    const { app } = makeApp();
    const { u, cookie } = await session(app);
    const fields = { ownerType: 'user', ownerId: u.id, category: 'photo' };
    const data = webp('d');
    const one = await (
      await upload(app, cookie, fields, [{ field: 'file', name: 'a.webp', data }])
    ).json();
    const two = await upload(app, cookie, fields, [{ field: 'file', name: 'b.webp', data }]);
    expect(two.status).toBe(200);
    expect(await two.json()).toMatchObject({ id: one.id, duplicate: true });
  });

  it('isi tidak cocok dengan ekstensi (.exe sebagai .png) → 415, tidak ada baris tersimpan', async () => {
    const { app } = makeApp();
    const { u, cookie } = await session(app);
    const res = await upload(app, cookie, { ownerType: 'user', ownerId: u.id }, [
      {
        field: 'file',
        name: 'foto.png',
        data: new Uint8Array(Buffer.from('MZ\x90\x00 bukan png')),
      },
    ]);
    expect(res.status).toBe(415);
    const rows = await testDb().query.attachments.findMany({
      where: eq(attachments.ownerId, u.id),
    });
    expect(rows).toHaveLength(0);
  });

  it('file melebihi batas → 413 (batas dikecilkan untuk test; produksi 50 MB)', async () => {
    const { app } = makeApp({ uploadMaxBytes: 1024 });
    const { u, cookie } = await session(app);
    const res = await upload(app, cookie, { ownerType: 'user', ownerId: u.id }, [
      { field: 'file', name: 'besar.webp', data: webp('z'.repeat(100)) },
    ]);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('FILE_TOO_LARGE');
  });

  it('izin dicek di server: tidak bisa mengunggah foto profil user lain', async () => {
    const { app } = makeApp();
    const other = await createUser();
    const { cookie } = await session(app);
    const res = await upload(app, cookie, { ownerType: 'user', ownerId: other.id }, [
      { field: 'file', name: 'a.webp', data: webp() },
    ]);
    expect(res.status).toBe(403);
  });

  it('project pemilik yang tidak ditemukan → 404', async () => {
    const { app } = makeApp();
    const { cookie } = await session(app);
    const res = await upload(app, cookie, { ownerType: 'project', ownerId: crypto.randomUUID() }, [
      { field: 'file', name: 'po.pdf', data: new Uint8Array(Buffer.from('%PDF-1.7')) },
    ]);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('bukan multipart → 415; tanpa header CSRF → 403', async () => {
    const { app } = makeApp();
    const { cookie } = await session(app);
    const json = await app.request('/api/attachments', {
      method: 'POST',
      headers: { cookie, 'x-requested-with': 'rein', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(json.status).toBe(415);
    const csrf = await app.request('/api/attachments', {
      method: 'POST',
      headers: { cookie },
      body: new FormData(),
    });
    expect(csrf.status).toBe(403);
  });
});
