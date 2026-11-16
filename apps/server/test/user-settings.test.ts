import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  roles,
  systemState,
  userContacts,
  userSettings,
  notifications,
  notificationDeliveries,
  auditLogs,
  userPermissions,
} from '../src/db/schema';
import { seedRoles } from '../src/db/seed';
import { enqueueNotifications } from '../src/notify/outbox';
import { deliverWhatsApp } from '../src/notify/deliver';
import { deliverEmail } from '../src/notify/email';
import type { MailMessage } from '../src/mail/provider';
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

describe.runIf(hasDb)('undangan opsional, role, izin dan kanal per pengguna', () => {
  afterAll(closeTestDb);
  async function fixture() {
    const f = makeApp();
    const admin = await createUser({ role: 'admin' });
    const { a } = await login(f.app, admin.username, admin.password!);
    const request = (client: typeof a, method: string, path: string, body?: unknown) =>
      f.app.request(path, {
        method,
        headers: {
          cookie: [...client.jar].map(([k, v]) => `${k}=${v}`).join('; '),
          'x-requested-with': 'rein',
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { ...f, a, admin, request };
  }

  it('mengundang tanpa kontak/email; tautan dapat diperbarui dan akun memilih kontak setelah aktivasi', async () => {
    const f = await fixture();
    const invited = await f.a.post('/api/admin/users/invite', {
      fullName: 'Pekerja tanpa email',
      username: `ops${uniq()}`,
      roleId: await roleId('engineering'),
      email: '',
    });
    expect(invited.status).toBe(201);
    const body = await invited.json();
    expect(body.mailSent).toBe(false);
    expect(
      await testDb().select().from(userContacts).where(eq(userContacts.userId, body.id)),
    ).toHaveLength(0);
    const user = agent(f.app);
    const token = new URL(body.activationLink).searchParams.get('token');
    expect((await user.post('/api/auth/activation/inspect', { token })).status).toBe(200);
    const resent = await f.a.post(`/api/admin/users/${body.id}/resend-invite`);
    expect(resent.status).toBe(200);
    expect((await user.post('/api/auth/activation/inspect', { token })).status).toBe(410);
    const nextToken = new URL((await resent.json()).activationLink).searchParams.get('token');
    const activated = await user.post('/api/auth/activation/complete', {
      token: nextToken,
      password: 'Raket-Laut-72Awan!',
    });
    expect(activated.status).toBe(200);
    expect((await activated.json()).next).toBe('/verifikasi');
    expect(
      (await f.request(user, 'PUT', '/api/me/notifications', { channels: 'whatsapp' })).status,
    ).toBe(200);
    expect((await user.post('/api/me/email', { email: `pilihan${uniq()}@rein.test` })).status).toBe(
      200,
    );
    const contact = await (await user.get('/api/me/notifications')).json();
    expect(contact.emailVerified).toBe(false);
    expect(contact.channels).toBe('whatsapp');
    expect((await user.get('/api/projects')).status).toBe(403);
    expect(
      (await f.a.post(`/api/admin/users/${body.id}/verify-whatsapp`, { phone: '+6281209876543' }))
        .status,
    ).toBe(200);
    expect((await user.get('/api/auth/me')).status).toBe(200);
    expect((await (await user.get('/api/auth/me')).json()).verification.any).toBe(true);
  });

  it('role bawaan tanpa pengguna bisa dihapus dan tidak muncul lagi saat seed; Admin dan role terpakai tetap terlindungi', async () => {
    const f = await fixture();
    const productionId = await roleId('production');
    try {
      expect((await f.request(f.a, 'DELETE', `/api/admin/roles/${productionId}`)).status).toBe(200);
      await seedRoles(testDb());
      expect(
        await testDb().query.roles.findFirst({ where: eq(roles.systemKey, 'production') }),
      ).toBeUndefined();
      expect(
        (await f.request(f.a, 'DELETE', `/api/admin/roles/${await roleId('admin')}`)).status,
      ).toBe(409);
      await createUser();
      expect(
        (await f.request(f.a, 'DELETE', `/api/admin/roles/${await roleId('engineering')}`)).status,
      ).toBe(409);
    } finally {
      await testDb().delete(systemState).where(eq(systemState.key, 'deleted_role:production'));
      await seedRoles(testDb());
    }
  });

  it('override hanya berlaku pada pengguna terkait, menerima penolakan eksplisit dan bisa dikembalikan ke role', async () => {
    const f = await fixture();
    const u = await createUser();
    const v = await createUser();
    const { a: own } = await login(f.app, u.username, u.password!);
    const { a: other } = await login(f.app, v.username, v.password!);
    const path = `/api/admin/users/${u.id}/access`;
    expect(
      (
        await f.request(own, 'PUT', path, {
          permissions: [{ permission: 'admin.roles', scope: 'all' }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(f.a, 'PUT', path, {
          permissions: [{ permission: 'project.create', scope: 'member' }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await f.request(f.a, 'PUT', path, {
          permissions: [
            { permission: 'project.create', scope: 'all' },
            { permission: 'project.view', scope: 'all' },
          ],
        })
      ).status,
    ).toBe(200);
    const me = await (await own.get('/api/auth/me')).json();
    expect(me.permissions['project.create']).toBe('all');
    expect(
      (await (await other.get('/api/auth/me')).json()).permissions['project.create'],
    ).toBeUndefined();
    const created = await own.post('/api/projects', {
      clientName: 'Klien akses personal',
      name: 'Akses khusus',
      rpoNumber: `RPO-${uniq()}`,
      startDate: '2026-11-16',
      endDate: '2026-12-16',
    });
    expect(created.status).toBe(201);
    const projectId = (await created.json()).id;
    expect(
      (
        await f.request(f.a, 'PUT', path, {
          permissions: [{ permission: 'project.view', scope: 'none' }],
        })
      ).status,
    ).toBe(200);
    expect((await (await own.get('/api/projects')).json()).projects).toEqual([]);
    expect((await own.get(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await (await own.get('/api/home')).json()).tasks).toEqual([]);
    expect(
      await enqueueNotifications(testDb(), {
        event: 'project.member_added',
        recipients: [u.id],
        projectId,
        entityId: projectId,
        entityType: 'project',
        title: 'Rahasia',
        body: 'Tidak boleh terlihat',
        url: `/project/${projectId}`,
      }),
    ).toEqual([]);
    expect((await f.request(f.a, 'PUT', path, { permissions: [] })).status).toBe(200);
    expect((await (await own.get('/api/auth/me')).json()).permissions['project.view']).toBe(
      'member',
    );
    expect(
      (
        await f.request(f.a, 'PUT', `/api/admin/users/${f.admin.id}/access`, {
          permissions: [{ permission: 'admin.roles', scope: 'none' }],
        })
      ).status,
    ).toBe(409);
    expect(
      await testDb().query.auditLogs.findFirst({
        where: and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'user.permissions_changed')),
      }),
    ).toBeDefined();
  });

  it('pengguna dapat memilih kanal sendiri; Admin mengatur per akun; akun biasa tidak boleh mengubah akun lain', async () => {
    const f = await fixture();
    const u = await createUser();
    const v = await createUser();
    const { a: own } = await login(f.app, u.username, u.password!);
    for (const channels of ['whatsapp', 'email', 'both']) {
      expect((await f.request(own, 'PUT', '/api/me/notifications', { channels })).status).toBe(200);
      expect((await (await own.get('/api/me/notifications')).json()).channels).toBe(channels);
    }
    expect(
      (await f.request(own, 'PUT', `/api/admin/users/${v.id}/notifications`, { channels: 'email' }))
        .status,
    ).toBe(403);
    expect(
      (await f.request(f.a, 'PUT', `/api/admin/users/${u.id}/notifications`, { channels: 'email' }))
        .status,
    ).toBe(200);
    expect((await (await own.get('/api/me/notifications')).json()).channels).toBe('email');
    expect((await f.request(own, 'PUT', '/api/me/notifications', { channels: 'sms' })).status).toBe(
      422,
    );
  });

  it('pengiriman mengikuti WA saja, email saja, atau keduanya; notifikasi dalam aplikasi tetap ada', async () => {
    const f = await fixture();
    const recipients = [];
    for (const [i, channels] of ['whatsapp', 'email', 'both'].entries()) {
      const u = await createUser();
      recipients.push(u.id);
      await testDb()
        .insert(userContacts)
        .values({
          userId: u.id,
          kind: 'whatsapp',
          value: `+62813${Date.now().toString().slice(-7)}${i}`,
          verifiedAt: new Date(),
          isPrimary: true,
        });
      await testDb()
        .insert(userSettings)
        .values({
          userId: u.id,
          notifyEmail: channels !== 'whatsapp',
          notifyWhatsapp: channels !== 'email',
          quietEnabled: false,
        });
    }
    await enqueueNotifications(testDb(), {
      event: 'wo.assigned',
      recipients,
      entityType: 'wo',
      entityId: randomUUID(),
      title: 'Pilihan kanal',
      body: 'Tugas baru',
      url: '/tugas',
      waText: 'Tugas baru',
    });
    const sent: MailMessage[] = [];
    const mail = {
      name: 'test',
      send: async (m: MailMessage) => {
        sent.push(m);
        return { id: `test-${sent.length}` };
      },
    };
    const now = new Date(Date.now() + 1000);
    expect((await deliverWhatsApp(f.deps, now)).sent).toBe(2);
    expect((await deliverEmail({ ...f.deps, mail }, now)).sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.text).toContain('http://localhost:5173/tugas');
    const rows = await testDb()
      .select()
      .from(notifications)
      .where(inArray(notifications.userId, recipients));
    expect(rows).toHaveLength(3);
    const deliveries = await testDb()
      .select()
      .from(notificationDeliveries)
      .where(
        inArray(
          notificationDeliveries.notificationId,
          rows.map((r) => r.id),
        ),
      );
    expect(deliveries.filter((d) => d.status === 'sent')).toHaveLength(4);
    expect(deliveries.filter((d) => d.lastError === 'preference_disabled')).toHaveLength(2);
  });

  it('email yang belum diverifikasi atau layanan email nonaktif tidak dikirimi notifikasi', async () => {
    const f = await fixture();
    const u = await createUser({ verified: false });
    const v = await createUser();
    await enqueueNotifications(testDb(), {
      event: 'wo.updated',
      recipients: [u.id, v.id],
      entityType: 'wo',
      entityId: randomUUID(),
      title: 'Uji email',
      body: 'Belum boleh dikirim',
      url: '/tugas',
    });
    const now = new Date(Date.now() + 1000);
    const result = await deliverEmail(f.deps, now);
    expect(result.sent).toBe(0);
    const rows = await testDb()
      .select()
      .from(notifications)
      .where(inArray(notifications.userId, [u.id, v.id]));
    const deliveries = await testDb()
      .select()
      .from(notificationDeliveries)
      .where(
        inArray(
          notificationDeliveries.notificationId,
          rows.map((r) => r.id),
        ),
      );
    expect(deliveries.map((d) => d.lastError).sort()).toEqual(['email_disabled', 'no_email']);
  });
  it('email pengganti tetap pending sampai terverifikasi; kode lama tidak berlaku setelah alamat berubah', async () => {
    const f = await fixture();
    const u = await createUser();
    const { a: own } = await login(f.app, u.username, u.password!);
    const email = `baru${uniq()}@rein.test`;
    expect((await own.post('/api/me/email', { email })).status).toBe(200);
    expect((await own.post('/api/auth/verify-email/resend')).status).toBe(200);
    const oldCode = /\b(\d{6})\b/.exec(f.mail.outbox.at(-1)!.subject)![1];
    expect(f.mail.outbox.at(-1)!.to).toBe(email);
    expect((await (await own.get('/api/auth/me')).json()).user.email).toBe(u.email);
    const finalEmail = `akhir${uniq()}@rein.test`;
    await own.post('/api/me/email', { email: finalEmail });
    expect((await own.post('/api/auth/verify-email/code', { code: oldCode })).status).toBe(410);
    await own.post('/api/auth/verify-email/resend');
    const code = /\b(\d{6})\b/.exec(f.mail.outbox.at(-1)!.subject)![1];
    expect((await own.post('/api/auth/verify-email/code', { code })).status).toBe(200);
    expect((await (await own.get('/api/auth/me')).json()).user.email).toBe(finalEmail);
  });

  it('preferensi terbaru mematikan delivery email yang telanjur antre; kegagalan provider dijadwalkan ulang', async () => {
    const f = await fixture();
    const u = await createUser();
    await testDb().insert(userSettings).values({ userId: u.id, quietEnabled: false });
    const event = {
      event: 'wo.updated' as const,
      recipients: [u.id],
      entityType: 'wo' as const,
      entityId: randomUUID(),
      title: 'Antrean',
      body: 'Uji',
      url: '/tugas',
    };
    await enqueueNotifications(testDb(), event);
    await testDb()
      .update(userSettings)
      .set({ notifyEmail: false })
      .where(eq(userSettings.userId, u.id));
    let calls = 0;
    const mail = {
      name: 'test',
      send: async () => {
        calls++;
        throw new Error('provider sementara gagal');
      },
    };
    await deliverEmail({ ...f.deps, mail }, new Date(Date.now() + 1000));
    expect(calls).toBe(0);
    await testDb()
      .update(userSettings)
      .set({ notifyEmail: true })
      .where(eq(userSettings.userId, u.id));
    await enqueueNotifications(testDb(), event);
    const result = await deliverEmail({ ...f.deps, mail }, new Date(Date.now() + 1000));
    expect(calls).toBe(1);
    expect(result.retry).toBe(1);
    const n = await testDb().query.notifications.findMany({
      where: eq(notifications.userId, u.id),
    });
    const delivery = await testDb()
      .select()
      .from(notificationDeliveries)
      .where(
        inArray(
          notificationDeliveries.notificationId,
          n.map((r) => r.id),
        ),
      );
    expect(delivery.some((d) => d.lastError === 'preference_disabled')).toBe(true);
    expect(delivery.some((d) => d.status === 'queued' && d.attempts === 1)).toBe(true);
  });
  it('antrean WA/email tidak dikirim jika akses project dicabut sebelum pengiriman', async () => {
    const f = await fixture();
    const u = await createUser({ role: 'manager' });
    const { a: manager } = await login(f.app, u.username, u.password!);
    const created = await manager.post('/api/projects', {
      clientName: 'Klien antrean',
      name: 'Akses dicabut',
      rpoNumber: `RPO-${uniq()}`,
      startDate: '2026-11-16',
      endDate: '2026-12-16',
    });
    expect(created.status).toBe(201);
    const projectId = (await created.json()).id;
    await testDb()
      .insert(userContacts)
      .values({ userId: u.id, kind: 'whatsapp', value: '+6281398765432', verifiedAt: new Date() });
    await testDb().insert(userSettings).values({ userId: u.id, quietEnabled: false });
    await enqueueNotifications(testDb(), {
      event: 'project.member_added',
      recipients: [u.id],
      projectId,
      entityType: 'project',
      entityId: projectId,
      title: 'Rahasia project',
      body: 'Tidak dikirim',
      url: `/project/${projectId}`,
      waText: 'Tidak dikirim',
    });
    await testDb()
      .insert(userPermissions)
      .values({ userId: u.id, permissionKey: 'project.view', scope: 'none' });
    let sent = 0;
    const mail = {
      name: 'test',
      send: async () => {
        sent++;
        return { id: 'test' };
      },
    };
    const now = new Date(Date.now() + 1000);
    await deliverWhatsApp(f.deps, now);
    await deliverEmail({ ...f.deps, mail }, now);
    expect(sent).toBe(0);
    const rows = await testDb().select().from(notifications).where(eq(notifications.userId, u.id));
    const deliveries = await testDb()
      .select()
      .from(notificationDeliveries)
      .where(
        inArray(
          notificationDeliveries.notificationId,
          rows.map((r) => r.id),
        ),
      );
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.lastError === 'access_revoked')).toBe(true);
  });
});
