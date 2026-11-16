import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, userContacts, users, verificationCodes } from '../src/db/schema';
import { signOpenWA } from '../src/routes/webhooks';
import { hmacHex } from '../src/lib/crypto';
import { agent, closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);

describe.skipIf(!hasDb)('Onboarding WhatsApp OTP', () => {
  async function fixture() {
    const f = makeApp({ env: { OPENWA_WEBHOOK_SECRET: 'test-webhook-secret-for-otp' } });
    const user = await createUser({ onboardingComplete: false });
    const { a } = await login(f.app, user.username, user.password!);
    const phone = `+628${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
    async function start(number = phone) {
      const res = await a.post('/api/auth/verify-whatsapp/start', { phone: number });
      expect(res.status).toBe(200);
      const body = await res.json();
      const code = /: (\d{6})/.exec(f.wa.outbox.at(-1)!.text)![1]!;
      return { body, code };
    }
    return { ...f, user, a, phone, start };
  }

  it('mengirim OTP lewat bot, menyembunyikan kode, lalu WA → lewati PIN → nickname', async () => {
    const f = await fixture();
    expect((await (await f.a.get('/api/auth/me')).json()).onboardingNext).toBe('/verifikasi');
    // Email Google/terverifikasi tidak melewati WA pada akun baru.
    expect((await f.a.get('/api/me/devices')).status).toBe(403);
    const { body, code } = await f.start();
    expect(body.code).toBeUndefined();
    expect(body.link).toBeUndefined();
    expect(f.wa.outbox.at(-1)).toMatchObject({ to: f.phone });
    const stored = await testDb().query.verificationCodes.findFirst({
      where: eq(verificationCodes.id, body.challengeId),
    });
    expect(stored!.codeHash).toBe(hmacHex(`wa-otp:${code}`, f.deps.env.AUTH_PEPPER));
    const restored = await (await f.a.get('/api/auth/verify-whatsapp')).json();
    expect(restored.challenge.challengeId).toBe(body.challengeId);
    expect(JSON.stringify(restored)).not.toContain(`"code":"${code}"`);
    expect(
      (
        await f.a.post('/api/auth/verify-whatsapp/code', {
          challengeId: body.challengeId,
          code,
          deviceId: randomUUID(),
        })
      ).status,
    ).toBe(200);
    let me = await (await f.a.get('/api/auth/me')).json();
    expect(me.verification.whatsapp).toBe(true);
    expect(me.device).toMatchObject({ hasPin: false });
    expect(me.onboardingNext).toBe('/pin');
    expect((await f.a.post('/api/auth/onboarding/complete', { nickname: 'Raka' })).status).toBe(
      409,
    );
    expect((await f.a.post('/api/auth/pin/skip')).status).toBe(200);
    expect((await (await f.a.get('/api/auth/me')).json()).onboardingNext).toBe('/sambutan');
    expect((await f.a.post('/api/auth/onboarding/complete', { nickname: '   ' })).status).toBe(422);
    expect((await f.a.post('/api/auth/onboarding/complete', { nickname: ' Raka ' })).status).toBe(
      200,
    );
    me = await (await f.a.get('/api/auth/me')).json();
    expect(me.onboardingNext).toBeNull();
    expect(me.user.nickname).toBe('Raka');
    expect(me.user.fullName).toBe(`User ${f.user.username.slice(1)}`);
    // Lewati disimpan lintas sesi/perangkat.
    const { a: other } = await login(f.app, f.user.username, f.user.password!, {
      deviceId: randomUUID(),
      remember: true,
    });
    expect((await (await other.get('/api/auth/me')).json()).onboardingNext).toBeNull();
    expect((await f.a.post('/api/me/nickname', { nickname: 'Aka' })).status).toBe(200);
    const events = await testDb().select().from(auditLogs).where(eq(auditLogs.actorId, f.user.id));
    expect(events.some((e) => e.action === 'contact.whatsapp_verified')).toBe(true);
    expect(events.some((e) => e.action === 'user.onboarding_completed')).toBe(true);
    expect(events.every((e) => !Object.hasOwn(e.diffJson ?? {}, 'code'))).toBe(true);
  });

  it('membuat PIN pada sesi aktivasi tanpa perangkat, lalu lanjut ke profil', async () => {
    const f = await fixture();
    const { body, code } = await f.start();
    await f.a.post('/api/auth/verify-whatsapp/code', {
      challengeId: body.challengeId,
      code,
      deviceId: randomUUID(),
    });
    expect(
      (await f.a.post('/api/auth/pin/setup', { pin: '482951', pinConfirm: '482951' })).status,
    ).toBe(200);
    expect((await (await f.a.get('/api/auth/me')).json()).onboardingNext).toBe('/sambutan');
    await f.a.post('/api/auth/pin/skip');
    expect((await (await f.a.get('/api/auth/me')).json()).device.hasPin).toBe(true);
  });

  it('OTP terikat user, sekali pakai, dan tahan dua konfirmasi paralel', async () => {
    const f = await fixture();
    const { body, code } = await f.start();
    const stranger = await createUser();
    const { a } = await login(f.app, stranger.username, stranger.password!);
    expect(
      (await a.post('/api/auth/verify-whatsapp/code', { challengeId: body.challengeId, code }))
        .status,
    ).toBe(410);
    const responses = await Promise.all(
      [1, 2].map(() =>
        f.a.post('/api/auth/verify-whatsapp/code', { challengeId: body.challengeId, code }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it('lima kode salah mematikan tantangan meski kode berikutnya benar', async () => {
    const f = await fixture();
    const { body, code } = await f.start();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(
        (
          await f.a.post('/api/auth/verify-whatsapp/code', {
            challengeId: body.challengeId,
            code: wrong,
          })
        ).status,
      ).toBe(422);
    expect(
      (await f.a.post('/api/auth/verify-whatsapp/code', { challengeId: body.challengeId, code }))
        .status,
    ).toBe(410);
    expect((await (await f.a.get('/api/auth/me')).json()).verification.whatsapp).toBe(false);
  });

  it('kode kedaluwarsa dan pesan masuk ke bot tidak memverifikasi nomor', async () => {
    const f = await fixture();
    const { body, code } = await f.start();
    const raw = JSON.stringify({
      event: 'message.received',
      data: { senderPhone: f.phone, text: `REIN-${code}` },
    });
    expect(
      (
        await f.app.request('/webhooks/openwa', {
          method: 'POST',
          headers: { 'x-openwa-signature': signOpenWA(f.deps.env.OPENWA_WEBHOOK_SECRET!, raw) },
          body: raw,
        })
      ).status,
    ).toBe(200);
    expect((await (await f.a.get('/api/auth/me')).json()).verification.whatsapp).toBe(false);
    await testDb()
      .update(verificationCodes)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(verificationCodes.id, body.challengeId));
    expect(
      (await f.a.post('/api/auth/verify-whatsapp/code', { challengeId: body.challengeId, code }))
        .status,
    ).toBe(410);
  });

  it('kirim ulang dibatasi, kode lama mati, nomor baru baru menggantikan nomor lama setelah OTP benar', async () => {
    const f = await fixture();
    const first = await f.start();
    expect((await f.a.post('/api/auth/verify-whatsapp/start', { phone: f.phone })).status).toBe(
      429,
    );
    await testDb()
      .update(verificationCodes)
      .set({ createdAt: new Date(Date.now() - 61_000) })
      .where(eq(verificationCodes.id, first.body.challengeId));
    const second = await f.start();
    expect(
      (
        await f.a.post('/api/auth/verify-whatsapp/code', {
          challengeId: first.body.challengeId,
          code: first.code,
        })
      ).status,
    ).toBe(410);
    await f.a.post('/api/auth/verify-whatsapp/code', {
      challengeId: second.body.challengeId,
      code: second.code,
    });
    await testDb()
      .update(verificationCodes)
      .set({ createdAt: new Date(Date.now() - 61_000) })
      .where(eq(verificationCodes.id, second.body.challengeId));
    const changed = await f.start(`${f.phone.slice(0, -1)}${f.phone.endsWith('0') ? '1' : '0'}`);
    expect((await (await f.a.get('/api/auth/me')).json()).user.whatsapp).toBe(f.phone);
    await f.a.post('/api/auth/verify-whatsapp/code', {
      challengeId: changed.body.challengeId,
      code: changed.code,
    });
    expect((await (await f.a.get('/api/auth/me')).json()).user.whatsapp).toBe(changed.body.phone);
  });

  it('nomor yang sudah dipakai, input tidak valid, dan pengguna tanpa sesi ditolak', async () => {
    const f = await fixture();
    const another = await createUser();
    await testDb()
      .insert(userContacts)
      .values({ userId: another.id, kind: 'whatsapp', value: f.phone, verifiedAt: new Date() });
    expect((await f.a.post('/api/auth/verify-whatsapp/start', { phone: f.phone })).status).toBe(
      409,
    );
    expect((await f.a.post('/api/auth/verify-whatsapp/start', { phone: 'abc' })).status).toBe(422);
    expect(
      (await agent(f.app).post('/api/auth/verify-whatsapp/start', { phone: f.phone })).status,
    ).toBe(401);
    expect((await f.a.post('/api/auth/onboarding/complete', { nickname: 'Raka' })).status).toBe(
      403,
    );
  });

  it('gagal mengirim tidak meninggalkan kode aktif atau nomor terverifikasi', async () => {
    const f = await fixture();
    vi.spyOn(f.wa, 'sendText').mockRejectedValue(new Error('sensitive provider response'));
    const res = await f.a.post('/api/auth/verify-whatsapp/start', { phone: f.phone });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('sensitive');
    const rows = await testDb()
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, f.user.id),
          eq(verificationCodes.purpose, 'verify_whatsapp'),
        ),
      );
    expect(rows).toHaveLength(0);
    expect((await (await f.a.get('/api/auth/me')).json()).verification.whatsapp).toBe(false);
  });

  it('batas harian tetap berlaku sesudah proses server berganti dan kontak lama dilepas', async () => {
    const f = await fixture();
    await testDb()
      .insert(verificationCodes)
      .values(
        Array.from({ length: 5 }, () => ({
          userId: f.user.id,
          purpose: 'verify_whatsapp' as const,
          expiresAt: new Date(Date.now() - 1),
          createdAt: new Date(Date.now() - 61_000),
          contactId: null,
        })),
      );
    const otherApp = makeApp();
    const { a } = await login(otherApp.app, f.user.username, f.user.password!);
    expect((await a.post('/api/auth/verify-whatsapp/start', { phone: f.phone })).status).toBe(429);
    expect(otherApp.wa.outbox).toHaveLength(0);
  });

  it('bot terputus mengembalikan pesan gagal kirim tanpa membuat tantangan', async () => {
    const f = await fixture();
    Object.defineProperty(f.wa, 'name', { value: 'openwa' });
    vi.spyOn(f.wa, 'session').mockResolvedValue({ id: 'test-session', status: 'disconnected' });
    expect((await f.a.post('/api/auth/verify-whatsapp/start', { phone: f.phone })).status).toBe(
      502,
    );
    expect(f.wa.outbox).toHaveLength(0);
  });

  it('akun lama dengan email tetap masuk, PIN tetap pilihan setelah pindah perangkat', async () => {
    const { app } = makeApp();
    const user = await createUser();
    const { a } = await login(app, user.username, user.password!, {
      remember: true,
      deviceId: randomUUID(),
    });
    const me = await (await a.get('/api/auth/me')).json();
    expect(me.verification.any).toBe(true);
    expect(me.onboardingNext).toBeNull();
    expect((await a.get('/api/me/devices')).status).toBe(200);
    expect(
      (await testDb().query.users.findFirst({ where: eq(users.id, user.id) }))!
        .onboardingCompletedAt,
    ).not.toBeNull();
  });
});
