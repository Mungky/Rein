import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { GoogleClaims, GoogleOidc } from '../src/auth/google';
import { auditLogs, sessions, userContacts, users } from '../src/db/schema';
import {
  agent,
  closeTestDb,
  createUser,
  hasDb,
  login,
  makeApp,
  roleId,
  testDb,
  uniq,
} from './helpers';

afterAll(closeTestDb);

async function lastAudit(entityId: string, action: string) {
  return testDb().query.auditLogs.findFirst({
    where: and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)),
    orderBy: desc(auditLogs.createdAt),
  });
}

describe.skipIf(!hasDb)('FR-001 login password', () => {
  it('login dengan username & email → sesi, /me berisi izin', async () => {
    const { app } = makeApp();
    const u = await createUser({ role: 'manager' });
    for (const id of [u.username, u.email.toUpperCase()]) {
      const { a, res } = await login(app, id, u.password!);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ next: '/' });
      expect(a.jar.get('rein_sid')).toBeTruthy();
      const me = await a.get('/api/auth/me');
      expect(me.status).toBe(200);
      const body = await me.json();
      expect(body.user.username).toBe(u.username);
      expect(body.permissions['project.create']).toBe('all');
      expect(body.verification.email).toBe(true);
    }
    expect(await lastAudit(u.id, 'auth.login.success')).toBeTruthy();
  });

  it('cookie sesi HttpOnly, SameSite=Lax; "Ingat perangkat" → Max-Age 30 hari', async () => {
    const { app } = makeApp();
    const u = await createUser();
    const a = agent(app);
    const res = await a.post('/api/auth/login', {
      identifier: u.username,
      password: u.password,
      remember: true,
      deviceId: crypto.randomUUID(),
    });
    const sid = res.headers.getSetCookie().find((c) => c.startsWith('rein_sid='))!;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(sid).toMatch(/Max-Age=2592000/);
    const s = await testDb().query.sessions.findFirst({ where: eq(sessions.userId, u.id) });
    expect(s?.trusted).toBe(true);
    expect(s?.deviceId).toBeTruthy();
  });

  it('AC2: kredensial salah & user tak dikenal → pesan generik sama', async () => {
    const { app } = makeApp();
    const u = await createUser();
    const wrong = await login(app, u.username, 'salah-banget-123');
    const unknown = await login(app, `tidakada${uniq()}`, 'salah-banget-123');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    const [w, x] = [await wrong.res.json(), await unknown.res.json()];
    expect(w.error.message).toBe('Email/username atau password salah');
    expect(x).toEqual(w);
    expect(await lastAudit(u.id, 'auth.login.failed')).toBeTruthy();
  });

  it('user undangan (belum ada password) & nonaktif tidak bisa login', async () => {
    const { app } = makeApp();
    const invited = await createUser({ status: 'invited', password: null });
    const disabled = await createUser({ status: 'disabled' });
    expect((await login(app, invited.username, 'apa-saja-123')).res.status).toBe(401);
    expect((await login(app, disabled.username, disabled.password!)).res.status).toBe(401);
  });

  it('AC3: 10 gagal per akun → terkunci 15 menit (password benar pun ditolak)', async () => {
    const { app } = makeApp();
    const u = await createUser();
    for (let i = 0; i < 10; i++) {
      const { res } = await login(app, u.username, `salah-${i}-xxxxxx`);
      expect(res.status).toBe(401);
    }
    const { res } = await login(app, u.username, u.password!);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('ACCOUNT_LOCKED');
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(await lastAudit(u.id, 'auth.lockout')).toBeTruthy();
  });

  it('AC3: 30 gagal per IP → IP ditolak 429', async () => {
    const { app } = makeApp();
    const a = agent(app, '10.99.99.99');
    for (let i = 0; i < 30; i++) {
      await a.post('/api/auth/login', { identifier: `x${uniq()}`, password: 'salah-salah-1' });
    }
    const u = await createUser();
    const res = await a.post('/api/auth/login', { identifier: u.username, password: u.password });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('IP_BLOCKED');
  });

  it('next hanya path internal (FR-001 AC1)', async () => {
    const { app } = makeApp();
    const u = await createUser();
    const { res } = await login(app, u.username, u.password!, { next: 'https://evil.test/x' });
    expect(await res.json()).toEqual({ next: '/' });
  });

  it('email belum terverifikasi → diarahkan ke /verifikasi, API lain 403', async () => {
    const { app } = makeApp();
    const u = await createUser({ role: 'admin', verified: false });
    const { a, res } = await login(app, u.username, u.password!);
    expect(await res.json()).toEqual({ next: '/verifikasi' });
    const r = await a.get('/api/admin/users');
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('logout mencabut sesi; logout-all mencabut semua', async () => {
    const { app } = makeApp();
    const u = await createUser();
    const one = await login(app, u.username, u.password!);
    const two = await login(app, u.username, u.password!);
    expect((await one.a.post('/api/auth/logout')).status).toBe(200);
    expect((await one.a.get('/api/auth/me')).status).toBe(401);
    expect((await two.a.get('/api/auth/me')).status).toBe(200);
    const three = await login(app, u.username, u.password!);
    await three.a.post('/api/auth/logout-all');
    expect((await two.a.get('/api/auth/me')).status).toBe(401);
  });
});

describe.skipIf(!hasDb)('keamanan HTTP', () => {
  it('mutasi tanpa X-Requested-With → 403 CSRF', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'a', password: 'b' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('CSRF');
  });

  it('header keamanan terpasang', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/auth/config');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('audit_logs append-only: UPDATE ditolak trigger', async () => {
    const db = testDb();
    const err = await db.execute(sql`update audit_logs set action = 'x'`).then(
      () => null,
      (e: unknown) => e as { message: string; cause?: { message?: string } },
    );
    expect(err?.cause?.message ?? err?.message).toMatch(/append-only/);
  });
});

describe.skipIf(!hasDb)('FR-002 undangan + aktivasi, FR-003 verifikasi email', () => {
  it('alur lengkap: undang → aktivasi → verifikasi kode → akses', async () => {
    const { app, mail } = makeApp();
    const admin = await createUser({ role: 'admin' });
    const { a: adm } = await login(app, admin.username, admin.password!);
    const id = uniq();
    const email = `baru${id}@remula.test`;

    const inv = await adm.post('/api/admin/users/invite', {
      fullName: 'Udin Saputra',
      email,
      username: `udin${id}`,
      roleId: await roleId('engineering'),
      whatsapp: '0812-3456-7890',
    });
    expect(inv.status).toBe(201);
    // D1/D3: email ditunda → tidak benar-benar terkirim; Admin menerima tautan untuk disalin.
    const invBody = (await inv.json()) as { mailSent: boolean; activationLink: string };
    expect(invBody.mailSent).toBe(false);
    const invite = mail.outbox.find((m) => m.to === email)!;
    expect(invite.subject).toContain('Aktivasi');
    const token = decodeURIComponent(/token=([^\s"&<]+)/.exec(invite.text)![1]!);
    expect(invBody.activationLink).toContain(encodeURIComponent(token));

    const user = agent(app);
    const insp = await user.post('/api/auth/activation/inspect', { token });
    expect(await insp.json()).toMatchObject({ fullName: 'Udin Saputra', email });

    // password umum & pendek ditolak
    for (const bad of ['1234567890', 'pendek']) {
      const r = await user.post('/api/auth/activation/complete', { token, password: bad });
      expect(r.status).toBe(422);
    }
    const done = await user.post('/api/auth/activation/complete', {
      token,
      password: 'Tangki-Stainless-50L',
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ next: '/verifikasi', mailSent: false });

    // tautan aktivasi sekali pakai; "minta tautan baru" tidak mengirim apa pun untuk akun aktif
    const again = await agent(app).post('/api/auth/activation/inspect', { token });
    expect(again.status).toBe(410);
    const before = mail.outbox.length;
    expect((await agent(app).post('/api/auth/activation/request', { token })).status).toBe(200);
    expect(mail.outbox.length).toBe(before);

    expect(mail.outbox.filter((m) => m.to === email)).toHaveLength(1);
    await user.post('/api/auth/verify-email/resend');
    const verifyMail = mail.outbox.filter((m) => m.to === email).at(-1)!;
    const code = /(\d{6})/.exec(verifyMail.subject)![1]!;
    const wrong = await user.post('/api/auth/verify-email/code', {
      code: code === '000000' ? '111111' : '000000',
    });
    expect(wrong.status).toBe(422);
    const ok = await user.post('/api/auth/verify-email/code', { code });
    expect(ok.status).toBe(200);
    const me = await (await user.get('/api/auth/me')).json();
    expect(me.verification.email).toBe(true);
    expect(me.verification.any).toBe(false);
    expect(me.onboardingNext).toBe('/verifikasi');

    const row = await testDb().query.users.findFirst({ where: eq(users.username, `udin${id}`) });
    expect(row?.status).toBe('active');
    expect(await lastAudit(row!.id, 'user.invited')).toBeTruthy();
    expect(await lastAudit(row!.id, 'user.activated')).toBeTruthy();
  });

  it('FR-002 AC: tautan kedaluwarsa → "minta tautan baru" mengirim undangan baru', async () => {
    const { app, mail } = makeApp();
    const admin = await createUser({ role: 'admin' });
    const { a: adm } = await login(app, admin.username, admin.password!);
    const id = uniq();
    const email = `exp${id}@remula.test`;
    await adm.post('/api/admin/users/invite', {
      fullName: 'Sari Handayani',
      email,
      username: `sari${id}`,
      roleId: await roleId('qc'),
    });
    const tokenOf = (text: string) => decodeURIComponent(/token=([^\s"&<]+)/.exec(text)![1]!);
    const first = tokenOf(mail.outbox.filter((m) => m.to === email).at(-1)!.text);
    await testDb().execute(
      sql`update verification_codes set expires_at = now() - interval '1 minute' where purpose = 'activate' and expires_at > now()`,
    );
    const u = agent(app);
    expect((await u.post('/api/auth/activation/inspect', { token: first })).status).toBe(410);
    expect((await u.post('/api/auth/activation/request', { token: first })).status).toBe(200);
    const second = tokenOf(mail.outbox.filter((m) => m.to === email).at(-1)!.text);
    expect(second).not.toBe(first);
    expect((await u.post('/api/auth/activation/inspect', { token: second })).status).toBe(200);
  });

  it('magic link memverifikasi tanpa sesi', async () => {
    const { app, mail } = makeApp();
    const u = await createUser({ verified: false });
    const { a } = await login(app, u.username, u.password!);
    expect((await a.post('/api/auth/verify-email/resend')).status).toBe(200);
    const m = mail.outbox.filter((x) => x.to === u.email).at(-1)!;
    const token = decodeURIComponent(/verifikasi\/email\?token=([^\s"&<]+)/.exec(m.text)![1]!);
    const res = await agent(app).post('/api/auth/verify-email/token', { token });
    expect(res.status).toBe(200);
    const c = await testDb().query.userContacts.findFirst({
      where: eq(userContacts.userId, u.id),
    });
    expect(c?.verifiedAt).toBeTruthy();
  });

  it('kode salah 5× → harus kirim ulang', async () => {
    const { app, mail } = makeApp();
    const u = await createUser({ verified: false });
    const { a } = await login(app, u.username, u.password!);
    await a.post('/api/auth/verify-email/resend');
    const code = /(\d{6})/.exec(mail.outbox.filter((x) => x.to === u.email).at(-1)!.subject)![1]!;
    const bad = code === '999999' ? '999998' : '999999';
    for (let i = 0; i < 5; i++) await a.post('/api/auth/verify-email/code', { code: bad });
    const res = await a.post('/api/auth/verify-email/code', { code });
    expect(res.status).toBe(429);
  });

  it('kirim ulang email dibatasi 5/jam', async () => {
    const { app } = makeApp();
    const u = await createUser({ verified: false });
    const { a } = await login(app, u.username, u.password!);
    for (let i = 0; i < 5; i++)
      expect((await a.post('/api/auth/verify-email/resend')).status).toBe(200);
    expect((await a.post('/api/auth/verify-email/resend')).status).toBe(429);
  });

  it('izin dicek di server: non-admin tidak bisa mengundang', async () => {
    const { app } = makeApp();
    const mgr = await createUser({ role: 'manager' });
    const { a } = await login(app, mgr.username, mgr.password!);
    const res = await a.post('/api/admin/users/invite', {
      fullName: 'X Y',
      email: `x${uniq()}@remula.test`,
      username: `x${uniq()}`,
      roleId: await roleId('qc'),
    });
    expect(res.status).toBe(403);
  });

  it('FR-090: user dinonaktifkan langsung kehilangan sesi', async () => {
    const { app } = makeApp();
    const admin = await createUser({ role: 'admin' });
    const u = await createUser();
    const { a: adm } = await login(app, admin.username, admin.password!);
    const { a } = await login(app, u.username, u.password!);
    expect((await adm.post(`/api/admin/users/${u.id}/disable`)).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });
});

describe.skipIf(!hasDb)('FR-006 Masuk dengan Google', () => {
  function stubGoogle(claims: GoogleClaims): GoogleOidc {
    return {
      authorizationUrl: (state, verifier) =>
        new URL(`https://accounts.google.test/auth?state=${state}&v=${verifier.length}`),
      exchange: async () => claims,
    };
  }

  async function runFlow(app: ReturnType<typeof makeApp>['app']) {
    const a = agent(app);
    const start = await a.get('/auth/google/start?next=/project');
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb = await a.get(`/auth/google/callback?code=abc&state=${state}`);
    return { a, cb };
  }

  it('akun terdaftar: menautkan google_sub, email terverifikasi, sesi dibuat', async () => {
    const u = await createUser({ verified: false });
    const sub = `g-${uniq()}`;
    const { app } = makeApp({ google: stubGoogle({ sub, email: u.email, emailVerified: true }) });
    const { a, cb } = await runFlow(app);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('http://localhost:5173/project');
    const me = await (await a.get('/api/auth/me')).json();
    expect(me.verification.email).toBe(true);
    const row = await testDb().query.users.findFirst({ where: eq(users.id, u.id) });
    expect(row?.googleSub).toBe(sub);
  });

  it('email tidak terdaftar → ditolak tanpa membuat akun', async () => {
    const email = `asing${uniq()}@gmail.test`;
    const { app } = makeApp({
      google: stubGoogle({ sub: `g-${uniq()}`, email, emailVerified: true }),
    });
    const { cb } = await runFlow(app);
    expect(cb.headers.get('location')).toBe(
      'http://localhost:5173/masuk?error=google_unregistered',
    );
    const c = await testDb().query.userContacts.findFirst({ where: eq(userContacts.value, email) });
    expect(c).toBeUndefined();
  });

  it('state tidak cocok → ditolak', async () => {
    const u = await createUser();
    const { app } = makeApp({
      google: stubGoogle({ sub: `g-${uniq()}`, email: u.email, emailVerified: true }),
    });
    const a = agent(app);
    await a.get('/auth/google/start');
    const cb = await a.get('/auth/google/callback?code=abc&state=palsu');
    expect(cb.headers.get('location')).toContain('error=google_state');
  });

  it('email_verified=false → ditolak', async () => {
    const u = await createUser();
    const { app } = makeApp({
      google: stubGoogle({ sub: `g-${uniq()}`, email: u.email, emailVerified: false }),
    });
    const { cb } = await runFlow(app);
    expect(cb.headers.get('location')).toContain('error=google_unverified');
  });
});
