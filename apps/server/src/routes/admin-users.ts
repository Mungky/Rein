import { inviteUserSchema } from '@rein/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { audit } from '../audit';
import { authOf, requirePermission, requireVerified } from '../auth/middleware';
import { revokeAllSessions } from '../auth/session';
import { issueActivation, primaryEmailContact } from '../auth/verification';
import type { AppEnv } from '../context';
import { roles, userContacts, users } from '../db/schema';
import { userAgent } from '../lib/ip';
import { HttpError, notFound, readJson } from '../lib/http';

/** FR-090 / FR-091 (sebagian, M0): daftar pengguna, undang, kirim ulang, aktif/nonaktif. */
export const adminUserRoutes = new Hono<AppEnv>()
  .use(requireVerified)

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

    const { sent } = await issueActivation(
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
    return c.json({ id: created.userId, mailSent: sent }, 201);
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
    const { sent } = await issueActivation(
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
    return c.json({ mailSent: sent });
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
