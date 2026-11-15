import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userContacts, verificationCodes } from '../db/schema';
import type { Env } from '../env';
import { hmacHex, randomToken, safeEqual, sha256Hex, sixDigitCode } from '../lib/crypto';
import { HttpError } from '../lib/http';
import type { MailProvider } from '../mail/provider';
import { activationMail, verifyEmailMail } from '../mail/templates';

const MINUTE = 60_000;
export const ACTIVATION_TTL_MS = 72 * 60 * MINUTE;
export const EMAIL_CODE_TTL_MS = 15 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;

export const tokenInvalid = () =>
  new HttpError(410, 'TOKEN_INVALID', 'Tautan tidak berlaku atau sudah dipakai');

type MailDeps = { db: Db; env: Env; mail: MailProvider };

/** Matikan kode/tautan lama yang belum dipakai untuk tujuan yang sama. */
async function expireOutstanding(db: Db, userId: string, purpose: 'activate' | 'verify_email') {
  await db
    .update(verificationCodes)
    .set({ expiresAt: new Date() })
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, sql`now()`),
      ),
    );
}

/** FR-002: buat tautan aktivasi (72 jam) dan kirim email undangan. */
export async function issueActivation(
  deps: MailDeps,
  p: {
    userId: string;
    contactId: string;
    email: string;
    name: string;
    username: string;
    inviterName: string;
  },
): Promise<{ sent: boolean }> {
  const { db, env, mail } = deps;
  await expireOutstanding(db, p.userId, 'activate');
  const token = randomToken(32);
  await db.insert(verificationCodes).values({
    userId: p.userId,
    contactId: p.contactId,
    purpose: 'activate',
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
  });
  const link = `${env.APP_URL}/aktivasi?token=${encodeURIComponent(token)}`;
  try {
    await mail.send({
      to: p.email,
      ...activationMail({ name: p.name, inviterName: p.inviterName, username: p.username, link }),
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

export interface ActivationTarget {
  codeId: string;
  userId: string;
  contactId: string | null;
}

export async function findActivation(db: Db, token: string): Promise<ActivationTarget> {
  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.tokenHash, sha256Hex(token)),
      eq(verificationCodes.purpose, 'activate'),
      isNull(verificationCodes.consumedAt),
      gt(verificationCodes.expiresAt, sql`now()`),
    ),
  });
  if (!row) throw tokenInvalid();
  return { codeId: row.id, userId: row.userId, contactId: row.contactId };
}

export async function consumeCode(db: Db, codeId: string): Promise<void> {
  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(verificationCodes.id, codeId));
}

/** FR-003 AC1: kode 6 digit + magic link dalam satu email, berlaku 15 menit. */
export async function issueEmailVerification(
  deps: MailDeps,
  p: { userId: string; contactId: string; email: string; name: string },
): Promise<{ sent: boolean }> {
  const { db, env, mail } = deps;
  await expireOutstanding(db, p.userId, 'verify_email');
  const code = sixDigitCode();
  const token = randomToken(32);
  await db.insert(verificationCodes).values({
    userId: p.userId,
    contactId: p.contactId,
    purpose: 'verify_email',
    codeHash: hmacHex(code, env.AUTH_PEPPER),
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
  });
  const link = `${env.APP_URL}/verifikasi/email?token=${encodeURIComponent(token)}`;
  try {
    await mail.send({ to: p.email, ...verifyEmailMail({ name: p.name, code, link }) });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

/** Tandai kontak email terverifikasi. Menolak jika email yang sama sudah terverifikasi milik user lain. */
export async function markEmailVerified(db: Db, contactId: string): Promise<void> {
  const contact = await db.query.userContacts.findFirst({ where: eq(userContacts.id, contactId) });
  if (!contact) throw tokenInvalid();
  if (contact.verifiedAt) return;
  const taken = await db.query.userContacts.findFirst({
    where: and(
      eq(userContacts.kind, 'email'),
      eq(userContacts.value, contact.value),
      ne(userContacts.id, contact.id),
      sql`${userContacts.verifiedAt} is not null`,
    ),
  });
  if (taken) throw new HttpError(409, 'EMAIL_TAKEN', 'Email ini sudah dipakai akun lain');
  await db
    .update(userContacts)
    .set({ verifiedAt: new Date(), pending: false })
    .where(eq(userContacts.id, contactId));
}

/** Verifikasi kode 6 digit milik user (maks. 5 percobaan per kode). */
export async function verifyEmailCode(
  db: Db,
  env: Env,
  userId: string,
  code: string,
): Promise<{ contactId: string }> {
  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.userId, userId),
      eq(verificationCodes.purpose, 'verify_email'),
      isNull(verificationCodes.consumedAt),
      gt(verificationCodes.expiresAt, sql`now()`),
    ),
    orderBy: desc(verificationCodes.createdAt),
  });
  if (!row || !row.codeHash || !row.contactId) {
    throw new HttpError(410, 'CODE_EXPIRED', 'Kode sudah tidak berlaku. Kirim ulang kode.');
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan. Kirim ulang kode.');
  }
  if (!safeEqual(row.codeHash, hmacHex(code, env.AUTH_PEPPER))) {
    await db
      .update(verificationCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(verificationCodes.id, row.id));
    const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
    throw new HttpError(
      422,
      'CODE_INVALID',
      left > 0 ? `Kode salah. Sisa ${left} percobaan.` : 'Kode salah. Kirim ulang kode.',
      { code: 'Kode salah' },
    );
  }
  await markEmailVerified(db, row.contactId);
  await consumeCode(db, row.id);
  return { contactId: row.contactId };
}

/** Verifikasi lewat magic link (tidak butuh sesi — token adalah buktinya). */
export async function verifyEmailToken(
  db: Db,
  token: string,
): Promise<{ userId: string; contactId: string }> {
  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.tokenHash, sha256Hex(token)),
      eq(verificationCodes.purpose, 'verify_email'),
      isNull(verificationCodes.consumedAt),
      gt(verificationCodes.expiresAt, sql`now()`),
    ),
  });
  if (!row || !row.contactId) throw tokenInvalid();
  await markEmailVerified(db, row.contactId);
  await consumeCode(db, row.id);
  return { userId: row.userId, contactId: row.contactId };
}

export async function primaryEmailContact(db: Db, userId: string) {
  return db.query.userContacts.findFirst({
    where: and(
      eq(userContacts.userId, userId),
      eq(userContacts.kind, 'email'),
      eq(userContacts.isPrimary, true),
    ),
  });
}
