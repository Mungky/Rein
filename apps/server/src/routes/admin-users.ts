import { adminVerifyWhatsAppSchema, inviteUserSchema, userRoleSchema } from '@rein/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requirePermission, requireVerified } from '../auth/middleware';
import { revokeAllSessions } from '../auth/session';
import { issueActivation, primaryEmailContact } from '../auth/verification';
import { markWhatsAppVerified } from '../auth/wa-verification';
import type { AppEnv } from '../context';
import { devices, roles, userContacts, users } from '../db/schema';
import { userAgent } from '../lib/ip';
import { HttpError, notFound, readJson } from '../lib/http';

/**
 * FR-090 / FR-091: daftar pengguna, undang, kirim ulang, aktif/nonaktif, reset PIN, verifikasi
 * WA manual. D3: selama email ditunda, respons undang/kirim ulang membawa `activationLink`
 * (token hanya ditampilkan sekali) untuk dibagikan Admin sendiri.
 */
export const adminUserRoutes = new Hono<AppEnv>()
  .use(requireVerified)

  .post('/users/:id/role', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const { roleId } = await readJson(c, userRoleSchema);
    if (id === a.user.id) {
      throw new HttpError(
        409,
        'SELF',
        'Minta Admin lain mengubah role akun Anda. Izin role Anda bisa diatur lewat Role & izin.',
      );
    }
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
    if (!role)
      throw new HttpError(422, 'VALIDATION', 'Role tidak ditemukan', {
        roleId: 'Role tidak ditemukan',
      });
    await db.transaction(async (tx) => {
      await tx.update(users).set({ roleId }).where(eq(users.id, id));
      await audit(tx, {
        actorId: a.user.id,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        diff: { from: user.roleId, to: roleId },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ ok: true });
  })

  .get('/roles', requirePermission('admin.users'), async (c) => {
    const rows = await c.var.deps.db
      .select({ id: roles.id, name: roles.name, divisionLabel: roles.divisionLabel })
      .from(roles)
      .orderBy(asc(roles.name));
    return c.json({ roles: rows });
  })

  .get('/users', requirePermission('admin.users'), async (c) => {
    const rows = await c.var.deps.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        lastActiveAt: users.lastActiveAt,
        createdAt: users.createdAt,
        email: userContacts.value,
        emailVerifiedAt: userContacts.verifiedAt,
        whatsapp: sql<string | null>`(
          select uc.value from user_contacts uc
           where uc.user_id = ${users.id} and uc.kind = 'whatsapp'
           order by uc.verified_at desc nulls last, uc.created_at desc limit 1)`,
        whatsappVerified: sql<boolean>`exists(
          select 1 from user_contacts uc
           where uc.user_id = ${users.id} and uc.kind = 'whatsapp' and uc.verified_at is not null)`,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(
        userContacts,
        and(
          eq(userContacts.userId, users.id),
          eq(userContacts.kind, 'email'),
          eq(userContacts.isPrimary, true),
        ),
      )
      .orderBy(asc(users.fullName));
    return c.json({
      users: rows.map((r) => ({ ...r, emailVerified: r.emailVerifiedAt != null })),
    });
  })

  .post('/users/invite', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db, env, mail } = c.var.deps;
    const body = await readJson(c, inviteUserSchema);

    const role = await db.query.roles.findFirst({ where: eq(roles.id, body.roleId) });
    if (!role)
      throw new HttpError(422, 'VALIDATION', 'Role tidak ditemukan', {
        roleId: 'Role tidak ditemukan',
      });
    const byUsername = await db.query.users.findFirst({ where: eq(users.username, body.username) });
    if (byUsername) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'Username sudah dipakai', {
        username: 'Username sudah dipakai',
      });
    }
    const byEmail = await db.query.userContacts.findFirst({
      where: and(eq(userContacts.kind, 'email'), eq(userContacts.value, body.email)),
    });
    if (byEmail) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar', {
        email: 'Email sudah terdaftar',
      });
    }

    const created = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          username: body.username,
          fullName: body.fullName,
          roleId: role.id,
          status: 'invited',
        })
        .returning({ id: users.id });
      if (!u) throw new Error('Gagal membuat user');
      const [contact] = await tx
        .insert(userContacts)
        .values({ userId: u.id, kind: 'email', value: body.email, isPrimary: true })
        .returning({ id: userContacts.id });
      if (body.whatsapp) {
        await tx
          .insert(userContacts)
          .values({ userId: u.id, kind: 'whatsapp', value: body.whatsapp, isPrimary: true });
      }
      await audit(tx, {
        actorId: a.user.id,
        action: 'user.invited',
        entityType: 'user',
        entityId: u.id,
        diff: { username: body.username, email: body.email, role: role.name },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
      return { userId: u.id, contactId: contact!.id };
    });

    const { sent, link } = await issueActivation(
      { db, env, mail },
      {
        userId: created.userId,
        contactId: created.contactId,
        email: body.email,
        name: body.fullName,
        username: body.username,
        inviterName: a.user.fullName,
      },
    );
    return c.json({ id: created.userId, mailSent: sent, activationLink: link }, 201);
  })

  .post('/users/:id/resend-invite', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db, env, mail } = c.var.deps;
    const user = await db.query.users.findFirst({ where: eq(users.id, c.req.param('id')) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    if (user.status !== 'invited') {
      throw new HttpError(409, 'NOT_INVITED', 'Pengguna ini sudah aktif atau nonaktif');
    }
    const contact = await primaryEmailContact(db, user.id);
    if (!contact) throw new HttpError(409, 'NO_EMAIL', 'Pengguna tidak punya email');
    const { sent, link } = await issueActivation(
      { db, env, mail },
      {
        userId: user.id,
        contactId: contact.id,
        email: contact.value,
        name: user.fullName,
        username: user.username,
        inviterName: a.user.fullName,
      },
    );
    await audit(db, {
      actorId: a.user.id,
      action: 'user.invite_resent',
      entityType: 'user',
      entityId: user.id,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ mailSent: sent, activationLink: link });
  })

  /** FR-090 AC: user disabled langsung kehilangan semua sesi. */
  .post('/users/:id/disable', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    if (id === a.user.id)
      throw new HttpError(409, 'SELF', 'Anda tidak bisa menonaktifkan akun sendiri');
    const [u] = await db
      .update(users)
      .set({ status: 'disabled' })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!u) throw notFound('Pengguna tidak ditemukan');
    await revokeAllSessions(db, id, { untrustDevices: true });
    await audit(db, {
      actorId: a.user.id,
      action: 'user.disabled',
      entityType: 'user',
      entityId: id,
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true });
  })

  /** FR-091: reset PIN semua perangkat user (wajib login password lalu buat PIN baru). */
  .post('/users/:id/reset-pin', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const res = await db
      .update(devices)
      .set({ pinHash: null, pinFailedCount: 0, pinDisabledAt: null, updatedAt: new Date() })
      .where(eq(devices.userId, id));
    await audit(db, {
      actorId: a.user.id,
      action: 'auth.pin.reset_by_admin',
      entityType: 'user',
      entityId: id,
      diff: { devices: res.rowCount ?? 0 },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true, devices: res.rowCount ?? 0 });
  })

  /** FR-003 AC2 fallback: Admin memverifikasi nomor WA secara manual. */
  .post('/users/:id/verify-whatsapp', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const { phone } = await readJson(c, adminVerifyWhatsAppSchema);
    let contact = phone
      ? await db.query.userContacts.findFirst({
          where: and(
            eq(userContacts.userId, id),
            eq(userContacts.kind, 'whatsapp'),
            eq(userContacts.value, phone),
          ),
        })
      : await db.query.userContacts.findFirst({
          where: and(eq(userContacts.userId, id), eq(userContacts.kind, 'whatsapp')),
          orderBy: (t, { desc }) => desc(t.createdAt),
        });
    if (!contact && phone) {
      [contact] = await db
        .insert(userContacts)
        .values({ userId: id, kind: 'whatsapp', value: phone, pending: true })
        .returning();
    }
    if (!contact) {
      throw new HttpError(422, 'VALIDATION', 'Isi nomor WhatsApp pengguna', {
        phone: 'Nomor WhatsApp wajib diisi',
      });
    }
    await markWhatsAppVerified(db, contact.id);
    await audit(db, {
      actorId: a.user.id,
      action: 'contact.whatsapp_verified',
      entityType: 'user',
      entityId: id,
      diff: { method: 'admin', phone: contact.value },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true, phone: contact.value });
  })

  .post('/users/:id/enable', requirePermission('admin.users'), async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const [u] = await db
      .update(users)
      .set({
        status: sql`case when ${users.passwordHash} is null and ${users.googleSub} is null then 'invited'::user_status else 'active'::user_status end`,
      })
      .where(and(eq(users.id, id), eq(users.status, 'disabled')))
      .returning({ id: users.id, status: users.status });
    if (!u) throw notFound('Pengguna nonaktif tidak ditemukan');
    await audit(db, {
      actorId: a.user.id,
      action: 'user.enabled',
      entityType: 'user',
      entityId: id,
      diff: { status: u.status },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
    return c.json({ ok: true, status: u.status });
  });
