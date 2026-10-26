import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// Always isolated: ignore any real database, credentials, mail or provider config.
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
process.env.ARIA_ADAPTER_MODE = "mock";
process.env.ARIA_ENCRYPTION_KEY = "a1".repeat(32);
process.env.SMTP_URL = "";
process.env.SENTRY_DSN = "";
mkdirSync(".local", { recursive: true });
const dataDir = mkdtempSync(path.resolve(".local/load-"));
const { createDatabase, runMigrations, encryptSecret, oauthCredentials, workspaces, socialAccounts, posts, publishTargets, publishJobs, remotePosts } = await import("@aria/db");
const { claimJobs } = await import("../apps/worker/src/pipeline/jobs.js");
const { processPublishJob } = await import("../apps/worker/src/pipeline/publish.js");
const { getAdapter } = await import("../apps/worker/src/adapters/registry.js");
const { eq, count } = await import("drizzle-orm");
const handle = await createDatabase({ dataDir });
const total = 1_000;
try {
  await runMigrations(handle);
  const db = handle.db;
  const [workspace] = await db.insert(workspaces).values({ name: "Isolated load test", slug: `load-${randomUUID()}`, planId: "agency" }).returning();
  const [account] = await db.insert(socialAccounts).values({ workspaceId: workspace.id, providerId: "mastodon", externalAccountId: "load-test", displayName: "Load", handle: "@load", connection: "healthy" }).returning();
  await db.insert(oauthCredentials).values({ accountId: account.id, accessTokenEnc: encryptSecret("load-fixture") });
  const due = new Date(Date.now() - 1_000);
  const ids = Array.from({ length: total }, () => ({ postId: randomUUID(), targetId: randomUUID() }));
  await db.insert(posts).values(ids.map(({ postId }) => ({ id: postId, workspaceId: workspace.id, caption: "Load verification", state: "scheduled" as const, scheduledAt: due })));
  await db.insert(publishTargets).values(ids.map(({ postId, targetId }) => ({ id: targetId, postId, accountId: account.id, providerId: "mastodon", idempotencyKey: targetId, scheduledAt: due })));
  await db.insert(publishJobs).values(ids.map(({ targetId }) => ({ targetId, runAt: due })));
  let calls = 0;
  const adapter = getAdapter("mastodon");
  const original = adapter.createPost;
  adapter.createPost = async (...args) => { calls++; return original(...args); };
  const claimedIds = new Set<string>();
  const started = performance.now();
  async function drain(workerId: string) {
    while (true) {
      const jobs = await claimJobs(db, workerId, 4);
      if (!jobs.length) return;
      for (const job of jobs) {
        assert(!claimedIds.has(job.id), `duplicate claim: ${job.id}`);
        claimedIds.add(job.id);
      }
      await Promise.all(jobs.map((job) => processPublishJob(handle, job, () => {})));
    }
  }
  await Promise.all([drain("load-worker-a"), drain("load-worker-b")]);
  const durationMs = Math.round(performance.now() - started);
  assert.equal(claimedIds.size, total);
  assert.equal((await db.select({ n: count() }).from(publishJobs).where(eq(publishJobs.state, "completed")))[0].n, total);
  assert.equal((await db.select({ n: count() }).from(remotePosts))[0].n, total);
  assert.equal(calls, total);
  // Simulate redelivery after successful completion: no additional provider calls.
  for (const job of await db.select().from(publishJobs).limit(10)) {
    await processPublishJob(handle, { ...job, recovered: false }, () => {});
  }
  assert.equal(calls, total);
  const result = { total, workers: 2, concurrencyPerWorker: 4, durationMs, postsPerSecond: +(total / (durationMs / 1000)).toFixed(2), duplicates: 0, replayed: 10, adapter: "mock", database: "isolated PGlite", verifiedAt: new Date().toISOString() };
  writeFileSync(".local/load-test.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
}
