import { and, gte, gt, inArray, sql } from "drizzle-orm";
import { providerHealthState, publishAttempts, type AriaDatabase } from "@aria/db";
import { captureAlert } from "./telemetry.js";

const WINDOW_MS = 15 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
export type OperationalAlert = { code: string; provider?: string; total?: number; failed?: number };

/** A monitor per worker; issue fingerprints group reports from multiple replicas. */
export function createOperationsMonitor(report: (alert: OperationalAlert) => void) {
  const lastSent = new Map<string, number>();
  return async (db: AriaDatabase, now = Date.now()) => {
    const active = new Set<string>();
    const emit = (alert: OperationalAlert) => {
      const key = `${alert.code}:${alert.provider ?? "all"}`;
      active.add(key);
      if (now - (lastSent.get(key) ?? -Infinity) < COOLDOWN_MS) return;
      report(alert);
      lastSent.set(key, now);
    };
    const open = await db.select({ provider: providerHealthState.providerId })
      .from(providerHealthState).where(gt(providerHealthState.circuitOpenUntil, new Date(now)));
    for (const row of open) emit({ code: "provider_circuit_open", provider: row.provider });

    const [counts] = await db.select({
      total: sql<number>`count(*)::integer`,
      failed: sql<number>`count(*) filter (where ${publishAttempts.success} = false)::integer`,
    }).from(publishAttempts).where(and(
      gte(publishAttempts.finishedAt, new Date(now - WINDOW_MS)),
      inArray(publishAttempts.outcome, ["published", "failed", "token_expired", "needs_user_action", "dead_letter"]),
    ));
    if (counts.total >= 10 && counts.failed / counts.total >= 0.2) {
      emit({ code: "publish_failure_rate_high", ...counts });
    }
    for (const key of lastSent.keys()) if (!active.has(key)) lastSent.delete(key);
  };
}

export function reportOperationsAlert(alert: OperationalAlert): void {
  captureAlert(alert.code, { ...(alert.provider ? { provider: alert.provider } : {}) }, {
    ...(alert.total !== undefined ? { total: alert.total, failed: alert.failed ?? 0 } : {}),
  });
}
