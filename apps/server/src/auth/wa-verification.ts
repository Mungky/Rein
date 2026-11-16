import { normalizePhoneId } from '@rein/shared';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userContacts, verificationCodes } from '../db/schema';
import type { Env } from '../env';
import { hmacHex, safeEqual, sixDigitCode } from '../lib/crypto';
import { HttpError } from '../lib/http';
import type { WhatsAppProvider } from '../wa/provider';

export const WA_CODE_TTL_MS = 10 * 60_000;
export const WA_RESEND_MS = 60_000;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const codeHash = (code: string, env: Env) => hmacHex(`wa-otp:${code}`, env.AUTH_PEPPER);
const phoneTaken = () =>
  new HttpError(409, 'PHONE_TAKEN', 'Nomor WhatsApp ini sudah dipakai akun lain');

/** Kode hanya dikirim lewat provider, tidak pernah dikembalikan ke klien atau log. */
export async function issueWhatsAppVerification(
  db: Db,
  env: Env,
  wa: WhatsAppProvider,
  userId: string,
  rawPhone: string,
) {
  const phone = normalizePhoneId(rawPhone);
  if (!phone) throw new HttpError(422, 'VALIDATION', 'Nomor WhatsApp tidak valid');
  return db.transaction(async (tx) => {
    // Serialisasi permintaan paralel, termasuk bila server berjalan di beberapa proses.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa-user:${userId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa-phone:${phone}`}))`);
    const recent = await tx
      .select({ createdAt: verificationCodes.createdAt })
      .from(verificationCodes)
      .leftJoin(userContacts, eq(userContacts.id, verificationCodes.contactId))
      .where(
        and(
          eq(verificationCodes.purpose, 'verify_whatsapp'),
          sql`(${verificationCodes.userId} = ${userId} or ${userContacts.value} = ${phone})`,
          gt(verificationCodes.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
        ),
      )
      .orderBy(desc(verificationCodes.createdAt));
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < WA_RESEND_MS) {
      throw new HttpError(429, 'RATE_LIMITED', 'Tunggu satu menit sebelum meminta kode baru.');
    }
    if (recent.length >= 5)
      throw new HttpError(429, 'RATE_LIMITED', 'Batas 5 kode per hari tercapai. Coba lagi besok.');
    const contacts = await tx
      .select()
      .from(userContacts)
      .where(and(eq(userContacts.kind, 'whatsapp'), eq(userContacts.value, phone)));
    if (contacts.some((c) => c.userId !== userId && c.verifiedAt)) throw phoneTaken();
    const existing = contacts.find((c) => c.userId === userId);
    if (existing?.verifiedAt)
      throw new HttpError(409, 'ALREADY_VERIFIED', 'Nomor ini sudah terverifikasi');
    const contactId =
      existing?.id ??
      (
        await tx
          .insert(userContacts)
          .values({ userId, kind: 'whatsapp', value: phone, pending: true })
          .returning({ id: userContacts.id })
      )[0]!.id;
    await tx
      .update(verificationCodes)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, 'verify_whatsapp'),
          isNull(verificationCodes.consumedAt),
        ),
      );
    const code = sixDigitCode();
    const expiresAt = new Date(Date.now() + WA_CODE_TTL_MS);
    const [challenge] = await tx
      .insert(verificationCodes)
      .values({
        userId,
        contactId,
        purpose: 'verify_whatsapp',
        codeHash: codeHash(code, env),
        expiresAt,
      })
      .returning({ id: verificationCodes.id });
    try {
      if (wa.name === 'openwa' && (await wa.session()).status !== 'ready')
        throw new Error('not ready');
      await wa.sendText(
        phone,
        `Kode verifikasi REIN: ${code}\nBerlaku 10 menit. Jangan bagikan kode ini kepada siapa pun.`,
        `otp-${challenge!.id}`,
      );
    } catch {
      // Rollback: kegagalan pengiriman tidak meninggalkan kode aktif.
      throw new HttpError(
        502,
        'WA_SEND_FAILED',
        'Kode belum terkirim. Coba lagi atau hubungi Admin.',
      );
    }
    return {
      contactId,
      challengeId: challenge!.id,
      phone,
      expiresAt,
      resendAt: new Date(Date.now() + WA_RESEND_MS),
    };
  });
}

/** Dipakai OTP dan verifikasi manual Admin; nomor lama dilepas sesudah nomor baru sah. */
export async function markWhatsAppVerified(
  db: Db | Tx,
  contactId: string,
): Promise<{ userId: string }> {
  return db.transaction(async (tx) => {
    const contact = await tx.query.userContacts.findFirst({
      where: eq(userContacts.id, contactId),
    });
    if (!contact || contact.kind !== 'whatsapp')
      throw new HttpError(404, 'NOT_FOUND', 'Kontak tidak ditemukan');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa-phone:${contact.value}`}))`);
    const taken = await tx.query.userContacts.findFirst({
      where: and(
        eq(userContacts.kind, 'whatsapp'),
        eq(userContacts.value, contact.value),
        ne(userContacts.userId, contact.userId),
        sql`${userContacts.verifiedAt} is not null`,
      ),
    });
    if (taken) throw phoneTaken();
    // Simpan riwayat batas kirim akun meskipun kontak lama dilepas (FK cascade).
    await tx
      .update(verificationCodes)
      .set({ contactId: null, expiresAt: new Date() })
      .where(
        and(
          eq(verificationCodes.userId, contact.userId),
          eq(verificationCodes.purpose, 'verify_whatsapp'),
          ne(verificationCodes.contactId, contact.id),
        ),
      );
    await tx
      .delete(userContacts)
      .where(
        and(
          eq(userContacts.userId, contact.userId),
          eq(userContacts.kind, 'whatsapp'),
          ne(userContacts.id, contact.id),
        ),
      );
    await tx
      .update(userContacts)
      .set({
        verifiedAt: contact.verifiedAt ?? new Date(),
        pending: false,
        isPrimary: true,
        updatedAt: new Date(),
      })
      .where(eq(userContacts.id, contact.id));
    return { userId: contact.userId };
  });
}

export async function verifyWhatsAppCode(
  db: Db,
  env: Env,
  userId: string,
  challengeId: string,
  code: string,
) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa-user:${userId}`}))`);
    const row = await tx.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.id, challengeId),
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, 'verify_whatsapp'),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, sql`now()`),
      ),
    });
    if (!row?.contactId || row.attempts >= 5) return { error: 'expired' } as const;
    if (!row.codeHash || !safeEqual(row.codeHash, codeHash(code, env))) {
      await tx
        .update(verificationCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(verificationCodes.id, row.id));
      return { error: 'invalid' } as const;
    }
    await markWhatsAppVerified(tx, row.contactId);
    await tx
      .update(verificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCodes.id, row.id));
    return { contactId: row.contactId };
  });
  // Kegagalan harus dikomit agar penghitung percobaan tidak ikut rollback.
  if ('error' in result)
    throw result.error === 'expired'
      ? new HttpError(410, 'CODE_EXPIRED', 'Kode sudah tidak berlaku. Minta kode baru.')
      : new HttpError(422, 'CODE_INVALID', 'Kode salah. Periksa pesan WhatsApp Anda.');
  return result;
}
