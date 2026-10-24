import { auditLogs } from "@aria/db";
import type { DbOrTx } from "@aria/db";

export interface AuditInput {
  workspaceId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system";
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only audit trail. Never log secrets — callers must not include
 * tokens, passwords or raw provider payloads.
 */
export async function writeAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    workspaceId: input.workspaceId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorType ?? "user",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    metadata: input.metadata,
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 300),
  });
}
