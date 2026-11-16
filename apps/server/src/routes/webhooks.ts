/**
 * POST /webhooks/openwa — dipanggil OpenWA dari jaringan internal Docker.
 * Tanpa sesi/CSRF; keasliannya dibuktikan HMAC-SHA256 atas raw body dengan
 * `OPENWA_WEBHOOK_SECRET` (header `X-OpenWA-Signature: sha256=<hex>`).
 * Event yang dipakai: `message.received` (verifikasi WA dibalik) dan `session.status`.
 */
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { audit } from '../audit';
import { verifyWhatsAppFromMessage } from '../auth/wa-verification';
import type { AppEnv } from '../context';
import { systemState } from '../db/schema';
import { safeEqual } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { publishToUsers } from '../notify/bus';

const MAX_BODY = 256 * 1024;
export const WA_SESSION_STATE_KEY = 'openwa_session';

interface OpenWAEvent {
  event?: string;
  sessionId?: string;
  idempotencyKey?: string;
  data?: {
    from?: string;
    body?: string;
    text?: string;
    senderPhone?: string;
    fromMe?: boolean;
    isGroup?: boolean;
    status?: string;
  };
}

export function signOpenWA(secret: string, raw: string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

/** `628…@c.us` / `628…@s.whatsapp.net` → `628…`; LID/grup → null. */
function senderOf(d: NonNullable<OpenWAEvent['data']>): string | null {
  if (d.senderPhone) return d.senderPhone;
  const from = d.from ?? '';
  if (!/@(c\.us|s\.whatsapp\.net)$/.test(from)) return null;
  return from.split('@')[0] ?? null;
}

/** Kunci idempotensi yang baru diproses (OpenWA mengulang kirim bila respons lambat). */
const seen = new Set<string>();
function firstTime(key: string | undefined): boolean {
  if (!key) return true;
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 1000) seen.delete(seen.values().next().value!);
  return true;
}

export const webhookRoutes = new Hono<AppEnv>().post('/openwa', async (c) => {
  const { db, env, wa, logger } = c.var.deps;
  const secret = env.OPENWA_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(404, 'NOT_FOUND', 'Endpoint tidak ditemukan');
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) {
    throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar');
  }
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar');
  const sig = c.req.header('x-openwa-signature') ?? '';
  if (!safeEqual(sig, signOpenWA(secret, raw))) {
    logger.warn({ ip: c.var.ip }, 'webhook OpenWA: tanda tangan tidak valid');
    throw new HttpError(401, 'BAD_SIGNATURE', 'Tanda tangan tidak valid');
  }

  let payload: OpenWAEvent;
  try {
    payload = JSON.parse(raw) as OpenWAEvent;
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Body bukan JSON');
  }
  const event = payload.event ?? c.req.header('x-openwa-event');
  if (!firstTime(payload.idempotencyKey ?? c.req.header('x-openwa-idempotency-key'))) {
    return c.json({ ok: true, duplicate: true });
  }
  const d = payload.data ?? {};

  if (event === 'session.status') {
    const value = {
      status: d.status ?? 'unknown',
      sessionId: payload.sessionId ?? null,
      at: new Date().toISOString(),
    };
    await db
      .insert(systemState)
      .values({ key: WA_SESSION_STATE_KEY, value })
      .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
    logger.info({ status: value.status }, 'status sesi OpenWA');
    return c.json({ ok: true });
  }

  if (event === 'message.received' && !d.fromMe && !d.isGroup) {
    const r = await verifyWhatsAppFromMessage(db, env, senderOf(d), d.body ?? d.text);
    if (r.ok) {
      await audit(db, {
        actorId: r.userId,
        action: 'contact.whatsapp_verified',
        entityType: 'user',
        entityId: r.userId,
        diff: { method: 'wa_inbound', phone: r.phone },
        ip: c.var.ip,
      });
      publishToUsers([r.userId], { type: 'verification' });
      // User yang memulai chat, jadi balasan konfirmasi aman dari sisi anti-spam.
      await wa
        .sendText(
          r.phone,
          'Nomor WhatsApp Anda sudah terverifikasi di REIN. Terima kasih.',
          `verify-${r.codeId}`,
        )
        .catch((err: unknown) => logger.warn({ err: String(err) }, 'balasan verifikasi WA gagal'));
    } else if (r.reason !== 'no_code') {
      logger.info({ reason: r.reason }, 'pesan verifikasi WA tidak cocok');
    }
    return c.json({ ok: true, verified: r.ok });
  }

  return c.json({ ok: true, ignored: true });
});
