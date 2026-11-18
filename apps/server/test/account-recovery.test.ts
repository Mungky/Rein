import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { devices, verificationCodes } from '../src/db/schema';
import { agent, closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);

async function fixture() {
  const f = makeApp();
  f.deps.mail = { name: 'test-mail', send: (message) => f.mail.send(message) };
  const user = await createUser();
  const deviceId = randomUUID();
  const { a } = await login(f.app, user.username, user.password!, { deviceId, remember: true });
  return { ...f, a, user };
}

const replacement = 'Pesawat-Awan-Pasir-741!';
const tokenOf = (text: string, separator: '#' | '?') =>
  text.split(`${separator}token=`)[1]!.split(/\s/)[0]!;

describe.skipIf(!hasDb)('Pemulihan akun dan perangkat', () => {
  it('menahan email aktif saat menunggu verifikasi dan membatalkan kode beserta tautannya', async () => {
    const f = await fixture();
    const email = `${f.user.username}+baru@rein.test`;
    expect((await f.a.post('/api/me/email', { email })).status).toBe(200);
    expect(await (await f.a.get('/api/me/notifications')).json()).toMatchObject({
      email,
      emailVerified: false,
    });
    expect((await (await f.a.get('/api/auth/me')).json()).user.email).toBe(f.user.email);
    expect((await f.a.post('/api/auth/verify-email/resend')).status).toBe(200);
    const mail = f.mail.outbox.at(-1)!;
    const code = /\d{6}/.exec(mail.subject)![0];
    expect(await (await f.a.post('/api/me/email', { email: f.user.email })).json()).toMatchObject({
      canceled: true,
    });
    expect(await (await f.a.get('/api/me/notifications')).json()).toMatchObject({
      email: f.user.email,
      emailVerified: true,
    });
    expect((await f.a.post('/api/auth/verify-email/code', { code })).status).toBe(410);
    expect(
      (await f.a.post('/api/auth/verify-email/token', { token: tokenOf(mail.text, '?') })).status,
    ).toBe(410);
  });

  it('mengaktifkan email pengganti dengan kode yang sah', async () => {
    const f = await fixture();
    const email = `${f.user.username}+sah@rein.test`;
    expect((await f.a.post('/api/me/email', { email })).status).toBe(200);
    expect((await f.a.post('/api/auth/verify-email/resend')).status).toBe(200);
    const code = /\d{6}/.exec(f.mail.outbox.at(-1)!.subject)![0];
    expect((await f.a.post('/api/auth/verify-email/code', { code })).status).toBe(200);
    expect(await (await f.a.get('/api/me/notifications')).json()).toMatchObject({
      email,
      emailVerified: true,
    });
  });

  it('mereset password lewat email terverifikasi tanpa membedakan respons akun yang tidak dikenal', async () => {
    const f = await fixture();
    const publicUser = agent(f.app);
    const second = (await login(f.app, f.user.username, f.user.password!)).a;
    const known = await publicUser.post('/api/auth/forgot-password', {
      identifier: f.user.username,
    });
    const unknown = await publicUser.post('/api/auth/forgot-password', {
      identifier: 'akun-tidak-dikenal@rein.test',
    });
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    expect(f.mail.outbox).toHaveLength(1);
    const { to, text } = f.mail.outbox[0]!;
    expect(to).toBe(f.user.email);
    const token = tokenOf(text, '#');
    const original = await testDb().query.verificationCodes.findFirst({
      where: eq(verificationCodes.userId, f.user.id),
    });
    expect(original!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(original!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    const reset = () =>
      publicUser.post('/api/auth/reset-password', { token, password: replacement });
    expect((await Promise.all([reset(), reset()])).map((res) => res.status).sort()).toEqual([
      200, 410,
    ]);
    for (const session of [f.a, second])
      expect((await session.get('/api/auth/me')).status).toBe(401);
    expect((await login(f.app, f.user.username, f.user.password!)).res.status).toBe(401);
    expect((await login(f.app, f.user.username, replacement)).res.status).toBe(200);
  });

  it('memvalidasi password lama dan menolak tautan reset Admin yang kedaluwarsa', async () => {
    const f = await fixture();
    const admin = await createUser({ role: 'admin' });
    const { a } = await login(f.app, admin.username, admin.password!);
    const path = `/api/admin/users/${f.user.id}/reset-password`;
    expect((await f.a.post(path)).status).toBe(403);
    expect((await a.post(path)).status).toBe(200);
    const token = tokenOf(f.mail.outbox.at(-1)!.text, '#');
    await testDb()
      .update(verificationCodes)
      .set({ expiresAt: new Date(0) })
      .where(eq(verificationCodes.userId, f.user.id));
    expect(
      (await agent(f.app).post('/api/auth/reset-password', { token, password: replacement }))
        .status,
    ).toBe(410);
    expect(
      (await f.a.post('/api/me/password', { currentPassword: 'salah', password: replacement }))
        .status,
    ).toBe(422);
    expect(
      (
        await f.a.post('/api/me/password', {
          currentPassword: f.user.password,
          password: replacement,
        })
      ).status,
    ).toBe(200);
    expect((await f.a.get('/api/auth/me')).status).toBe(401);
    expect((await login(f.app, f.user.username, replacement)).res.status).toBe(200);
  });

  it('membatasi pencabutan ke perangkat sendiri dan tindakan bantuan ke Admin', async () => {
    const f = await fixture();
    const { a: second } = await login(f.app, f.user.username, f.user.password!, {
      deviceId: randomUUID(),
      remember: true,
    });
    const row = (await (await f.a.get('/api/me/devices')).json()).devices.find(
      (d: { current: boolean }) => !d.current,
    );
    const engineer = await createUser();
    const { a: outsider } = await login(f.app, engineer.username, engineer.password!);
    expect((await outsider.delete(`/api/me/devices/${row.id}`, {})).status).toBe(404);
    expect((await f.a.delete(`/api/me/devices/${row.id}`, {})).status).toBe(200);
    expect((await second.get('/api/auth/me')).status).toBe(401);
    expect((await f.a.get('/api/auth/me')).status).toBe(200);
    const admin = await createUser({ role: 'admin' });
    const { a } = await login(f.app, admin.username, admin.password!);
    const path = `/api/admin/users/${f.user.id}`;
    const phone = `+62812${String(BigInt('0x' + f.user.id.replaceAll('-', '')) % 100_000_000n).padStart(8, '0')}`;
    const device = (await (await f.a.get('/api/me/devices')).json()).devices[0];
    await testDb().update(devices).set({ pinHash: 'test-pin' }).where(eq(devices.id, device.id));
    expect((await outsider.post(`${path}/verify-whatsapp`, { phone })).status).toBe(403);
    expect((await a.post(`${path}/verify-whatsapp`, { phone })).status).toBe(200);
    expect((await (await f.a.get('/api/auth/me')).json()).user.whatsapp).toBe(phone);
    expect((await outsider.post(`${path}/reset-pin`)).status).toBe(403);
    expect((await a.post(`${path}/reset-pin`)).status).toBe(200);
    expect(
      await testDb().query.devices.findFirst({ where: eq(devices.id, device.id) }),
    ).toMatchObject({ pinHash: null });
  });
});
