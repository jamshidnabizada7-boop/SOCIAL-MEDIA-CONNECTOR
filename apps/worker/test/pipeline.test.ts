process.env.ARIA_ADAPTER_MODE = "mock";
process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, encryptSecret, runMigrations, type DatabaseHandle } from "@aria/db";
import {
  brands,
  oauthCredentials,
  mediaAssets,
  postMedia,
  postVariants,
  posts,
  publishAttempts,
  publishJobs,
  publishTargets,
  remotePosts,
  socialAccounts,
  subscriptions,
  users,
  workspaces,
} from "@aria/db";
import { eq } from "drizzle-orm";
import { processPublishJob, processReconcileJob } from "../src/pipeline/publish.js";
import { claimJobs, type ClaimedJob } from "../src/pipeline/jobs.js";

/**
 * End-to-end pipeline test against an isolated embedded Postgres (PGlite).
 * Proves the core invariants:
 *   1. A due job publishes through the adapter and records everything.
 *   2. Re-running the same job NEVER re-publishes (idempotency guard).
 *   3. Claims are exclusive; dead workers' jobs are recovered — and a job that
 *      died mid-publish asks a human rather than risk a duplicate.
 *   4. Validation failures produce translated, non-retryable target errors.
 *   5. Async uploads record the provider id at accept time and reconcile.
 */

const stamp = Date.now().toString(36);
const dataDir = path.resolve(process.cwd(), `.test-data/pipeline-${Date.now()}`);
process.env.ARIA_STORAGE_DIR = path.join(dataDir, "storage");

describe("publish pipeline", () => {
  let handle: DatabaseHandle;
  let wsId: string;
  let brandId: string;
  let authorId: string;

  beforeAll(async () => {
    handle = await createDatabase({ dataDir });
    await runMigrations(handle);
    const db = handle.db;
    const [user] = await db
      .insert(users)
      .values({ email: `pipe-${stamp}@test.aria`, name: "Pipeline Tester", passwordHash: "x" })
      .returning();
    authorId = user.id;
    const [ws] = await db
      .insert(workspaces)
      .values({ name: `Pipeline WS ${stamp}`, slug: `pipe-${stamp}`, planId: "pro" })
      .returning();
    wsId = ws.id;
    const [brand] = await db.insert(brands).values({ workspaceId: wsId, name: "Brand" }).returning();
    brandId = brand.id;
    await db.insert(subscriptions).values({ workspaceId: wsId, planId: "pro" });
  }, 60_000);

  afterAll(async () => {
    await handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  let fixtureCounter = 0;

  async function makePost(providerId: "x" | "youtube" | "tiktok", media = false) {
    const db = handle.db;
    fixtureCounter += 1;
    // Every fixture gets its own healthy account so provider lookups match.
    const [account] = await db
      .insert(socialAccounts)
      .values({
        workspaceId: wsId,
        brandId,
        providerId,
        externalAccountId: `ext_${stamp}_${fixtureCounter}`,
        displayName: `${providerId} fixture ${fixtureCounter}`,
        handle: `@fix${stamp}_${fixtureCounter}`,
        connection: "healthy",
        scopes: [],
      })
      .returning();
    await db.insert(oauthCredentials).values({
      accountId: account.id,
      accessTokenEnc: encryptSecret(`fixture-token-${fixtureCounter}`),
      scopes: [],
    });
    const [post] = await db
      .insert(posts)
      .values({
        workspaceId: wsId,
        brandId,
        authorId,
        title: `Pipeline test ${stamp}`,
        caption: media ? "Video test" : "Hello pipeline #test",
        state: "scheduled",
        scheduledAt: new Date(Date.now() - 1000),
        timezone: "UTC",
      })
      .returning();
    if (media) {
      const { defaultStorage } = await import("@aria/media-core");
      const bytes = Buffer.from(`fake-mp4-bytes-${fixtureCounter}`);
      const { storageKey } = await defaultStorage().save(wsId, bytes, `clip-${stamp}.mp4`);
      const [asset] = await db
        .insert(mediaAssets)
        .values({
          workspaceId: wsId,
          kind: "video",
          filename: `clip-${stamp}.mp4`,
          mime: "video/mp4",
          detectedMime: "video/mp4",
          bytes: bytes.byteLength,
          width: 1920,
          height: 1080,
          aspectRatio: "16:9",
          durationSec: 30,
          codec: "h264",
          checksum: `sha_${stamp}_${fixtureCounter}`,
          storageKey,
          status: "ready",
        })
        .returning();
      await db.insert(postMedia).values({ postId: post.id, mediaId: asset.id, position: 0 });
    }
    const [target] = await db
      .insert(publishTargets)
      .values({
        postId: post.id,
        accountId: account.id,
        providerId,
        state: "pending",
        idempotencyKey: `idem_${stamp}_${fixtureCounter}`,
        scheduledAt: post.scheduledAt,
      })
      .returning();
    // Not yet due: tests make it due explicitly via claim().
    const [job] = await db
      .insert(publishJobs)
      .values({ targetId: target.id, state: "pending", runAt: new Date(Date.now() + 3_600_000) })
      .returning();
    return { post, target, job, account };
  }

  const WORKER = "test-worker";
  const noLog = () => {};

  /** Makes the job due and claims it, like the runner would. */
  async function claim(jobId: string): Promise<ClaimedJob> {
    await handle.db.update(publishJobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(publishJobs.id, jobId));
    const claimed = await claimJobs(handle.db, WORKER, 50);
    const mine = claimed.find((j) => j.id === jobId);
    if (!mine) throw new Error(`job ${jobId} was not claimable`);
    return mine;
  }

  const run = async (jobId: string) => processPublishJob(handle, await claim(jobId), noLog);
  const jobRow = async (jobId: string) => (await handle.db.select().from(publishJobs).where(eq(publishJobs.id, jobId)))[0];
  const targetRow = async (targetId: string) =>
    (await handle.db.select().from(publishTargets).where(eq(publishTargets.id, targetId)))[0];

  it("publishes a due job and records attempt + remote post", async () => {
    const { post, target, job } = await makePost("x");
    await run(job.id);

    const t = await targetRow(target.id);
    expect(t.state).toBe("published");
    expect(t.publishedAt).toBeTruthy();

    const remote = (await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
    expect(remote).toBeTruthy();
    expect(remote.providerPostId).toContain("x_");

    const attempts = await handle.db.select().from(publishAttempts).where(eq(publishAttempts.jobId, job.id));
    expect(attempts.map((a) => a.outcome)).toContain("published");
    const j = await jobRow(job.id);
    expect(j.state).toBe("completed");
    expect(j.lockedBy).toBeNull();

    const p = (await handle.db.select().from(posts).where(eq(posts.id, post.id)).limit(1))[0];
    expect(p.state).toBe("published");
  });

  it("never re-publishes a completed target (idempotency guard)", async () => {
    const { target, job } = await makePost("x");
    await run(job.id);
    const first = (await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
    // Redelivery: the same row becomes due again (crash + sweep scenario).
    await handle.db.update(publishJobs).set({ state: "pending" }).where(eq(publishJobs.id, job.id));
    await run(job.id);
    const rows = await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id));
    expect(rows.length).toBe(1);
    expect(rows[0].providerPostId).toBe(first.providerPostId);
    const attempts = await handle.db.select().from(publishAttempts).where(eq(publishAttempts.jobId, job.id));
    expect(attempts.map((a) => a.outcome)).toContain("skipped_duplicate");
  });

  it("never hands the same job to two concurrent claimers", async () => {
    const { job } = await makePost("x");
    await handle.db.update(publishJobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(publishJobs.id, job.id));
    const [a, b] = await Promise.all([claimJobs(handle.db, "worker-a", 50), claimJobs(handle.db, "worker-b", 50)]);
    expect([...a, ...b].filter((j) => j.id === job.id).length).toBe(1);
    await handle.db
      .update(publishJobs)
      .set({ state: "pending", lockedBy: null, leaseExpiresAt: null, runAt: new Date(Date.now() + 3_600_000) })
      .where(eq(publishJobs.id, job.id));
  });

  it("re-claims a job whose worker died (expired lease), but not a live one", async () => {
    const { target, job } = await makePost("x");
    await handle.db
      .update(publishJobs)
      .set({ state: "active", lockedBy: "dead-worker", leaseExpiresAt: new Date(Date.now() + 60_000) })
      .where(eq(publishJobs.id, job.id));
    expect((await claimJobs(handle.db, WORKER, 50)).some((j) => j.id === job.id)).toBe(false);
    await handle.db.update(publishJobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(publishJobs.id, job.id));
    const reclaimed = (await claimJobs(handle.db, WORKER, 50)).find((j) => j.id === job.id);
    expect(reclaimed?.recovered).toBe(true);
    await processPublishJob(handle, reclaimed!, noLog);
    expect((await jobRow(job.id)).state).toBe("completed");
    expect((await targetRow(target.id)).state).toBe("published");
  });

  it("asks a human instead of re-sending when a worker died mid-publish", async () => {
    const { target, job } = await makePost("x");
    await handle.db.update(publishTargets).set({ state: "publishing" }).where(eq(publishTargets.id, target.id));
    await handle.db
      .update(publishJobs)
      .set({ state: "active", lockedBy: "dead-worker", leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(publishJobs.id, job.id));
    const reclaimed = (await claimJobs(handle.db, WORKER, 50)).find((j) => j.id === job.id)!;
    await processPublishJob(handle, reclaimed, noLog);
    const t = await targetRow(target.id);
    expect(t.state).toBe("needs_user_action");
    expect(t.lastError?.code).toBe("outcome_unknown");
    expect((await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id))).length).toBe(0);
  });

  it("rejects video posts to YouTube without a title — translated, non-retryable", async () => {
    const { target, job } = await makePost("youtube", true);
    await run(job.id);
    const t = await targetRow(target.id);
    expect(t.state).toBe("failed");
    expect(t.lastError?.code).toBe("title_required");
    expect(t.lastError?.retryable).toBe(false);
    expect((await jobRow(job.id)).state).toBe("failed");
  });

  it("stops safely when the account needs reauthorization (token_expired)", async () => {
    const { post, target, job, account } = await makePost("x");
    await handle.db.update(socialAccounts).set({ connection: "needs_reauth" }).where(eq(socialAccounts.id, account.id));
    await run(job.id);
    expect((await targetRow(target.id)).state).toBe("token_expired");
    const p = (await handle.db.select().from(posts).where(eq(posts.id, post.id)).limit(1))[0];
    expect(p.state).toBe("failed");
    expect((await jobRow(job.id)).state).toBe("failed");
  });

  it("records the provider id at accept time and reconciles an async upload to published", async () => {
    const db = handle.db;
    const { post, target, job } = await makePost("youtube", true);
    await db.insert(postVariants).values({ postId: post.id, providerId: "youtube", title: "Launch video", settings: {} });

    await run(job.id);
    let t = await targetRow(target.id);
    expect(t.state).toBe("provider_processing");
    const remote = (await db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)))[0];
    expect(remote?.providerPostId).toBeTruthy();
    let j = await jobRow(job.id);
    expect(j.queue).toBe("reconcile");
    expect(j.state).toBe("delayed");
    expect(j.runAt.getTime()).toBeGreaterThan(Date.now());

    // The mock finishes processing on its second status check.
    await processReconcileJob(handle, await claim(job.id), noLog);
    expect((await targetRow(target.id)).state).toBe("provider_processing");
    await processReconcileJob(handle, await claim(job.id), noLog);
    t = await targetRow(target.id);
    expect(t.state).toBe("published");
    j = await jobRow(job.id);
    expect(j.state).toBe("completed");
    // Exactly one remote post — the async path never re-created the upload.
    expect((await db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id))).length).toBe(1);
  });

  it("a redelivered publish job for an upload still processing goes back to reconcile", async () => {
    const db = handle.db;
    const { post, target, job } = await makePost("youtube", true);
    await db.insert(postVariants).values({ postId: post.id, providerId: "youtube", title: "Second video", settings: {} });
    await run(job.id);
    expect((await targetRow(target.id)).state).toBe("provider_processing");
    // Force the row back onto the publish queue, as a stray redelivery would.
    await db.update(publishJobs).set({ queue: "publish", state: "pending" }).where(eq(publishJobs.id, job.id));
    await run(job.id);
    expect((await jobRow(job.id)).queue).toBe("reconcile");
    expect((await db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id))).length).toBe(1);
  });
});
