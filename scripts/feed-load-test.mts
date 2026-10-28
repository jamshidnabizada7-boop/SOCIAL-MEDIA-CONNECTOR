import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Cached-feed benchmark only: no external calls, mail, account tokens or live DB.
const privateRoot = path.resolve(".local");
mkdirSync(privateRoot, { recursive: true });
const dataDir = mkdtempSync(path.join(privateRoot, "feed-load-"));
const originalFetch = globalThis.fetch;
let externalProviderCalls = 0;
globalThis.fetch = async () => {
  externalProviderCalls++;
  throw new Error(
    "External requests are disabled in the cached-feed load test",
  );
};
delete process.env.DATABASE_URL;
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  ARIA_DATA_DIR: dataDir,
  ARIA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ARIA_FEED_DEFAULTS: "false",
  SMTP_URL: "",
  SENTRY_DSN: "",
  STRIPE_SECRET_KEY: "",
});
const {
  createDatabase,
  runMigrations,
  users,
  workspaces,
  workspaceMembers,
  sessions,
  hashToken,
  feedSources,
  feedItems,
} = await import("@aria/db");
const { buildServer } = await import("../apps/api/src/server.js");
const { SESSION_COOKIE } = await import("../apps/api/src/config.js");
const handle = await createDatabase({ dataDir });
await runMigrations(handle);
await handle.close();
const app = await buildServer();
await app.ready();
const concurrentUsers = 8,
  itemsPerUser = 240,
  latencies: number[] = [];
let requests = 0;
try {
  const db = app.database.db;
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Feed load fixture",
      slug: `feed-load-${Date.now()}`,
      planId: "agency",
    })
    .returning();
  const profiles: Array<{ id: string; cookie: string; sources: string[] }> = [];
  for (let u = 0; u < concurrentUsers; u++) {
    const [user] = await db
      .insert(users)
      .values({
        name: `Load profile ${u}`,
        email: `feed-load-${u}@fixture.test`,
      })
      .returning();
    const token = randomBytes(24).toString("hex");
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 3600000),
    });
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "viewer",
      status: "active",
    });
    const sources = await db
      .insert(feedSources)
      .values(
        (["bluesky", "mastodon"] as const).map((provider) => ({
          userId: user.id,
          provider,
          kind: "public" as const,
          label: "Load fixture",
          sourceKey: `load-${provider}`,
          config: {},
        })),
      )
      .returning();
    await db.insert(feedItems).values(
      Array.from({ length: itemsPerUser }, (_, i) => {
        const source = sources[i % 2],
          provider = source.provider as "bluesky" | "mastodon";
        return {
          sourceId: source.id,
          providerPostId: `load-${u}-${i}`,
          expiresAt: new Date(Date.now() + 3600000),
          content: {
            id: "",
            provider,
            providerPostId: `load-${u}-${i}`,
            authorId: `author-${u}-${i % 7}`,
            authorName: "Load fixture author",
            contentType: "text" as const,
            caption: "Synthetic metadata for the isolated load test.",
            images: [],
            originalUrl: `https://example.test/load/${u}/${i}`,
            publishedAt: new Date().toISOString(),
            likeCount: null,
            commentCount: null,
            shareCount: null,
            sourceType: "public" as const,
            sourceId: source.id,
            topics: [],
            canEmbed: false,
            availability: "available" as const,
            sensitive: false,
          },
        };
      }),
    );
    profiles.push({
      id: user.id,
      cookie: `${SESSION_COOKIE}=${token}`,
      sources: sources.map((source) => source.id),
    });
  }
  const started = performance.now();
  await Promise.all(
    profiles.map(async (profile) => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const start = performance.now();
        const response = await app.inject({
          method: "GET",
          url: `/v1/workspaces/${workspace.id}/feed?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          headers: { cookie: profile.cookie },
        });
        latencies.push(performance.now() - start);
        requests++;
        assert.equal(
          response.statusCode,
          200,
          "Every feed request must succeed",
        );
        const page = response.json();
        for (const item of page.items) {
          assert(
            profile.sources.includes(item.sourceId),
            "Personal source isolation",
          );
          const key = `${item.provider}:${item.providerPostId}`;
          assert(!seen.has(key), "No duplicate native post across pages");
          seen.add(key);
        }
        if (seen.size === 12)
          assert.equal(
            new Set(
              page.items.map((item: { provider: string }) => item.provider),
            ).size,
            2,
            "First batch must mix both available providers",
          );
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(
        seen.size,
        itemsPerUser,
        "The entire cached pool is reachable",
      );
    }),
  );
  latencies.sort((a, b) => a - b);
  const p95Ms = Math.ceil(latencies[Math.floor(latencies.length * 0.95)]);
  assert(
    p95Ms < 2000,
    `Cached feed p95 must remain under 2 seconds for this bounded workload (${p95Ms}ms)`,
  );
  const result = {
    concurrentUsers,
    itemsPerUser,
    cachedItems: concurrentUsers * itemsPerUser,
    requests,
    p95Ms,
    maxMs: Math.ceil(latencies.at(-1)!),
    durationMs: Math.ceil(performance.now() - started),
    duplicates: 0,
    ownershipLeaks: 0,
    externalProviderCalls,
    database: "isolated PGlite",
    verifiedAt: new Date().toISOString(),
  };
  assert.equal(
    externalProviderCalls,
    0,
    "Scrolling must not request provider data",
  );
  writeFileSync(
    path.join(privateRoot, "feed-load-test.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await app.close();
  const relative = path.relative(privateRoot, dataDir);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "Cleanup must stay in the private load-test directory",
  );
  rmSync(dataDir, { recursive: true, force: true });
}
