import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase, migrationsFolder, plans, socialAccounts, socialProviders, remotePosts, publishTargets, posts, publishJobs } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { createHmac } from "node:crypto";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

/**
 * Webhook gateway flow: signature verification, dedupe, raw persistence, and
 * publish-status processing against a fresh embedded Postgres.
 */

const SECRET = "whsec_test_123";

let app: FastifyInstance;
let cookie = "";
let workspaceId = "";
let targetId = "";
const dataDir = path.resolve(process.cwd(), `.test-data/webhooks-${Date.now()}`);

function signedBody(payload: Record<string, unknown>): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  return { body, signature };
}

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c";
  process.env.WEBHOOK_SECRET_TIKTOK = SECRET;
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
  await probe.db.insert(socialProviders).values({
    id: "tiktok",
    name: "TikTok",
    approval: "pending",
    capabilities: {
      formats: { text: false, image: true, video: true, document: false, carousel: true },
      altText: false, linkPreview: false, hashtags: true, firstComment: false, thumbnail: true,
      customCover: true, privacyControl: true, schedule: true, directPublish: true,
      manualPublishFallback: true, comments: false, analytics: true, deletion: false,
      editing: false, aiDisclosure: true, brandedContent: true,
      maxCaptionLength: 2200, maxImages: 0, maxVideoDurationSec: 600, maxVideoBytes: 1e9,
      maxImageBytes: 2e7, aspectRatios: ["9:16"],
    },
  }).onConflictDoNothing();
  await probe.close();

  app = await buildServer();
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "wh@flow.test", password: "correct-horse-battery", name: "Webhook Tester" },
  });
  cookie = reg.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ws = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { cookie },
    payload: { name: "Webhook WS" },
  });
  workspaceId = ws.json().workspace.id;

  // Fixture: a post in provider_processing with a known remote id.
  const [acc] = await app.database.db
    .insert(socialAccounts)
    .values({ workspaceId, providerId: "tiktok", externalAccountId: "ext_wh", displayName: "TikTok WH", handle: "@wh", connection: "healthy", scopes: [] })
    .returning();
  const [post] = await app.database.db
    .insert(posts)
    .values({ workspaceId, authorId: reg.json().user.id, title: "WH post", caption: "hi", state: "processing" })
    .returning();
  const [target] = await app.database.db
    .insert(publishTargets)
    .values({ postId: post.id, accountId: acc.id, providerId: "tiktok", state: "provider_processing", idempotencyKey: "idem_wh_1" })
    .returning();
  await app.database.db.insert(remotePosts).values({ targetId: target.id, providerPostId: "pub_123" });
  await app.database.db.insert(publishJobs).values({ targetId: target.id, state: "delayed" });
  targetId = target.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows locks */
  }
});

describe("webhook gateway", () => {
  it("rejects unverified payloads when a secret is configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/tiktok",
      headers: { "content-type": "application/json" },
      payload: { event: "VIDEO_PUBLISH_COMPLETE", publish_id: "pub_unverified" },
    });
    expect(res.statusCode).toBe(401);
    // The unverified event must not have processed the target.
    const target = (await app.database.db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1))[0];
    expect(target.state).toBe("provider_processing");
  });

  it("rejects invalid signatures", async () => {
    const { body } = signedBody({ event: "VIDEO_PUBLISH_COMPLETE", publish_id: "pub_invalid" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/tiktok",
      headers: { "content-type": "application/json", "x-signature": "deadbeef" },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("processes a correctly signed publish-completion event", async () => {
    const { body, signature } = signedBody({ event: "VIDEO_PUBLISH_COMPLETE", publish_id: "pub_123" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/tiktok",
      headers: { "content-type": "application/json", "x-signature": signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(true);
    const target = (await app.database.db.select().from(publishTargets).where(eq(publishTargets.id, targetId)).limit(1))[0];
    expect(target.state).toBe("published");
    const post = (await app.database.db.select().from(posts).where(eq(posts.id, target.postId)).limit(1))[0];
    expect(post.state).toBe("published");
  });

  it("deduplicates replays of the same event", async () => {
    const { body, signature } = signedBody({ event: "VIDEO_PUBLISH_COMPLETE", publish_id: "pub_123" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/tiktok",
      headers: { "content-type": "application/json", "x-signature": signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
  });

  it("responds 503 with guidance when no secret is configured", async () => {
    delete process.env.WEBHOOK_SECRET_TIKTOK;
    const { body, signature } = signedBody({ event: "OTHER", publish_id: "pub_9" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/tiktok",
      headers: { "content-type": "application/json", "x-signature": signature },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("signature_no_secret_configured");
    process.env.WEBHOOK_SECRET_TIKTOK = SECRET;
  });
});
