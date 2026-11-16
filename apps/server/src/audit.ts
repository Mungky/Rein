import type { Db } from './db/client';
import { auditLogs } from './db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditEvent {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Kunci yang nilainya tidak boleh masuk audit log (pelajaran REIN v1). */
const SECRET_KEY =
  /^(password|passwordHash|pin|pinHash|pinConfirm|token|tokenHash|codeHash|secret|apiKey|refreshToken|clientSecret|authorization|cookie)$/i;

/** Ganti nilai berkunci rahasia dengan "[redacted]" secara rekursif. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
    ]),
  );
}

/** Tulis event audit (append-only, PRD §9.4). Nilai rahasia di diff selalu diredaksi. */
export async function audit(db: Db | Tx, e: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: e.actorId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    diffJson: e.diff ? (redact(e.diff) as Record<string, unknown>) : null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
  });
}
