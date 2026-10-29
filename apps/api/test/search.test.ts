import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createDatabase,
  encryptSecret,
  feedItems,
  feedSources,
  oauthCredentials,
  runMigrations,
  socialAccounts,
  workspaceMembers,
  workspaces,
} from "@aria/db";
import type {
  UniversalFeedItem,
  UniversalSearchResponse,
} from "@aria/shared-types";
import { buildServer } from "../src/server.js";

let app: FastifyInstance,
  cookie: string,
  owner: string,
  other: string,
  workspace: string,
  otherWorkspace: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const fixtureToken = "private-search-fixture-token";
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });
const search = (
  query: string,
  scope = workspace,
  session = cookie,
  remoteAddress = "127.0.0.1",
) =>
  app.inject({
    method: "POST",
    url: `/v1/workspaces/${scope}/feed/search/all`,
    headers: { cookie: session },
    payload: { query },
    remoteAddress,
  });
const publicPost = {
  uri: "at://did:plc:search/app.bsky.feed.post/space",
  author: {
    did: "did:plc:search",
    displayName: "Space Public Creator",
    handle: "space.bsky.social",
  },
  record: {
    text: "Space launch public result",
    createdAt: "2026-10-29T00:00:00Z",
  },
};
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.ARIA_FEED_FIXTURE_ORIGIN;
  process.env.ARIA_DATA_DIR = path.resolve(
    process.cwd(),
    `.test-data/search-${Date.now()}`,
  );
  process.env.ARIA_ENCRYPTION_KEY = "f2".repeat(32);
  process.env.ARIA_ALLOW_PRIVATE_INSTANCES = "true";
  process.env.ARIA_FEED_DEFAULTS = "false";
  process.env.YOUTUBE_DATA_API_KEY = "";
  process.env.LOG_LEVEL = "error";
  const handle = await createDatabase({ dataDir: process.env.ARIA_DATA_DIR });
  await runMigrations(handle);
  await handle.close();
  app = await buildServer();
  await app.ready();
  const register = async (email: string) => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Search tester",
        email,
        password: "correct-horse-battery",
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      id: r.json().user.id as string,
    };
  };
  const a = await register("search-owner@fixture.test"),
    b = await register("search-other@fixture.test");
  cookie = a.cookie;
  owner = a.id;
  other = b.id;
  const [wa, wb] = await app.database.db
    .insert(workspaces)
    .values([
      { name: "Search main", slug: `search-${randomUUID()}`, planId: "pro" },
      {
        name: "Private workspace",
        slug: `search-other-${randomUUID()}`,
        planId: "pro",
      },
    ])
    .returning();
  workspace = wa.id;
  otherWorkspace = wb.id;
  await app.database.db.insert(workspaceMembers).values([
    { userId: owner, workspaceId: workspace, role: "owner", status: "active" },
    {
      userId: owner,
      workspaceId: otherWorkspace,
      role: "owner",
      status: "active",
    },
    { userId: other, workspaceId: workspace, role: "viewer", status: "active" },
  ]);
  const [account, mastodon] = await app.database.db
    .insert(socialAccounts)
    .values([
      {
        workspaceId: workspace,
        providerId: "facebook",
        externalAccountId: "111122223333",
        displayName: "Space Own Page",
        handle: "facebook.com/profile.php?id=111122223333",
        connection: "healthy",
      },
      {
        workspaceId: workspace,
        providerId: "mastodon",
        externalAccountId: "12",
        displayName: "Space Masto",
        handle: "space@social.example",
        instanceUrl: "https://social.example",
        connection: "healthy",
        scopes: ["read:search", "read:statuses"],
      },
    ])
    .returning();
  await app.database.db.insert(oauthCredentials).values({
    accountId: mastodon.id,
    accessTokenEnc: encryptSecret(fixtureToken),
    scopes: ["read:search", "read:statuses"],
  });
  async function cached(
    user: string,
    ws: string,
    name: string,
    expired = false,
    enabled = true,
  ) {
    const [source] = await app.database.db
      .insert(feedSources)
      .values({
        userId: user,
        workspaceId: ws,
        provider: "facebook",
        kind: "url",
        label: name,
        sourceKey: randomUUID(),
        config: { url: "https://www.facebook.com/111122223333/posts/999" },
        enabled,
        topics: ["Technology"],
      })
      .returning();
    const content: UniversalFeedItem = {
      id: "",
      sourceId: source.id,
      sourceType: "url",
      topics: ["Technology"],
      provider: "facebook",
      providerPostId: name,
      authorId: account.externalAccountId,
      authorName: name,
      authorAvatarUrl: `https://cdn.fixture.test/${name.replaceAll(" ", "-")}.jpg`,
      caption: "Space local launch",
      images: [],
      originalUrl: "https://www.facebook.com/111122223333/posts/999",
      publishedAt: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      canEmbed: false,
      availability: "available",
      sensitive: false,
      contentType: "text",
    };
    await app.database.db.insert(feedItems).values({
      sourceId: source.id,
      providerPostId: name,
      content,
      expiresAt: expired ? new Date(0) : new Date(Date.now() + 3600000),
    });
  }
  await cached(owner, workspace, "Space Own Cache");
  await cached(other, workspace, "Space OtherUserOnly");
  await cached(owner, otherWorkspace, "Space OtherWorkspaceOnly");
  await cached(owner, workspace, "Space ExpiredOnly", true);
  await cached(owner, workspace, "Space DisabledOnly", false, false);
}, 120000);
beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "social.example") {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${fixtureToken}`,
        );
        return json({
          accounts: [
            {
              id: "12",
              acct: "space",
              display_name: "Space Mastodon Public",
              url: "https://social.example/@space",
            },
          ],
          statuses: [],
          hashtags: [],
        });
      }
      if (url.hostname.includes("bsky")) {
        if (url.searchParams.get("q")?.startsWith("Space local"))
          return json({}, 429, { "retry-after": "120" });
        return url.pathname.includes("searchActors")
          ? json({
              actors: [
                {
                  did: "did:plc:search",
                  handle: "space.bsky.social",
                  displayName: "Space Public Creator",
                },
                {
                  did: "did:plc:hidden",
                  handle: "hidden.bsky.social",
                  labels: [{ val: "!hide" }],
                },
              ],
            })
          : json({ posts: [publicPost] });
      }
      throw Error("Unexpected search fixture host");
    });
});
afterEach(() => fetchSpy.mockRestore());
afterAll(async () => {
  await app?.close();
});

describe("workspace-scoped federated search", () => {
  it("combines real adapter results with only this user's accessible collected content", async () => {
    const r = await search("Space");
    expect(r.statusCode, r.body).toBe(200);
    const data = r.json<UniversalSearchResponse>();
    expect(data.people.some((p) => p.name === "Space Public Creator")).toBe(
      true,
    );
    expect(data.people.some((p) => p.origin === "connected")).toBe(true);
    expect(
      data.people.find((p) => p.name === "Space Own Page")?.avatarUrl,
    ).toBe("https://cdn.fixture.test/Space-Own-Cache.jpg");
    expect(
      data.posts.some((p) => p.item.authorName === "Space Own Cache"),
    ).toBe(true);
    expect(data.posts.some((p) => p.origin === "live")).toBe(true);
    for (const marker of [
      "OtherUserOnly",
      "OtherWorkspaceOnly",
      "ExpiredOnly",
      "DisabledOnly",
      fixtureToken,
      "search-owner@fixture.test",
    ])
      expect(r.body).not.toContain(marker);
    expect(data.coverage).toHaveLength(10);
    expect(data.coverage.find((c) => c.provider === "youtube")?.status).toBe(
      "setup_required",
    );
    expect(data.coverage.find((c) => c.provider === "x")?.mode).toBe(
      "external",
    );
    expect(
      await app.database.db
        .select()
        .from(feedSources)
        .where(eq(feedSources.kind, "search")),
    ).toEqual([]);
  });
  it("requires authentication and rechecks revoked membership before using cached search data", async () => {
    expect((await search("Space", workspace, "", "127.0.0.2")).statusCode).toBe(
      401,
    );
    const first = await search("Space", otherWorkspace, cookie, "127.0.0.2");
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain("OtherWorkspaceOnly");
    await app.database.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, otherWorkspace),
          eq(workspaceMembers.userId, owner),
        ),
      );
    const before = fetchSpy.mock.calls.length;
    expect(
      (await search("Space", otherWorkspace, cookie, "127.0.0.2")).statusCode,
    ).toBe(404);
    expect(fetchSpy.mock.calls).toHaveLength(before);
  });
  it("rejects malformed queries before any provider request", async () => {
    for (const payload of [
      { query: "a" },
      { query: "x".repeat(121) },
      { query: "a\u0000b" },
      { query: "a\ud800b" },
      { query: "Space", instance: "https://127.0.0.1" },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspace}/feed/search/all`,
        headers: { cookie },
        payload,
        remoteAddress: "127.0.0.3",
      });
      expect(r.statusCode, r.body).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps local results during upstream failure and honors Retry-After across different queries", async () => {
    const first = await search("Space local", workspace, cookie, "127.0.0.4");
    expect(first.statusCode).toBe(200);
    const data = first.json<UniversalSearchResponse>();
    expect(
      data.posts.some((p) => p.item.authorName === "Space Own Cache"),
    ).toBe(true);
    expect(data.coverage.find((c) => c.provider === "bluesky")?.status).toBe(
      "rate_limited",
    );
    const calls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("bsky"),
    ).length;
    const retry = await search(
      "Space local again",
      workspace,
      cookie,
      "127.0.0.4",
    );
    expect(retry.statusCode).toBe(200);
    expect(
      retry
        .json<UniversalSearchResponse>()
        .coverage.find((c) => c.provider === "bluesky")?.retryAfterSec,
    ).toBeGreaterThan(0);
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("bsky")),
    ).toHaveLength(calls);
  });
});
