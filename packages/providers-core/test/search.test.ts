import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchNetwork } from "../src/feed/search.js";
import { platformSearchUrl, type ProviderId } from "@aria/shared-types";
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });
const post = {
  uri: "at://did:plc:space/app.bsky.feed.post/one",
  author: {
    did: "did:plc:space",
    handle: "space.bsky.social",
    displayName: "Space Agency",
  },
  record: { text: "Space launch", createdAt: "2026-10-29T00:00:00Z" },
};
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ARIA_ALLOW_PRIVATE_INSTANCES", "true");
  vi.stubEnv("YOUTUBE_DATA_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());
describe("universal people and content search", () => {
  it("uses official actor/post searches, preserves real metadata and omits restricted profiles", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return url.includes("searchActors")
        ? json({
            actors: [
              {
                did: "did:plc:space",
                handle: "space.bsky.social",
                displayName: "Space Agency",
                avatar: "javascript:alert(1)",
                description: "Public profile",
              },
              {
                did: "did:plc:hidden",
                handle: "hidden.bsky.social",
                labels: [{ val: "!no-unauthenticated" }],
              },
              {
                did: "did:plc:negated",
                handle: "safe.bsky.social",
                labels: [{ val: "!hide", neg: true }],
              },
            ],
          })
        : json({
            posts: [
              post,
              {
                ...post,
                uri: "at://did:plc:space/app.bsky.feed.post/restricted",
                labels: [{ val: "porn" }],
              },
            ],
          });
    });
    const result = await searchNetwork(
      { provider: "bluesky", kind: "search", config: {}, fetchImpl },
      "@space & launch",
    );
    expect(result.people.map((p) => p.id)).toEqual([
      "did:plc:space",
      "did:plc:negated",
    ]);
    expect(result.people[0].avatarUrl).toBeUndefined();
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].likeCount).toBeNull();
    expect(result.people[0].creator?.actor).toBe("did:plc:space");
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("q")).toBe(
      "space & launch",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("retains available content when profile search fails and exposes backoff for a partial rate limit", async () => {
    const result = await searchNetwork(
      {
        provider: "bluesky",
        kind: "search",
        config: {},
        fetchImpl: async (url) =>
          url.includes("searchActors")
            ? json({}, 429, { "retry-after": "120" })
            : json({ posts: [post] }),
      },
      "space",
    );
    expect(result.people).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.retryAfterSec).toBe(120);
  });
  it("searches Mastodon's index without resolution and omits private posts and opted-out accounts", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const target = new URL(url);
      expect(target.pathname).toBe("/api/v2/search");
      expect(target.searchParams.has("resolve")).toBe(false);
      expect(target.searchParams.has("offset")).toBe(false);
      expect(
        (init?.headers as Record<string, string>).Authorization,
      ).toBeUndefined();
      return json({
        accounts: [
          {
            id: "12",
            acct: "space",
            display_name: "Space Agency",
            note: "<p>Space news</p>",
            url: "https://social.example/@space",
          },
          {
            id: "13",
            acct: "hidden",
            noindex: true,
            url: "https://social.example/@hidden",
          },
        ],
        statuses: [
          {
            id: "14",
            visibility: "private",
            url: "https://social.example/@space/14",
            content: "private",
            account: { id: "12", acct: "space" },
          },
          {
            id: "15",
            visibility: "public",
            url: "https://social.example/@space/15",
            content: "<p>Public space news</p>",
            account: { id: "12", acct: "space" },
          },
        ],
        hashtags: [{ name: "space", url: "https://social.example/tags/space" }],
      });
    });
    const result = await searchNetwork(
      {
        provider: "mastodon",
        kind: "search",
        config: { instance: "https://social.example" },
        fetchImpl,
      },
      "space",
    );
    expect(result.people).toHaveLength(1);
    expect(result.people[0].description).toBe("Space news");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].caption).toBe("Public space news");
    expect(result.topics).toHaveLength(1);
  });
  it("never forwards Mastodon credentials to a different server", async () => {
    const fetchImpl = vi.fn();
    await expect(
      searchNetwork(
        {
          provider: "mastodon",
          kind: "search",
          config: { instance: "https://other.example" },
          account: {
            externalAccountId: "1",
            displayName: "Owner",
            handle: "owner",
            scopes: ["read"],
            instanceUrl: "https://home.example",
          },
          accessToken: "fixture-private-token",
          fetchImpl,
        },
        "space",
      ),
    ).rejects.toThrow("do not belong");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not make a YouTube search call without configured access", async () => {
    const fetchImpl = vi.fn();
    await expect(
      searchNetwork(
        { provider: "youtube", kind: "search", config: {}, fetchImpl },
        "space",
      ),
    ).rejects.toThrow("API key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("returns real channels and only public, embeddable YouTube videos without exposing its key", async () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "fixture-search-key");
    const channel = "UC1234567890123456789012";
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/videos"))
        return json({
          items: [
            {
              id: "abcdefghijk",
              snippet: {
                channelId: channel,
                channelTitle: "Space Agency",
                title: "Launch",
              },
              status: { privacyStatus: "public", embeddable: true },
            },
            {
              id: "bcdefghijkl",
              snippet: {},
              status: { privacyStatus: "private", embeddable: true },
            },
          ],
        });
      return u.searchParams.get("type") === "channel"
        ? json({
            items: [
              {
                id: { channelId: channel },
                snippet: { title: "Space Agency", description: "Space videos" },
              },
            ],
          })
        : json({
            items: [
              { id: { videoId: "abcdefghijk" } },
              { id: { videoId: "bcdefghijkl" } },
            ],
          });
    });
    const result = await searchNetwork(
      { provider: "youtube", kind: "search", config: {}, fetchImpl },
      "space",
    );
    expect(result.people[0].creator?.actor).toBe(channel);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].canEmbed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-search-key");
  });
  it("constructs fixed, encoded external searches for every platform", () => {
    const ids: ProviderId[] = [
      "facebook",
      "instagram",
      "threads",
      "tiktok",
      "youtube",
      "x",
      "linkedin",
      "pinterest",
      "bluesky",
      "mastodon",
    ];
    for (const provider of ids) {
      const url = new URL(platformSearchUrl(provider, "@name & #topic /?"));
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.hash).toBe("");
      expect([...url.searchParams.values()]).toContain("@name & #topic /?");
    }
  });
});
