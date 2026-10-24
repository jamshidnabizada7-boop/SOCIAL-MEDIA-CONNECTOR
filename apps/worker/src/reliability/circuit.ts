import { eq } from "drizzle-orm";
import type { AriaDatabase } from "@aria/db";
import { providerHealthState } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS } from "@aria/shared-types";

/**
 * Circuit breaker (plan §32). If a provider fails repeatedly, stop hammering
 * it: jobs for that provider are delayed until a controlled probe window
 * opens, rather than burning attempts and rate-limit budget.
 *
 * State is persisted in provider_health_state so every worker agrees and the
 * admin panel can inspect it. Account-specific failures (revoked tokens) do
 * NOT trip the circuit — they're handled per-target as token_expired.
 */

const FAILURE_THRESHOLD = 5;
const BASE_OPEN_MS = 2 * 60_000;
const MAX_OPEN_MS = 15 * 60_000;

export interface CircuitSnapshot {
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
  lastErrorCode: string | null;
}

export async function loadCircuit(db: AriaDatabase, provider: ProviderId): Promise<CircuitSnapshot> {
  const rows = await db
    .select()
    .from(providerHealthState)
    .where(eq(providerHealthState.providerId, provider))
    .limit(1);
  const row = rows[0];
  return {
    consecutiveFailures: row?.consecutiveFailures ?? 0,
    circuitOpenUntil: row?.circuitOpenUntil ?? null,
    lastErrorCode: row?.lastErrorCode ?? null,
  };
}

/** True when the circuit is open right now. */
export async function isCircuitOpen(db: AriaDatabase, provider: ProviderId): Promise<Date | null> {
  const snap = await loadCircuit(db, provider);
  if (snap.circuitOpenUntil && snap.circuitOpenUntil.getTime() > Date.now()) {
    return snap.circuitOpenUntil;
  }
  return null;
}

/**
 * Records an attempt outcome. providerError means the network/provider itself
 * failed (5xx, 429, timeouts) — not content validation or revoked tokens.
 */
export async function recordOutcome(
  db: AriaDatabase,
  provider: ProviderId,
  outcome: { ok: boolean; errorCode?: string; providerError?: boolean }
): Promise<void> {
  const snap = await loadCircuit(db, provider);
  let failures = snap.consecutiveFailures;
  let openUntil: Date | null = snap.circuitOpenUntil;

  if (outcome.ok) {
    failures = 0;
    openUntil = null;
  } else if (outcome.providerError) {
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) {
      // Each re-trip widens the window up to the cap; a success later resets.
      const openMs = Math.min(MAX_OPEN_MS, BASE_OPEN_MS * 2 ** (failures - FAILURE_THRESHOLD));
      openUntil = new Date(Date.now() + openMs);
    }
  } else {
    // Non-provider failures (validation, revoked tokens) don't trip the circuit.
    return;
  }

  await db
    .insert(providerHealthState)
    .values({
      providerId: provider,
      consecutiveFailures: failures,
      circuitOpenUntil: openUntil,
      lastErrorCode: outcome.errorCode ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: providerHealthState.providerId,
      set: {
        consecutiveFailures: failures,
        circuitOpenUntil: openUntil,
        lastErrorCode: outcome.errorCode ?? null,
        updatedAt: new Date(),
      },
    });
}

export function providerDisplayName(provider: ProviderId): string {
  return PROVIDERS[provider]?.name ?? provider;
}
