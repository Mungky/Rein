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

/** Tulis event audit (append-only, PRD §9.4). Jangan pernah menyimpan password/token di diff. */
export async function audit(db: Db | Tx, e: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: e.actorId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    diffJson: e.diff ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
  });
}
