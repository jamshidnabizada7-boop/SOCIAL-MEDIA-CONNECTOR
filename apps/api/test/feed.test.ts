import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createDatabase,
  encryptSecret,
  feedItems,
  feedSaved,
  feedSessions,
  feedSources,
  feedSyncState,
  oauthCredentials,
  runMigrations,
  socialAccounts,
  workspaceMembers,
  workspaces,
  users,
} from "@aria/db";
import { DEFAULT_FEED_PREFERENCES, type FeedPage } from "@aria/shared-types";
import type { FetchLike } from "@aria/providers-core";
import { buildServer } from "../src/server.js";
import { feedTick, retainFeed, syncFeedSource } from "../../worker/src/feed.js";

let app: FastifyInstance,
  cookie: string,
  otherCookie: string,
  userId: string,
  otherId: string,
  ws: string,
  otherWs: string,
  bskySource: string,
  mastoSource: string,
  otherSource: string,
  accountId: string;
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers });
const fixture = vi.fn<FetchLike>(async (url) => {
  if (url.includes("bsky"))
    return json({
      feed: Array.from({ length: 22 }, (_, i) => ({
        post: {
          uri: `at://did:plc:author${i % 3}/app.bsky.feed.post/key${i}`,
          author: {
            did: `did:plc:author${i % 3}`,
            displayName: `Creator ${i % 3}`,
            handle: `creator${i % 3}.bsky.social`,
          },
          record: {
            text: `Technology fixture idea ${i}`,
            createdAt: "2026-10-28T12:00:00Z",
          },
          embed:
            i % 2
              ? {
                  $type: "app.bsky.embed.video#view",
                  thumbnail: "https://cdn.example/thumb.jpg",
                }
              : {},
          likeCount: i,
        },
      })),
    });
  if (url.includes("social.example"))
    return json(
      Array.from({ length: 14 }, (_, i) => ({
        id: String(100 + i),
        visibility: "public",
        url: `https://social.example/@creator/${100 + i}`,
        content: `<p>Education fixture note ${i}</p>`,
        account: {
          id: "creator",
          display_name: "Mastodon creator",
          acct: "creator",
        },
        created_at: "2026-10-28T12:00:00Z",
      })),
    );
  throw new Error("Unexpected fixture request");
});
const get = (suffix = "", session = cookie, workspace = ws) =>
  app.inject({
    method: "GET",
    url: `/v1/workspaces/${workspace}/feed${suffix}`,
    headers: { cookie: session },
  });
const mutate = (
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  suffix: string,
  payload?: unknown,
  session = cookie,
  workspace = ws,
) =>
  app.inject({
    method,
    url: `/v1/workspaces/${workspace}/feed${suffix}`,
    headers: { cookie: session },
    payload,
  });
async function source(
  provider = "bluesky",
  session = cookie,
  workspace = ws,
  extra: Record<string, unknown> = {},
) {
  const r = await mutate(
    "POST",
    "/sources",
    {
      provider,
      kind: "public",
      label: `${provider} fixture`,
      config:
        provider === "mastodon" ? { instance: "https://social.example" } : {},
      topics: ["Technology"],
      ...extra,
    },
    session,
    workspace,
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.ARIA_DATA_DIR = path.resolve(
    process.cwd(),
    `.test-data/feed-${Date.now()}`,
  );
  process.env.ARIA_ENCRYPTION_KEY = "f2".repeat(32);
  process.env.ARIA_ALLOW_PRIVATE_INSTANCES = "true";
  process.env.ARIA_FEED_DEFAULTS = "false";
  process.env.LOG_LEVEL = "error";
  const h = await createDatabase({ dataDir: process.env.ARIA_DATA_DIR });
  await runMigrations(h);
  await h.close();
  app = await buildServer();
  await app.ready();
  async function register(email: string) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Feed tester",
        email,
        password: "correct-horse-battery",
      },
    });
    expect(r.statusCode).toBe(201);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      id: r.json().user.id as string,
    };
  }
  const a = await register("feed-owner@fixture.test"),
    b = await register("feed-other@fixture.test");
  cookie = a.cookie;
  userId = a.id;
  otherCookie = b.cookie;
  otherId = b.id;
  const [w] = await app.database.db
    .insert(workspaces)
    .values({ name: "Feed fixture", slug: `feed-${Date.now()}`, planId: "pro" })
    .returning();
  ws = w.id;
  const [o] = await app.database.db
    .insert(workspaces)
    .values({
      name: "Other feed",
      slug: `feed-other-${Date.now()}`,
      planId: "pro",
    })
    .returning();
  otherWs = o.id;
  await app.database.db.insert(workspaceMembers).values([
    { workspaceId: ws, userId, role: "owner", status: "active" },
    { workspaceId: ws, userId: otherId, role: "viewer", status: "active" },
    { workspaceId: otherWs, userId: otherId, role: "owner", status: "active" },
  ]);
  bskySource = await source();
  mastoSource = await source("mastodon");
  otherSource = await source("bluesky", otherCookie);
  await syncFeedSource(app.database.db, bskySource, { fetchImpl: fixture });
  await syncFeedSource(app.database.db, mastoSource, { fetchImpl: fixture });
  await syncFeedSource(app.database.db, otherSource, { fetchImpl: fixture });
}, 120000);
afterAll(async () => {
  await app?.close();
});
describe("feed authorization, caching and durable personalization", () => {
  it("migrates forward with all feed tables without dropping existing application tables", async () => {
    const result = await app.database.db.execute(
      sql`select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
    );
    expect(result.rows[0].n).toBe(49);
  });
  it("requires authentication and active membership", async () => {
    expect((await get("", "")).statusCode).toBe(401);
    expect((await get("", cookie, otherWs)).statusCode).toBe(404);
  });
  it("mixes real normalized cache data, deduplicates and paginates a frozen session without provider requests", async () => {
    const before = fixture.mock.calls.length;
    const first = await get("?limit=5");
    expect(first.statusCode, first.body).toBe(200);
    const a = first.json<FeedPage>();
    expect(a.items).toHaveLength(5);
    expect(new Set(a.items.map((i) => i.provider)).size).toBe(2);
    const second = await get(
      `?limit=5&cursor=${encodeURIComponent(a.nextCursor!)}`,
    );
    const b = second.json<FeedPage>();
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.items).toHaveLength(5);
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(10);
    expect(fixture.mock.calls.length).toBe(before);
    expect(
      (
        await get(`?limit=5&cursor=${encodeURIComponent(a.nextCursor!)}`)
      ).json(),
    ).toEqual({ ...b, cachedAt: expect.any(String) });
  });
  it("does not expose personal items between users who share a workspace", async () => {
    const a = (await get()).json<FeedPage>();
    const b = (await get("", otherCookie)).json<FeedPage>();
    expect(a.items.every((i) => !b.items.some((x) => x.id === i.id))).toBe(
      true,
    );
    expect(
      (await mutate("POST", "/saved", { itemId: a.items[0].id }, otherCookie))
        .statusCode,
    ).toBe(404);
  });
  it("binds cursors to the user, workspace, filters and expiry", async () => {
    const a = (await get("?limit=2")).json<FeedPage>();
    expect(
      (await get(`?limit=2&cursor=${a.nextCursor}`, otherCookie)).statusCode,
    ).toBe(410);
    expect(
      (await get(`?limit=2&provider=youtube&cursor=${a.nextCursor}`))
        .statusCode,
    ).toBe(400);
    expect((await get("?cursor=bad")).statusCode).toBe(400);
    await app.database.db
      .update(feedSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(feedSessions.id, a.sessionId));
    expect((await get(`?limit=2&cursor=${a.nextCursor}`)).statusCode).toBe(410);
  });
  it("supports video/post/search/topic/platform filters using cached content", async () => {
    expect(
      (await get("?view=videos"))
        .json<FeedPage>()
        .items.every((i) => i.contentType === "video"),
    ).toBe(true);
    expect(
      (await get("?view=posts"))
        .json<FeedPage>()
        .items.every((i) => i.contentType !== "video"),
    ).toBe(true);
    expect(
      (await get("?provider=mastodon&search=Education&topic=Technology"))
        .json<FeedPage>()
        .items.every(
          (i) => i.provider === "mastodon" && i.caption.includes("Education"),
        ),
    ).toBe(true);
    expect(
      (await get("?search=missing-search-term")).json<FeedPage>().items,
    ).toHaveLength(0);
  });
  it("persists idempotent bookmarks and follows, independent of native actions", async () => {
    const item = (await get("?provider=bluesky")).json<FeedPage>().items[0];
    await mutate("POST", "/saved", { itemId: item.id });
    await mutate("POST", "/saved", { itemId: item.id });
    expect(
      (await get("?view=saved")).json<FeedPage>().items.map((i) => i.id),
    ).toEqual([item.id]);
    expect(
      (await get("?view=saved", otherCookie)).json<FeedPage>().items,
    ).toHaveLength(0);
    await mutate("POST", "/following", { itemId: item.id });
    expect(
      (await get("?view=following"))
        .json<FeedPage>()
        .items.every((i) => i.authorId === item.authorId),
    ).toBe(true);
    expect((await get("/following")).json().following).toHaveLength(1);
    await mutate("DELETE", `/following/${item.id}`);
    expect((await get("?view=following")).json<FeedPage>().items).toHaveLength(
      0,
    );
  });
  it("reports and hides only the caller's content and resets preferences without deleting saves", async () => {
    const saved = (await get("?view=saved")).json<FeedPage>().items[0];
    expect(
      (await mutate("POST", "/hide", { itemId: saved.id, report: true }))
        .statusCode,
    ).toBe(200);
    expect((await get("?view=saved")).json<FeedPage>().items).toHaveLength(0);
    await mutate("DELETE", "/preferences");
    expect(
      (await get("?view=saved")).json<FeedPage>().items.map((i) => i.id),
    ).toContain(saved.id);
  });
  it("enforces user ownership in preference IDs and in source changes", async () => {
    expect(
      (
        await mutate("PUT", "/preferences", {
          ...DEFAULT_FEED_PREFERENCES,
          mutedSourceIds: [otherSource],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await mutate("PATCH", `/sources/${otherSource}`, { enabled: false }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await mutate("PUT", "/preferences", {
          ...DEFAULT_FEED_PREFERENCES,
          favoriteProviders: ["bad"],
        })
      ).statusCode,
    ).toBe(400);
    await mutate("PUT", "/preferences", {
      ...DEFAULT_FEED_PREFERENCES,
      mutedSourceIds: [mastoSource],
      favoriteProviders: ["bluesky"],
    });
    expect(
      (await get())
        .json<FeedPage>()
        .items.every((i) => i.provider === "bluesky"),
    ).toBe(true);
    expect(
      (await get("/preferences", otherCookie)).json().mutedSourceIds,
    ).toEqual([]);
    await mutate("DELETE", "/preferences");
  });
  it("rejects unsafe URLs, arbitrary embeds, cross-workspace account IDs and unsupported source types", async () => {
    expect(
      (
        await mutate("POST", "/sources", {
          provider: "youtube",
          kind: "url",
          label: "bad",
          config: {
            url: "https://youtube.com.evil.example/watch?v=abcdefghijk",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await mutate("POST", "/sources", {
          provider: "instagram",
          kind: "public",
          label: "private feed",
          config: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await mutate("POST", "/sources", {
          provider: "bluesky",
          kind: "account",
          accountId: randomUUID(),
          label: "unknown",
          config: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await mutate("POST", "/sources", {
          provider: "youtube",
          kind: "url",
          label: "markup",
          config: { url: "https://youtu.be/abcdefghijk", html: "<iframe>" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("removes only owned optional sources and leaves managed defaults available to pause", async () => {
    const added = await mutate("POST", "/sources", {
      provider: "x",
      kind: "url",
      label: "Optional reference",
      config: { url: "https://x.com/creator/status/123456789" },
    });
    expect(added.statusCode).toBe(201);
    const id = added.json().id;
    await syncFeedSource(app.database.db, id, { fetchImpl: fixture });
    const [reference] = await app.database.db
      .select()
      .from(feedItems)
      .where(eq(feedItems.sourceId, id));
    expect(
      (await mutate("POST", "/following", { itemId: reference.id })).statusCode,
    ).toBe(409);
    expect(
      (
        await mutate("PUT", "/preferences", {
          ...DEFAULT_FEED_PREFERENCES,
          mutedSourceIds: [id],
          reducedSourceIds: [id],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await mutate("DELETE", `/sources/${id}`, {}, otherCookie)).statusCode,
    ).toBe(404);
    expect((await mutate("DELETE", `/sources/${id}`)).statusCode).toBe(200);
    const afterRemoval = (await get("/preferences")).json();
    expect(afterRemoval.mutedSourceIds).toEqual([]);
    expect(afterRemoval.reducedSourceIds).toEqual([]);
    expect((await mutate("PUT", "/preferences", afterRemoval)).statusCode).toBe(
      200,
    );
    expect((await mutate("DELETE", `/sources/${id}`)).statusCode).toBe(404);
    expect((await mutate("DELETE", `/sources/${bskySource}`)).statusCode).toBe(
      409,
    );
  });
  it("keeps at most 20 recent browsing sessions per user and workspace", async () => {
    for (let i = 0; i < 21; i++) expect((await get()).statusCode).toBe(200);
    const rows = await app.database.db
      .select()
      .from(feedSessions)
      .where(
        and(eq(feedSessions.userId, userId), eq(feedSessions.workspaceId, ws)),
      );
    expect(rows.length).toBeLessThanOrEqual(20);
  });
  it("enforces the source cap under concurrent additions and still serves a full profile when defaults are enabled", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Source cap test",
        email: "source-cap@fixture.test",
        password: "correct-horse-battery",
      },
    });
    expect(registered.statusCode).toBe(201);
    const id = registered.json().user.id,
      session = registered.cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    await app.database.db.insert(workspaceMembers).values({
      workspaceId: ws,
      userId: id,
      role: "viewer",
      status: "active",
    });
    await app.database.db.insert(feedSources).values(
      Array.from({ length: 29 }, (_, i) => ({
        userId: id,
        provider: "x",
        kind: "url" as const,
        label: "Cap fixture",
        sourceKey: `cap-${i}`,
        config: { url: `https://x.com/creator/status/${100000 + i}` },
      })),
    );
    const results = await Promise.all(
      [200001, 200002].map((postId) =>
        mutate(
          "POST",
          "/sources",
          {
            provider: "x",
            kind: "url",
            label: "Concurrent source",
            config: { url: `https://x.com/creator/status/${postId}` },
          },
          session,
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      (
        await app.database.db
          .select()
          .from(feedSources)
          .where(eq(feedSources.userId, id))
      ).length,
    ).toBe(30);
    process.env.ARIA_FEED_DEFAULTS = "true";
    try {
      expect((await get("", session)).statusCode).toBe(200);
      expect((await get("/sources", session)).statusCode).toBe(200);
    } finally {
      process.env.ARIA_FEED_DEFAULTS = "false";
      await app.database.db.delete(users).where(eq(users.id, id));
    }
  });
  it("returns expired saved content as a safe reference with no player or cached caption", async () => {
    const item = (await get("?view=saved")).json<FeedPage>().items[0];
    await app.database.db
      .update(feedItems)
      .set({ expiresAt: new Date(0) })
      .where(eq(feedItems.id, item.id));
    const saved = (await get("?view=saved")).json<FeedPage>().items[0];
    expect(saved.availability).toBe("unavailable");
    expect(saved.caption).toBe("");
    expect(saved.embedUrl).toBeUndefined();
    expect(saved.images).toEqual([]);
    await mutate("DELETE", `/saved/${item.id}`);
  });
  it("keeps saves and hidden signals consistent when the same native post appears in another source", async () => {
    const [original] = await app.database.db
      .select()
      .from(feedItems)
      .where(eq(feedItems.sourceId, bskySource))
      .limit(1);
    const added = await mutate("POST", "/sources", {
      provider: "bluesky",
      kind: "search",
      label: "Duplicate source",
      config: { query: "same post" },
    });
    expect(added.statusCode).toBe(201);
    const sourceId = added.json().id;
    const [copy] = await app.database.db
      .insert(feedItems)
      .values({
        sourceId,
        providerPostId: original.providerPostId,
        content: { ...original.content, sourceId },
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    await mutate("POST", "/saved", { itemId: original.id });
    await mutate("POST", "/saved", { itemId: copy.id });
    expect(
      (await get("?view=saved"))
        .json<FeedPage>()
        .items.filter((i) => i.providerPostId === original.providerPostId),
    ).toHaveLength(1);
    await mutate("POST", "/hide", { itemId: copy.id });
    expect(
      (await get())
        .json<FeedPage>()
        .items.some((i) => i.providerPostId === original.providerPostId),
    ).toBe(false);
    await mutate("DELETE", "/preferences");
    await mutate("DELETE", `/saved/${copy.id}`);
    expect(
      (await get("?view=saved"))
        .json<FeedPage>()
        .items.some((i) => i.providerPostId === original.providerPostId),
    ).toBe(false);
    await mutate("DELETE", `/sources/${sourceId}`);
  });
  it("rechecks paused sources on continuation instead of leaking a cached session snapshot", async () => {
    const first = (await get("?limit=2")).json<FeedPage>();
    await mutate("PATCH", `/sources/${mastoSource}`, { enabled: false });
    const next = (
      await get(`?limit=20&cursor=${first.nextCursor}`)
    ).json<FeedPage>();
    expect(next.items.every((i) => i.sourceId !== mastoSource)).toBe(true);
    await mutate("PATCH", `/sources/${mastoSource}`, { enabled: true });
  });
  it("auto-adds authorized My Accounts content and removes it from visibility on revoked connections", async () => {
    const [a] = await app.database.db
      .insert(socialAccounts)
      .values({
        workspaceId: ws,
        providerId: "bluesky",
        externalAccountId: "did:plc:own",
        displayName: "My account",
        handle: "own.bsky.social",
        connection: "healthy",
        scopes: [],
      })
      .returning();
    accountId = a.id;
    await app.database.db.insert(oauthCredentials).values({
      accountId: a.id,
      accessTokenEnc: encryptSecret("fixture-only"),
    });
    const sources = (await get("/sources")).json().sources as Array<{
      id: string;
      accountId: string;
    }>;
    const sourceId = sources.find((s) => s.accountId === a.id)!.id;
    await syncFeedSource(app.database.db, sourceId, { fetchImpl: fixture });
    const ownItem = (await get("?view=my_accounts")).json<FeedPage>().items[0];
    expect(
      (await get("?view=my_accounts")).json<FeedPage>().items.length,
    ).toBeGreaterThan(0);
    await app.database.db
      .update(socialAccounts)
      .set({ connection: "needs_reauth" })
      .where(eq(socialAccounts.id, accountId));
    expect(
      (await get("?view=my_accounts")).json<FeedPage>().items,
    ).toHaveLength(0);
    expect(
      (await mutate("POST", "/saved", { itemId: ownItem.id })).statusCode,
    ).toBe(404);
  });
});
describe("feed worker claims, failures and retention", () => {
  it("claims a source once across concurrent workers and upserts without duplicating posts", async () => {
    await app.database.db
      .update(feedSyncState)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(feedSyncState.sourceId, bskySource));
    const before = fixture.mock.calls.length;
    const results = await Promise.all([
      syncFeedSource(app.database.db, bskySource, { fetchImpl: fixture }),
      syncFeedSource(app.database.db, bskySource, { fetchImpl: fixture }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fixture.mock.calls.length - before).toBe(1);
    const rows = await app.database.db
      .select()
      .from(feedItems)
      .where(eq(feedItems.sourceId, bskySource));
    expect(rows).toHaveLength(22);
  });
  it("honors provider Retry-After without replacing valid cache with fake data", async () => {
    await app.database.db
      .update(feedSyncState)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(feedSyncState.sourceId, bskySource));
    const before = Date.now();
    expect(
      await syncFeedSource(app.database.db, bskySource, {
        fetchImpl: async () =>
          json({ error: "rate_limited" }, 429, { "retry-after": "120" }),
      }),
    ).toBe(false);
    const [state] = await app.database.db
      .select()
      .from(feedSyncState)
      .where(eq(feedSyncState.sourceId, bskySource));
    expect(state.nextSyncAt.getTime()).toBeGreaterThanOrEqual(before + 119000);
    expect(state.error).not.toContain("rate_limited");
    await mutate("PATCH", `/sources/${bskySource}`, { enabled: false });
    await mutate("PATCH", `/sources/${bskySource}`, { enabled: true });
    await mutate("POST", "/sync", {});
    const [afterRefresh] = await app.database.db
      .select()
      .from(feedSyncState)
      .where(eq(feedSyncState.sourceId, bskySource));
    expect(afterRefresh.nextSyncAt).toEqual(state.nextSyncAt);
    expect(afterRefresh.status).toEqual(state.status);
    const count = (
      await app.database.db
        .select()
        .from(feedItems)
        .where(eq(feedItems.sourceId, bskySource))
    ).length;
    expect(count).toBe(22);
    const retry = vi.fn<FetchLike>();
    await syncFeedSource(app.database.db, bskySource, { fetchImpl: retry });
    expect(retry).not.toHaveBeenCalled();
  });
  it("expires inaccessible content after provider denial and keeps errors free of token payloads", async () => {
    await app.database.db
      .update(feedSyncState)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(feedSyncState.sourceId, mastoSource));
    await syncFeedSource(app.database.db, mastoSource, {
      fetchImpl: async () =>
        json({ error: "credential-secret-must-not-appear" }, 403),
    });
    const [state] = await app.database.db
      .select()
      .from(feedSyncState)
      .where(eq(feedSyncState.sourceId, mastoSource));
    expect(state.status).toBe("blocked");
    expect(state.error).not.toContain("credential-secret");
    expect(
      (await get("?provider=mastodon")).json<FeedPage>().items,
    ).toHaveLength(0);
  });
  it("does not retrieve sources after membership removal and preserves the publishing queue", async () => {
    const ownSource = (
      await app.database.db
        .select()
        .from(feedSources)
        .where(eq(feedSources.accountId, accountId))
    )[0];
    await app.database.db
      .update(socialAccounts)
      .set({ connection: "healthy" })
      .where(eq(socialAccounts.id, accountId));
    await app.database.db
      .update(feedSyncState)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(feedSyncState.sourceId, ownSource.id));
    await app.database.db
      .update(workspaceMembers)
      .set({ status: "invited" })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws),
          eq(workspaceMembers.userId, userId),
        ),
      );
    const call = vi.fn<FetchLike>();
    await syncFeedSource(app.database.db, ownSource.id, { fetchImpl: call });
    expect(call).not.toHaveBeenCalled();
    expect((await get()).statusCode).toBe(404);
    await app.database.db
      .update(workspaceMembers)
      .set({ status: "active" })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws),
          eq(workspaceMembers.userId, userId),
        ),
      );
    const result = await app.database.db.execute(
      sql`select count(*)::int n from publish_jobs`,
    );
    expect(result.rows[0].n).toBe(0);
  });
  it("runs bounded cycles and expires browsing sessions through normal maintenance", async () => {
    await feedTick(app.database.db, { fetchImpl: fixture });
    const [kept] = await app.database.db
      .select()
      .from(feedItems)
      .where(eq(feedItems.sourceId, bskySource))
      .limit(1);
    await app.database.db
      .insert(feedSaved)
      .values({ userId, itemId: kept.id })
      .onConflictDoNothing();
    await retainFeed(app.database.db, new Date(Date.now() + 3 * 86400000));
    expect((await app.database.db.select().from(feedSessions)).length).toBe(0);
    const [reference] = await app.database.db
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, kept.id));
    expect(reference.content.originalUrl).toBe(kept.content.originalUrl);
    expect(reference.content.caption).toBe("");
    expect(reference.content.images).toEqual([]);
    expect(reference.content.embedUrl).toBeUndefined();
    expect(reference.content.availability).toBe("unavailable");
  });
});
