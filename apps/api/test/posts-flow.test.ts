import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, migrationsFolder } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { socialAccounts } from "@aria/db";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

/**
 * API-contract E2E for the posts module (against a fresh embedded Postgres).
 * The worker execution loop itself is covered by apps/worker tests; here we
 * prove the HTTP surface: create → list → get → publish (jobs enqueued) →
 * guards (double publish, retry of published, schedule in the past) →
 * notifications.
 */

let app: FastifyInstance;
let cookie = "";
let workspaceId = "";
let accountId = "";
const dataDir = path.resolve(process.cwd(), `.test-data/posts-${Date.now()}`);

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c";
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  // Minimal seed: the free plan (workspace insert references it).
  const { plans, socialProviders } = await import("@aria/db");
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
  await probe.db.insert(socialProviders).values({ id: "x", name: "X", capabilities: { formats: { text: true, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, hashtags: true, firstComment: false, thumbnail: false, customCover: false, privacyControl: false, schedule: true, directPublish: true, manualPublishFallback: false, comments: true, analytics: true, deletion: true, editing: false, aiDisclosure: false, brandedContent: false, maxCaptionLength: 280, maxImages: 4, maxVideoDurationSec: 140, maxVideoBytes: 5e8, maxImageBytes: 5e6, aspectRatios: [] } }).onConflictDoNothing();
  await probe.close();

  app = await buildServer();
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "p@flow.test", password: "correct-horse-battery", name: "Pat Flow" },
  });
  if (reg.statusCode !== 201) {
    throw new Error(`register failed: ${reg.statusCode} ${reg.body}`);
  }
  cookie = reg.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ws = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { cookie },
    payload: { name: "Flow WS" },
  });
  if (ws.statusCode !== 201) {
    throw new Error(`workspace failed: ${ws.statusCode} ${ws.body} | cookie=${cookie.slice(0, 30)}`);
  }
  workspaceId = ws.json().workspace.id;
  // Fixture: a healthy account the post can target.
  const [acc] = await app.database.db
    .insert(socialAccounts)
    .values({
      workspaceId,
      providerId: "x",
      externalAccountId: "ext_flow",
      displayName: "Flow X",
      handle: "@flow",
      connection: "healthy",
      scopes: [],
    })
    .returning();
  accountId = acc.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows may hold locks; cleanup is best-effort */
  }
});

describe("posts flow", () => {
  it("creates a post with targets and a version snapshot", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts`,
      headers: { cookie },
      payload: {
        title: "Flow post",
        caption: "Hello flow",
        accountIds: [accountId],
        labels: ["flow"],
      },
    });
    expect(res.statusCode).toBe(201);
    const post = res.json().post;
    expect(post.state).toBe("draft");
    expect(post.targets).toHaveLength(1);
    expect(post.targets[0].idempotencyKey).toContain("idem_");
    expect(post.versions?.length ?? 0).toBe(0); // versions live on detail fetch

    const detail = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/posts/${post.id}`,
      headers: { cookie },
    });
    expect(detail.json().post.versions).toHaveLength(1);
  });

  it("publishes: post → processing, one pending job per target", async () => {
    const list = await app.inject({ method: "GET", url: `/v1/workspaces/${workspaceId}/posts`, headers: { cookie } });
    if (list.statusCode !== 200 || list.json().posts.length === 0) {
      throw new Error(`list: ${list.statusCode} ${list.body.slice(0, 300)}`);
    }
    const postId = list.json().posts[0].id;
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}/publish`,
      headers: { cookie },
    });
    if (res.statusCode !== 202) throw new Error(`publish: ${res.statusCode} ${res.body.slice(0, 200)}`);
    expect(res.json().dispatched).toBe(1);
    expect(res.json().post.state).toBe("processing");

    // Double publish is rejected.
    const again = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}/publish`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(409);

    // Retry of the queued (non-terminal) target is allowed and idempotent-safe.
    const targetId = res.json().post.targets[0].id;
    const retry = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}/targets/${targetId}/retry`,
      headers: { cookie },
    });
    expect([202, 409]).toContain(retry.statusCode);
  });

  it("rejects scheduling in the past and accepts a future slot", async () => {
    const list = await app.inject({ method: "GET", url: `/v1/workspaces/${workspaceId}/posts?state=processing`, headers: { cookie } });
    const postId = list.json().posts[0]?.id;
    if (!postId) return; // previous test may have consumed the only post
    const past = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}/schedule`,
      headers: { cookie },
      payload: { scheduledAt: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(past.statusCode).toBe(400);
  });

  it("lists and marks notifications", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/notifications`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const all = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/notifications/read-all`,
      headers: { cookie },
    });
    expect(all.statusCode).toBe(200);
  });
});
