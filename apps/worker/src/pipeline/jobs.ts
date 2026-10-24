import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { publishJobs } from "@aria/db";
import type { AriaDatabase } from "@aria/db";

/**
 * Postgres-backed job queue. publish_jobs rows are the queue: the API inserts
 * them, the worker claims them atomically, and every outcome is written back
 * to the row (state + run_at). Nothing lives only in memory, so restarts,
 * crashes and multiple worker processes are all safe.
 *
 *  pending/delayed + run_at ≤ now  → due, claimable
 *  active + lease expired          → its worker died; claimable again ("recovered")
 */

export type JobRow = typeof publishJobs.$inferSelect;
export interface ClaimedJob extends JobRow {
  /** True when the job was re-claimed from a worker whose lease lapsed. */
  recovered: boolean;
}

export type JobQueue = "publish" | "reconcile";

export const LEASE_MS = 10 * 60_000;

/** Claims up to `limit` due jobs for `workerId`. Safe under concurrency: each claim is a conditional update. */
export async function claimJobs(db: AriaDatabase, workerId: string, limit: number): Promise<ClaimedJob[]> {
  if (limit <= 0) return [];
  const now = new Date();
  const dueOrStale = or(
    and(inArray(publishJobs.state, ["pending", "delayed"]), lte(publishJobs.runAt, now)),
    and(eq(publishJobs.state, "active"), lt(publishJobs.leaseExpiresAt, now))
  );
  const candidates = await db
    .select({ id: publishJobs.id, state: publishJobs.state })
    .from(publishJobs)
    .where(dueOrStale)
    .orderBy(asc(publishJobs.runAt))
    .limit(limit * 3);

  const claimed: ClaimedJob[] = [];
  for (const c of candidates) {
    if (claimed.length >= limit) break;
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    // The WHERE re-checks claimability, so a row another worker claimed in
    // between matches nothing here.
    const [row] = await db
      .update(publishJobs)
      .set({ state: "active", lockedBy: workerId, lockedAt: new Date(), leaseExpiresAt, updatedAt: new Date() })
      .where(and(eq(publishJobs.id, c.id), dueOrStale))
      .returning();
    if (row) claimed.push({ ...row, recovered: c.state === "active" });
  }
  return claimed;
}

/** Extends the lease while a long upload runs. Returns false if the job is no longer ours. */
export async function heartbeat(db: AriaDatabase, jobId: string, workerId: string): Promise<boolean> {
  const rows = await db
    .update(publishJobs)
    .set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(and(eq(publishJobs.id, jobId), eq(publishJobs.lockedBy, workerId), eq(publishJobs.state, "active")))
    .returning({ id: publishJobs.id });
  return rows.length > 0;
}

type Patch = Partial<typeof publishJobs.$inferInsert>;

async function settle(db: AriaDatabase, jobId: string, patch: Patch): Promise<void> {
  await db
    .update(publishJobs)
    .set({ ...patch, lockedBy: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));
}

export const jobOutcome = {
  completed: (db: AriaDatabase, jobId: string) => settle(db, jobId, { state: "completed", lastError: null }),
  /** Run again at `runAt`. `countAttempt: false` for waits that aren't failures (open circuit). */
  retryAt: (db: AriaDatabase, job: JobRow, runAt: Date, lastError: string | null, countAttempt = true) =>
    settle(db, job.id, {
      state: "delayed",
      runAt,
      lastError: lastError?.slice(0, 300) ?? null,
      attempts: countAttempt ? job.attempts + 1 : job.attempts,
    }),
  failed: (db: AriaDatabase, jobId: string, lastError: string) =>
    settle(db, jobId, { state: "failed", lastError: lastError.slice(0, 300) }),
  deadLetter: (db: AriaDatabase, job: JobRow, lastError: string) =>
    settle(db, job.id, { state: "dead_letter", lastError: lastError.slice(0, 300), attempts: job.attempts + 1 }),
  /** Hands the same row to the reconcile queue (async provider processing). */
  toReconcile: (db: AriaDatabase, jobId: string, runAt: Date, maxPolls: number) =>
    settle(db, jobId, { queue: "reconcile", state: "delayed", runAt, attempts: 0, maxAttempts: maxPolls, lastError: null }),
};

/** Exponential backoff with jitter, capped. attempt is 1-based. */
export function backoffMs(attempt: number, baseMs: number, capMs: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.85 + Math.random() * 0.3));
}
