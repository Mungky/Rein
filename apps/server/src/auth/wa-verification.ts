/**
 * Verifikasi nomor WhatsApp "dibalik" (FR-003 AC2, revisi 1.3):
 *  1. User memasukkan nomor → REIN membuat kode `REIN-XXXXXX` (berlaku 10 menit) dan tautan
 *     `https://wa.me/<nomor REIN>?text=REIN-XXXXXX`.
 *  2. User MENGIRIM kode itu ke nomor REIN (user yang memulai chat → risiko blokir turun).
 *  3. Webhook OpenWA `message.received` → kode + nomor pengirim cocok → nomor terverifikasi.
 * Fallback: Admin memverifikasi manual (`markWhatsAppVerified`).
 */
import { randomInt } from 'node:crypto';
import { normalizePhoneId } from '@rein/shared';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userContacts, verificationCodes } from '../db/schema';
import type { Env } from '../env';
import { hmacHex } from '../lib/crypto';
import { HttpError } from '../lib/http';

export const WA_CODE_TTL_MS = 10 * 60_000;
export const WA_CODE_PATTERN = /\bREIN-([A-HJ-NP-Z2-9]{6})\b/i;
/** Tanpa 0/O/1/I agar mudah dibaca. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const phoneTaken = () =>
  new HttpError(409, 'PHONE_TAKEN', 'Nomor WhatsApp ini sudah dipakai akun lain', {
    phone: 'Nomor sudah dipakai akun lain',
  });

export function waCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return `REIN-${s}`;
}

const codeHash = (code: string, env: Env) => hmacHex(code.toUpperCase(), env.AUTH_PEPPER);

export function waMeLink(env: Env, text: string): string | null {
  const digits = (env.REIN_WA_NUMBER ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

async function takenByOther(db: Db, userId: string, phone: string): Promise<boolean> {
  const row = await db.query.userContacts.findFirst({
    where: and(
      eq(userContacts.kind, 'whatsapp'),
      eq(userContacts.value, phone),
      ne(userContacts.userId, userId),
      sql`${userContacts.verifiedAt} is not null`,
    ),
  });
  return Boolean(row);
}

/** Langkah 1: simpan nomor (pending) dan buat kode. Kode lama yang belum dipakai dimatikan. */
export async function issueWhatsAppVerification(
  db: Db,
  env: Env,
  userId: string,
  rawPhone: string,
): Promise<{
  contactId: string;
  phone: string;
  code: string;
  link: string | null;
  expiresAt: Date;
}> {
  const phone = normalizePhoneId(rawPhone);
  if (!phone) {
    throw new HttpError(422, 'VALIDATION', 'Nomor WhatsApp tidak valid', {
      phone: 'Gunakan format 08… atau +62…',
    });
  }
  if (await takenByOther(db, userId, phone)) throw phoneTaken();

  const existing = await db.query.userContacts.findFirst({
    where: and(
      eq(userContacts.userId, userId),
      eq(userContacts.kind, 'whatsapp'),
      eq(userContacts.value, phone),
    ),
  });
  if (existing?.verifiedAt) {
    throw new HttpError(409, 'ALREADY_VERIFIED', 'Nomor ini sudah terverifikasi');
  }
  const contactId =
    existing?.id ??
    (
      await db
        .insert(userContacts)
        .values({ userId, kind: 'whatsapp', value: phone, pending: true })
        .returning({ id: userContacts.id })
    )[0]!.id;

  await db
    .update(verificationCodes)
    .set({ expiresAt: new Date() })
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, 'verify_whatsapp'),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, sql`now()`),
      ),
    );
  const code = waCode();
  const expiresAt = new Date(Date.now() + WA_CODE_TTL_MS);
  await db.insert(verificationCodes).values({
    userId,
    contactId,
    purpose: 'verify_whatsapp',
    codeHash: codeHash(code, env),
    expiresAt,
  });
  return { contactId, phone, code, link: waMeLink(env, code), expiresAt };
}

/**
 * Tandai nomor terverifikasi dan jadikan satu-satunya nomor WA user (nomor lama dihapus).
 * Dipakai webhook dan verifikasi manual Admin.
 */
export async function markWhatsAppVerified(db: Db, contactId: string): Promise<{ userId: string }> {
  return db.transaction(async (tx) => {
    const contact = await tx.query.userContacts.findFirst({
      where: eq(userContacts.id, contactId),
    });
    if (!contact || contact.kind !== 'whatsapp') {
      throw new HttpError(404, 'NOT_FOUND', 'Kontak tidak ditemukan');
    }
    const taken = await tx.query.userContacts.findFirst({
      where: and(
        eq(userContacts.kind, 'whatsapp'),
        eq(userContacts.value, contact.value),
        ne(userContacts.userId, contact.userId),
        sql`${userContacts.verifiedAt} is not null`,
      ),
    });
    if (taken) throw phoneTaken();
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

export type WaMessageResult =
  | { ok: true; userId: string; contactId: string; phone: string; codeId: string }
  | { ok: false; reason: 'no_code' | 'no_sender' | 'unknown_code' | 'phone_mismatch' | 'taken' };

/** Langkah 3: cocokkan pesan masuk (webhook) dengan kode yang masih berlaku. */
export async function verifyWhatsAppFromMessage(
  db: Db,
  env: Env,
  sender: string | null | undefined,
  text: string | null | undefined,
): Promise<WaMessageResult> {
  const m = WA_CODE_PATTERN.exec(text ?? '');
  if (!m) return { ok: false, reason: 'no_code' };
  const phone = sender ? normalizePhoneId(sender) : null;
  if (!phone) return { ok: false, reason: 'no_sender' };

  const row = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.codeHash, codeHash(`REIN-${m[1]}`, env)),
      eq(verificationCodes.purpose, 'verify_whatsapp'),
      isNull(verificationCodes.consumedAt),
      gt(verificationCodes.expiresAt, sql`now()`),
    ),
  });
  if (!row?.contactId) return { ok: false, reason: 'unknown_code' };
  const contact = await db.query.userContacts.findFirst({
    where: eq(userContacts.id, row.contactId),
  });
  if (!contact || contact.value !== phone) {
    // Kode benar dari nomor lain: hitung sebagai percobaan, kode tetap berlaku sampai habis.
    await db
      .update(verificationCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(verificationCodes.id, row.id));
    return { ok: false, reason: 'phone_mismatch' };
  }
  try {
    await markWhatsAppVerified(db, contact.id);
  } catch (err) {
    if (err instanceof HttpError && err.code === 'PHONE_TAKEN')
      return { ok: false, reason: 'taken' };
    throw err;
  }
  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(verificationCodes.id, row.id));
  return { ok: true, userId: row.userId, contactId: contact.id, phone, codeId: row.id };
}
