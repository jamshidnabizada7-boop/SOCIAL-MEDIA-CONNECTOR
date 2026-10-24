import { workerConfig } from "./config.js";
import { openDatabase, processPublishJob, processReconcileJob, type PublishJobPayload } from "./pipeline/publish.js";
import { MemoryQueueDriver } from "./queue/memory.js";
import { BullMqQueueDriver } from "./queue/bullmq.js";
import type { QueueDriver } from "./queue/types.js";
import { publishJobs, publishTargets } from "@aria/db";
import { and, eq, lte, or } from "drizzle-orm";

const log = (msg: string, meta?: Record<string, unknown>) =>
  console.log(`[worker] ${msg}`, meta ? JSON.stringify(meta) : "");

async function main() {
  const handle = await openDatabase();
  log(`database ready (${handle.driver})`);

  let driver: QueueDriver;
  if (workerConfig.REDIS_URL) {
    driver = await BullMqQueueDriver.create(workerConfig.REDIS_URL, workerConfig.WORKER_CONCURRENCY);
    log("queue driver: bullmq (redis)");
  } else {
    driver = new MemoryQueueDriver();
    log("queue driver: memory (local dev — jobs are not durable across restarts)");
  }

  const enqueue = (queue: string, payload: Record<string, unknown>, delayMs?: number) =>
    driver.enqueue(queue, payload, { delayMs });

  await driver.process("publish", async (raw) => {
    await processPublishJob(handle, raw as unknown as PublishJobPayload, enqueue, log);
  });
  await driver.process("reconcile", async (raw) => {
    await processReconcileJob(handle, raw as unknown as PublishJobPayload, enqueue, log);
  });

  /**
   * Durable sweep: every few seconds, claim due work straight from the
   * database. This is what makes the system restart-safe — publish_jobs rows
   * are the source of truth; the queue driver is an execution detail.
   * Pending jobs (e.g. enqueued by the API) and delayed retries that are due
   * both get re-dispatched here.
   */
  const sweep = async () => {
    try {
      const now = new Date();
      const due = await handle.db
        .select()
        .from(publishJobs)
        .where(
          or(
            and(eq(publishJobs.state, "pending"), lte(publishJobs.runAt, now)),
            and(eq(publishJobs.state, "delayed"), lte(publishJobs.runAt, now))
          )
        )
        .limit(5);
      for (const job of due) {
        // Claim first so a second sweep pass cannot double-dispatch.
        const claimed = await handle.db
          .update(publishJobs)
          .set({ state: "delayed", runAt: new Date(Date.now() + 60_000), updatedAt: new Date() })
          .where(and(eq(publishJobs.id, job.id), eq(publishJobs.state, job.state)))
          .returning({ id: publishJobs.id });
        if (claimed.length === 0) continue;
        log(`sweep: dispatching job ${job.id} (attempt ${Math.max(1, job.attempts)})`);
        await driver.enqueue(
          "publish",
          { jobId: job.id, targetId: job.targetId, attempt: Math.max(1, job.attempts) },
          { delayMs: 0 }
        );
      }
    } catch (err) {
      log(`sweep error: ${(err as Error).message}`);
    }
  };
  setInterval(sweep, 2500);

  log("worker ready — queues: publish, reconcile");

  // Connection monitor (plan §25/§7): flag tokens expiring within 7 days so
  // users reconnect before schedules break. Runs alongside the sweep.
  setInterval(async () => {
    try {
      const { flagExpiringTokens } = await import("@aria/providers-core");
      const flagged = await flagExpiringTokens(handle.db);
      if (flagged > 0) log(`connection monitor: flagged ${flagged} expiring token(s)`);
    } catch (err) {
      log(`connection monitor error: ${(err as Error).message}`);
    }
  }, 5 * 60_000);

  const shutdown = async () => {
    log("shutting down");
    await driver.close();
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
