process.env.ARIA_ADAPTER_MODE = "mock";
process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, encryptSecret, type DatabaseHandle } from "@aria/db";
import {
  brands,
  oauthCredentials,
  mediaAssets,
  subscriptions,
  postMedia,
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
import { processPublishJob } from "../src/pipeline/publish.js";
import type { PublishJobPayload } from "../src/pipeline/publish.js";

/**
 * End-to-end pipeline test against the real local Postgres (PGlite).
 * Proves the three core invariants:
 *   1. A pending job publishes through the adapter and records everything.
 *   2. Re-running the same job NEVER re-publishes (idempotency guard).
 *   3. Validation failures produce translated, non-retryable target errors.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

async function waitFor(fn: () => Promise<boolean>, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
}

describe("publish pipeline", () => {
  let handle: DatabaseHandle;
  let wsId: string;
  let brandId: string;
  let authorId: string;
  let accountId: string;
  let ttAccountId: string;

  beforeAll(async () => {
    handle = await createDatabase();
    const db = handle.db;
    // Fixtures: user → workspace → brand → account.
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
    const [brand] = await db
      .insert(brands)
      .values({ workspaceId: wsId, name: "Brand" })
      .returning();
    brandId = brand.id;
    await db.insert(subscriptions).values({ workspaceId: wsId, planId: "pro" });
    const [xAccount] = await db
      .insert(socialAccounts)
      .values({
        workspaceId: wsId,
        brandId,
        providerId: "x",
        externalAccountId: `ext_${stamp}`,
        displayName: "X Test",
        handle: `@pipe${stamp}`,
        connection: "healthy",
        scopes: ["tweet.write"],
      })
      .returning();
    accountId = xAccount.id;
    await db
      .insert(oauthCredentials)
      .values({ accountId, accessTokenEnc: encryptSecret(`test-token-${stamp}`), scopes: [] });
  });


  afterAll(async () => {
    await handle.close();
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
      const bytes = Buffer.from("fake-mp4-bytes-for-storage-test");
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
          checksum: `sha_${stamp}_${media}`,
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
    const [job] = await db
      .insert(publishJobs)
      .values({ targetId: target.id, state: "pending", runAt: new Date(Date.now() - 1000) })
      .returning();
    return { post, target, job };
  }

  const noopEnqueue = async () => {};
  const run = (jobId: string, targetId: string, attempt = 1) =>
    processPublishJob(handle, { jobId, targetId, attempt } as PublishJobPayload, noopEnqueue, () => {});

  it("publishes a pending job and records attempt + remote post", async () => {
    const { post, target, job } = await makePost("x");
    await run(job.id, target.id);

    const t = (await handle.db.select().from(publishTargets).where(eq(publishTargets.id, target.id)).limit(1))[0];
    expect(t.state).toBe("published");
    expect(t.publishedAt).toBeTruthy();

    const remote = (await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
    expect(remote).toBeTruthy();
    expect(remote.providerPostId).toContain("x_");

    const attempts = await handle.db.select().from(publishAttempts).where(eq(publishAttempts.jobId, job.id));
    expect(attempts.map((a) => a.outcome)).toContain("published");

    const p = (await handle.db.select().from(posts).where(eq(posts.id, post.id)).limit(1))[0];
    expect(p.state).toBe("published");
  });

  it("never re-publishes a completed target (idempotency guard)", async () => {
    const { target, job } = await makePost("x");
    await run(job.id, target.id);
    const first = (await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
    // Deliver the same job again (worker crash + redelivery scenario).
    await run(job.id, target.id);
    const second = (await handle.db.select().from(remotePosts).where(eq(remotePosts.targetId, target.id)).limit(1))[0];
    expect(second.providerPostId).toBe(first.providerPostId);
    const attempts = await handle.db.select().from(publishAttempts).where(eq(publishAttempts.jobId, job.id));
    expect(attempts.map((a) => a.outcome)).toContain("skipped_duplicate");
  });

  it("rejects video posts to YouTube without a title — translated, non-retryable", async () => {
    const { post, target, job } = await makePost("youtube", true);
    await run(job.id, target.id);
    const t = (await handle.db.select().from(publishTargets).where(eq(publishTargets.id, target.id)).limit(1))[0];
    expect(t.state).toBe("failed");
    expect(t.lastError?.code).toBe("title_required");
    expect(t.lastError?.retryable).toBe(false);
    void post;
  });

  it("stops safely when the account needs reauthorization (token_expired)", async () => {
    const db = handle.db;
    const [post] = await db
      .insert(posts)
      .values({ workspaceId: wsId, brandId, authorId, title: "Reauth test", caption: "hi", state: "scheduled" })
      .returning();
    // Second account in needs_reauth.
    const [ttAccount] = await db
      .insert(socialAccounts)
      .values({
        workspaceId: wsId,
        brandId,
        providerId: "tiktok",
        externalAccountId: `ext_tt_${stamp}`,
        displayName: "TikTok Test",
        handle: `@pipett${stamp}`,
        connection: "needs_reauth",
        connectionNote: "revoked",
        scopes: [],
      })
      .returning();
    ttAccountId = ttAccount.id;
    await db
      .insert(oauthCredentials)
      .values({ accountId: ttAccountId, accessTokenEnc: encryptSecret(`tt-token-${stamp}`), scopes: [] });
    const [target] = await db
      .insert(publishTargets)
      .values({
        postId: post.id,
        accountId: ttAccountId,
        providerId: "tiktok",
        state: "pending",
        idempotencyKey: `idem_${stamp}_tt`,
      })
      .returning();
    const [job] = await db
      .insert(publishJobs)
      .values({ targetId: target.id, state: "pending" })
      .returning();
    await run(job.id, target.id);
    const t = (await db.select().from(publishTargets).where(eq(publishTargets.id, target.id)).limit(1))[0];
    expect(t.state).toBe("token_expired");
    const p = (await db.select().from(posts).where(eq(posts.id, post.id)).limit(1))[0];
    expect(p.state).toBe("failed");
  });

  it("runs an async-processing provider (tiktok) through reconcile to published", async () => {
    const db = handle.db;
    const { post, target, job } = await makePost("tiktok", true);
    void post;

    const payloads: Array<{ queue: string; payload: Record<string, unknown>; delay?: number }> = [];
    const enqueue = async (queue: string, payload: Record<string, unknown>, delayMs?: number) => {
      payloads.push({ queue, payload, delay: delayMs });
    };
    await processPublishJob(handle, { jobId: job.id, targetId: target.id, attempt: 1 }, enqueue, () => {});
    expect(payloads.some((p) => p.queue === "reconcile")).toBe(true);

    // Simulate the reconcile ticks (mock publishes on the 2nd status check).
    const { processReconcileJob } = await import("../src/pipeline/publish.js");
    await processReconcileJob(handle, { jobId: job.id, targetId: target.id, attempt: 1, kind: "reconcile" }, enqueue, () => {});
    await processReconcileJob(handle, { jobId: job.id, targetId: target.id, attempt: 1, kind: "reconcile" }, enqueue, () => {});
    const t = (await db.select().from(publishTargets).where(eq(publishTargets.id, target.id)).limit(1))[0];
    expect(t.state).toBe("published");
  });
});
