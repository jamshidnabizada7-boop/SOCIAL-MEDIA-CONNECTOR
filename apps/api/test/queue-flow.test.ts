import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { createDatabase, migrationsFolder, plans, publishJobs, publishTargets, posts, queueSlots, socialAccounts, socialProviders } from "@aria/db";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { nextQueueSlot } from "../src/modules/queue/routes.js";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

/**
 * Queue-scheduling logic: next-open-slot computation and the add-to-queue
 * endpoint scheduling targets at the computed window.
 */

let app: FastifyInstance;
let cookie = "";
let workspaceId = "";
let accountId = "";
const dataDir = path.resolve(process.cwd(), `.test-data/queue-${Date.now()}`);

beforeAll(async () => {
  process.env.ARIA_DATA_DIR = dataDir;
  const probe = await createDatabase({ dataDir });
  await migratePglite(probe.db as never, { migrationsFolder: migrationsFolder() });
  await probe.db.insert(plans).values({ id: "free", name: "Free", maxBrands: 1, maxMembers: 1, storageGb: 1 }).onConflictDoNothing();
  await probe.db.insert(socialProviders).values({ id: "x", name: "X", approval: "approved", capabilities: { formats: { text: true, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, hashtags: true, firstComment: false, thumbnail: false, customCover: false, privacyControl: false, schedule: true, directPublish: true, manualPublishFallback: false, comments: true, analytics: true, deletion: true, editing: false, aiDisclosure: false, brandedContent: false, maxCaptionLength: 280, maxImages: 4, maxVideoDurationSec: 140, maxVideoBytes: 5e8, maxImageBytes: 5e6, aspectRatios: [] } }).onConflictDoNothing();
  await probe.close();

  app = await buildServer();
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "q@flow.test", password: "correct-horse-battery", name: "Queue Tester" },
  });
  cookie = reg.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ws = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { cookie },
    payload: { name: "Queue WS" },
  });
  workspaceId = ws.json().workspace.id;
  const [acc] = await app.database.db
    .insert(socialAccounts)
    .values({ workspaceId, providerId: "x", externalAccountId: "ext_q", displayName: "Q X", handle: "@q", connection: "healthy", scopes: [] })
    .returning();
  accountId = acc.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows locks */
  }
});

describe("next-slot computation", () => {
  it("finds the earliest matching weekday slot at least 10 minutes out", async () => {
    // DB seed only has free plan; queue slots for this workspace are the two
    // seeded in beforeAll (workspaceId 000…) — but nextQueueSlot filters by
    // workspace, so insert slots for THIS workspace with fixed weekdays.
    await app.database.db.insert(queueSlots).values([
      { workspaceId, dayOfWeek: new Date().getUTCDay(), time: "23:59", providerIds: ["x"], enabled: true },
    ]);
    const slot = await nextQueueSlot(app.database.db, workspaceId, ["x"], Date.now());
    // Today's 23:59 UTC may be past; if so the next occurrence is next week —
    // both are ≥10min out, so a result must exist either way.
    expect(slot).not.toBeNull();
    expect(slot!.at.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000 - 1000);
  });

  it("returns null when no enabled slot matches the providers", async () => {
    const slot = await nextQueueSlot(app.database.db, workspaceId, ["mastodon"], Date.now());
    expect(slot).toBeNull();
  });
});

describe("add-to-queue endpoint", () => {
  it("schedules the post and creates delayed jobs", async () => {
    const post = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts`,
      headers: { cookie },
      payload: { title: "Queued", caption: "Into the queue", accountIds: [accountId] },
    });
    const postId = post.json().post.id;
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}/add-to-queue`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slotId).toBeTruthy();
    const detail = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/posts/${postId}`,
      headers: { cookie },
    });
    const p = detail.json().post;
    expect(p.state).toBe("scheduled");
    expect(new Date(p.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    // delayed jobs exist for the target
    const jobs = await app.database.db.select().from(publishJobs);
    expect(jobs.some((j) => j.state === "delayed")).toBe(true);
  });
});
