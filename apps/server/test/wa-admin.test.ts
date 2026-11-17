import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { auditLogs } from '../src/db/schema';
import { agent, closeTestDb, createUser, hasDb, login, makeApp, testDb } from './helpers';

afterAll(closeTestDb);

describe.skipIf(!hasDb)('pengelolaan koneksi WhatsApp', () => {
  it('menolak pengguna tanpa izin dan sesi anonim', async () => {
    const f = makeApp();
    const user = await createUser();
    const { a } = await login(f.app, user.username, user.password!);
    expect((await a.get('/api/admin/whatsapp')).status).toBe(403);
    expect((await a.post('/api/admin/whatsapp/setup', {})).status).toBe(403);
    expect((await agent(f.app).get('/api/admin/whatsapp')).status).toBe(401);
  });
  it('Admin dapat melihat QR, menghubungkan sesi, dan setup tercatat dalam audit', async () => {
    const f = makeApp({ env: { OPENWA_WEBHOOK_SECRET: 'test-secret-connection' } });
    const user = await createUser({ role: 'admin' });
    const { a } = await login(f.app, user.username, user.password!);
    Object.defineProperty(f.wa, 'name', { value: 'openwa' });
    vi.spyOn(f.wa, 'session').mockResolvedValue({ id: 's1', status: 'qr_ready' });
    vi.spyOn(f.wa, 'qr').mockResolvedValue('data:image/png;base64,dGVzdA==');
    const setup = vi.spyOn(f.wa, 'ensureSetup').mockResolvedValue({ id: 's1', status: 'qr_ready' });
    const state = await a.get('/api/admin/whatsapp');
    expect(state.status).toBe(200);
    expect((await state.json()).qr).toBe('data:image/png;base64,dGVzdA==');
    expect((await a.post('/api/admin/whatsapp/setup', {})).status).toBe(200);
    expect(setup).toHaveBeenCalledWith(
      f.deps.env.OPENWA_WEBHOOK_URL,
      f.deps.env.OPENWA_WEBHOOK_SECRET,
    );
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'whatsapp.setup')),
      }),
    ).toBeDefined();
  });
});
