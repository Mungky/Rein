import { emailSchema, notificationChannelsSchema } from '@rein/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { authOf, requireAuth, requirePermission, requireVerified } from '../auth/middleware';
import type { AppEnv, Deps } from '../context';
import { userContacts, userSettings, users, verificationCodes } from '../db/schema';
import { HttpError, notFound, readJson } from '../lib/http';
import { userAgent } from '../lib/ip';

async function settings(deps: Deps, userId: string) {
  const setting = await deps.db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const contacts = await deps.db
    .select()
    .from(userContacts)
    .where(eq(userContacts.userId, userId))
    .orderBy(desc(userContacts.createdAt));
  const email =
    contacts.find((r) => r.kind === 'email' && r.pending) ??
    contacts.find((r) => r.kind === 'email' && r.isPrimary);
  const wa =
    contacts.find((r) => r.kind === 'whatsapp' && r.verifiedAt) ??
    contacts.find((r) => r.kind === 'whatsapp');
  return {
    channels:
      setting?.notifyEmail === false
        ? 'whatsapp'
        : setting?.notifyWhatsapp === false
          ? 'email'
          : 'both',
    email: email?.value ?? null,
    emailVerified: !!email?.verifiedAt,
    whatsapp: wa?.value ?? null,
    whatsappVerified: !!wa?.verifiedAt,
    mailEnabled: deps.mail.name !== 'null',
    googleEnabled: Boolean(deps.google) && Boolean(email?.isPrimary),
  };
}

export const preferenceRoutes = new Hono<AppEnv>()
  .get('/me/notifications', requireAuth, async (c) =>
    c.json(await settings(c.var.deps, authOf(c).user.id)),
  )
  .get(
    '/admin/users/:id/notifications',
    requireVerified,
    requirePermission('admin.users'),
    async (c) => {
      if (!(await c.var.deps.db.query.users.findFirst({ where: eq(users.id, c.req.param('id')) })))
        throw notFound('Pengguna tidak ditemukan');
      return c.json(await settings(c.var.deps, c.req.param('id')));
    },
  )
  .put('/me/notifications', requireAuth, saveChannels)
  .put(
    '/admin/users/:id/notifications',
    requireVerified,
    requirePermission('admin.users'),
    saveChannels,
  )
  .post('/me/email', requireAuth, async (c) => {
    const a = authOf(c);
    const { db } = c.var.deps;
    const { email } = await readJson(c, z.object({ email: emailSchema }));
    const taken = await db.query.userContacts.findFirst({
      where: and(
        eq(userContacts.kind, 'email'),
        eq(userContacts.value, email),
        ne(userContacts.userId, a.user.id),
      ),
    });
    if (taken) throw new HttpError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar pada akun lain');
    await db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, a.user.id)).for('update');
      const existing = await tx.query.userContacts.findFirst({
        where: and(
          eq(userContacts.userId, a.user.id),
          eq(userContacts.kind, 'email'),
          eq(userContacts.value, email),
        ),
      });
      if (existing?.verifiedAt) return;
      await tx
        .update(verificationCodes)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(verificationCodes.userId, a.user.id),
            eq(verificationCodes.purpose, 'verify_email'),
          ),
        );
      await tx
        .update(userContacts)
        .set({ pending: false })
        .where(and(eq(userContacts.userId, a.user.id), eq(userContacts.kind, 'email')));
      const primary = await tx.query.userContacts.findFirst({
        where: and(
          eq(userContacts.userId, a.user.id),
          eq(userContacts.kind, 'email'),
          eq(userContacts.isPrimary, true),
        ),
      });
      if (existing)
        await tx
          .update(userContacts)
          .set({ pending: true })
          .where(eq(userContacts.id, existing.id));
      else
        await tx.insert(userContacts).values({
          userId: a.user.id,
          kind: 'email',
          value: email,
          pending: true,
          isPrimary: !primary,
        });
      await audit(tx, {
        actorId: a.user.id,
        action: 'contact.email_changed',
        entityType: 'user',
        entityId: a.user.id,
        diff: { email },
        ip: c.var.ip,
        userAgent: userAgent(c),
      });
    });
    return c.json({ ok: true });
  });

async function saveChannels(c: Context<AppEnv>) {
  const a = authOf(c);
  const userId = c.req.param('id') ?? a.user.id;
  const { db } = c.var.deps;
  if (!(await db.query.users.findFirst({ where: eq(users.id, userId) })))
    throw notFound('Pengguna tidak ditemukan');
  const { channels } = await readJson(c, notificationChannelsSchema);
  const flags = { notifyEmail: channels !== 'whatsapp', notifyWhatsapp: channels !== 'email' };
  await db.transaction(async (tx) => {
    await tx
      .insert(userSettings)
      .values({ userId, ...flags })
      .onConflictDoUpdate({ target: userSettings.userId, set: flags });
    await audit(tx, {
      actorId: a.user.id,
      action: 'user.notification_channels_changed',
      entityType: 'user',
      entityId: userId,
      diff: { channels },
      ip: c.var.ip,
      userAgent: userAgent(c),
    });
  });
  return c.json({ ok: true });
}
