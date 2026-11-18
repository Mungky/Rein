import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { audit } from '../audit';
import type { Deps } from '../context';
import { userContacts, users, verificationCodes } from '../db/schema';
import { randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { notificationMail } from '../mail/templates';
import { hashSecret } from './password';
import { passwordProblem } from './password-policy';
import { revokeAllSessions } from './session';
import { expireOutstanding, tokenInvalid } from './verification';

const RESET_TTL_MS = 30 * 60_000;
type AuditActor = { actorId: string | null; ip: string; userAgent: string | null };

export async function issuePasswordReset(deps: Deps, userId: string, actor: AuditActor) {
  const { db, env, mail } = deps;
  if (mail.name === 'null') return false;
  const token = randomToken(32);
  const email = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (user?.status !== 'active') return null;
    const contact = await tx.query.userContacts.findFirst({
      where: and(
        eq(userContacts.userId, userId),
        eq(userContacts.kind, 'email'),
        eq(userContacts.isPrimary, true),
        isNotNull(userContacts.verifiedAt),
      ),
    });
    if (!contact) return null;
    await expireOutstanding(tx, userId, 'reset_password');
    await tx.insert(verificationCodes).values({
      userId,
      contactId: contact.id,
      purpose: 'reset_password',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    await audit(tx, {
      ...actor,
      action: 'auth.password.reset_requested',
      entityType: 'user',
      entityId: userId,
    });
    return contact.value;
  });
  if (!email) return false;
  try {
    const link = `${env.APP_URL}/reset-password#token=${encodeURIComponent(token)}`;
    await mail.send({
      to: email,
      ...notificationMail(
        'Reset password',
        'Gunakan tautan ini untuk membuat password baru. Tautan hanya berlaku 30 menit dan sekali pakai. Abaikan email ini jika Anda tidak meminta reset.',
        link,
      ),
    });
    return true;
  } catch {
    return false;
  }
}

export async function resetPassword(
  deps: Deps,
  token: string,
  password: string,
  actor: AuditActor,
) {
  const { db, env } = deps;
  const valid = and(
    eq(verificationCodes.purpose, 'reset_password'),
    eq(verificationCodes.tokenHash, sha256Hex(token)),
    isNull(verificationCodes.consumedAt),
    gt(verificationCodes.expiresAt, sql`clock_timestamp()`),
  );
  const challenge = await db.query.verificationCodes.findFirst({ where: valid });
  if (!challenge?.contactId) throw tokenInvalid();
  const passwordHash = await hashSecret(password, env.AUTH_PEPPER);
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, challenge.userId))
      .for('update');
    if (user?.status !== 'active') throw tokenInvalid();
    const contact = await tx.query.userContacts.findFirst({
      where: and(
        eq(userContacts.id, challenge.contactId!),
        eq(userContacts.userId, user.id),
        eq(userContacts.kind, 'email'),
        eq(userContacts.isPrimary, true),
        isNotNull(userContacts.verifiedAt),
      ),
    });
    if (!contact) throw tokenInvalid();
    const problem = passwordProblem(password, { username: user.username, email: contact.value });
    if (problem) throw new HttpError(422, 'VALIDATION', problem, { password: problem });
    const now = new Date();
    const [claimed] = await tx
      .update(verificationCodes)
      .set({ consumedAt: now })
      .where(valid)
      .returning({ id: verificationCodes.id });
    if (!claimed) throw tokenInvalid();
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        lockedUntil: null,
      })
      .where(eq(users.id, user.id));
    await revokeAllSessions(tx, user.id);
    await audit(tx, {
      ...actor,
      actorId: user.id,
      action: 'auth.password.reset',
      entityType: 'user',
      entityId: user.id,
    });
  });
}
