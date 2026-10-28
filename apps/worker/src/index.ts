import { createServer } from "node:http";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import pino from "pino";
import { assertEncryptionKey } from "@aria/db";
import { flagExpiringTokens, refreshExpiringTokens } from "@aria/providers-core";
import { workerConfig } from "./config.js";
import { openDatabase, processPublishJob, processReconcileJob } from "./pipeline/publish.js";
import { claimJobs, heartbeat, jobOutcome, LEASE_MS, type ClaimedJob } from "./pipeline/jobs.js";
import { runMaintenance } from "./maintenance.js";
import { inboxTick, retainInbox } from "./inbox.js";
import { ingestMetrics } from "./metrics.js";
import { captureError, flushTelemetry } from "./telemetry.js";
import { createOperationsMonitor, reportOperationsAlert } from "./alerts.js";

const logger = pino({ level: workerConfig.LOG_LEVEL, base: { service: "aria-worker" } });

const WORKER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
const IDLE_POLL_MS = 2_000;
const BUSY_POLL_MS = 250;

async function main() {
  if (process.env.NODE_ENV === "production") assertEncryptionKey();
  const handle = await openDatabase();
  logger.info({ driver: handle.driver, workerId: WORKER_ID, concurrency: workerConfig.WORKER_CONCURRENCY }, "worker starting");

  const inFlight = new Map<string, Promise<void>>();
  let stopping = false;
  let lastLoopAt = Date.now();

  const run = async (job: ClaimedJob) => {
    const beat = setInterval(() => {
      void heartbeat(handle.db, job.id, WORKER_ID).catch((err) => logger.warn({ err, jobId: job.id }, "heartbeat failed"));
    }, LEASE_MS / 3);
    const jobLog = (msg: string, meta?: Record<string, unknown>) =>
      logger.info({ jobId: job.id, targetId: job.targetId, queue: job.queue, ...meta }, msg);
    try {
      if (job.queue === "reconcile") await processReconcileJob(handle, job, jobLog);
      else await processPublishJob(handle, job, jobLog);
    } catch (err) {
      // Engine bug or database hiccup: never leave the row active — retry later.
      captureError(err, { jobId: job.id, queue: job.queue });
      logger.error({ err, jobId: job.id }, "job crashed; rescheduling");
      await jobOutcome
        .retryAt(handle.db, job, new Date(Date.now() + 60_000), `worker_error: ${(err as Error).message}`)
        .catch((e) => logger.error({ err: e, jobId: job.id }, "could not reschedule crashed job"));
    } finally {
      clearInterval(beat);
    }
  };

  /**
   * Claim loop. publish_jobs rows are the source of truth; this process only
   * holds leases on what it is running. Up to WORKER_CONCURRENCY jobs run at once.
   */
  const loop = async () => {
    while (!stopping) {
      lastLoopAt = Date.now();
      let claimed: ClaimedJob[] = [];
      try {
        claimed = await claimJobs(handle.db, WORKER_ID, workerConfig.WORKER_CONCURRENCY - inFlight.size);
      } catch (err) {
        logger.error({ err }, "claim failed");
        captureError(err, { task: "claim" });
      }
      for (const job of claimed) {
        if (job.recovered) logger.warn({ jobId: job.id }, "recovered job from an expired lease");
        const p = run(job).finally(() => inFlight.delete(job.id));
        inFlight.set(job.id, p);
      }
      await new Promise((r) => setTimeout(r, claimed.length > 0 ? BUSY_POLL_MS : IDLE_POLL_MS));
    }
  };
  void loop();

  let inboxFlight: Promise<void> | undefined;
  const runInbox = () => {
    if (stopping || inboxFlight) return;
    inboxFlight = inboxTick(handle.db).catch(() => logger.warn("inbox cycle failed; durable work will be retried")).finally(() => { inboxFlight = undefined; });
  };
  const inboxTimer = setInterval(runInbox, 5000);
  runInbox();

  // Connection monitor (plan §25/§7): renew tokens a day ahead so a 3 a.m.
  // post never waits on a refresh; flag the ones that can't renew themselves.
  const monitor = async () => {
    try {
      const refreshed = await refreshExpiringTokens(handle.db);
      const flagged = await flagExpiringTokens(handle.db);
      if (refreshed || flagged) logger.info({ refreshed, flagged }, "connection monitor");
    } catch (err) {
      logger.error({ err }, "connection monitor failed");
      captureError(err, { task: "connection_monitor" });
    }
  };
  const monitorTimer = setInterval(monitor, 30 * 60_000);
  setTimeout(monitor, 30_000);

  const maintenance = async () => {
    try {
      const result = await runMaintenance(handle.db);
      await retainInbox(handle.db);
      logger.info(result, "maintenance");
    } catch (err) {
      logger.error({ err }, "maintenance failed");
      captureError(err, { task: "maintenance" });
    }
  };
  const maintenanceTimer = setInterval(maintenance, 24 * 3_600_000);
  setTimeout(maintenance, 5 * 60_000);

  const metrics = async () => {
    try {
      const captured = await ingestMetrics(handle.db, (msg, meta) => logger.warn(meta ?? {}, msg));
      if (captured) logger.info({ captured }, "metrics ingested");
    } catch (err) {
      logger.error({ err }, "metrics ingestion failed");
      captureError(err, { task: "metrics" });
    }
  };
  const metricsTimer = setInterval(metrics, 60 * 60_000);
  setTimeout(metrics, 2 * 60_000);

  const checkOperations = createOperationsMonitor((alert) => {
    logger.error(alert, "operations alert");
    reportOperationsAlert(alert);
  });
  const operationsTimer = setInterval(() => {
    void checkOperations(handle.db).catch((err) => {
      logger.error({ err }, "operations monitor failed");
      captureError(err, { task: "operations_monitor" });
    });
  }, 60_000);

  // Liveness for the container healthcheck: the claim loop must have ticked recently.
  const health = createServer((req, res) => {
    const healthy = Date.now() - lastLoopAt < 30_000 && !stopping;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: healthy ? "ok" : "unhealthy", inFlight: inFlight.size, workerId: WORKER_ID }));
  });
  health.listen(workerConfig.WORKER_HEALTH_PORT, "127.0.0.1");

  logger.info({ healthPort: workerConfig.WORKER_HEALTH_PORT }, "worker ready");

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, inFlight: inFlight.size }, "shutting down — finishing in-flight jobs");
    clearInterval(monitorTimer);
    clearInterval(inboxTimer);
    clearInterval(maintenanceTimer);
    clearInterval(metricsTimer);
    clearInterval(operationsTimer);
    health.close();
    // Unfinished jobs keep their lease and are recovered by the next worker.
    await Promise.race([Promise.allSettled([...inFlight.values(), ...(inboxFlight ? [inboxFlight] : [])]), new Promise((r) => setTimeout(r, 25_000))]);
    await handle.close();
    await flushTelemetry();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandled rejection");
  captureError(err);
});

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  captureError(err, { stage: "startup" });
  void flushTelemetry().finally(() => process.exit(1));
});
