import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FEED_PREFERENCES,
  isOfficialFeedEmbed,
  isOfficialBlueskyVideo,
  isOfficialFeedPlayback,
  mixFeed,
  type UniversalFeedItem,
} from "@aria/shared-types";
import {
  canonicalFeedUrl,
  feedCapabilities,
  retrieveFeed,
  validateFeedSource,
  type FeedContext,
} from "../src/feed/index.js";
import { fetchJson } from "../src/http.js";

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers });
const post = (n = 1) => ({
  uri: `at://did:plc:creator/app.bsky.feed.post/key${n}`,
  author: {
    did: "did:plc:creator",
    handle: "creator.bsky.social",
    displayName: "Creator",
    avatar: "https://cdn.bsky.app/avatar.jpg",
  },
  record: { text: `Public idea ${n}`, createdAt: "2026-10-28T12:00:00Z" },
  likeCount: 0,
  replyCount: undefined,
  embed: {
    $type: "app.bsky.embed.video#view",
    playlist:
      "https://video.bsky.app/watch/did%3Aplc%3Acreator/fixturevideo/playlist.m3u8",
    thumbnail: "https://video.bsky.app/thumb.jpg",
  },
});
const account = {
  externalAccountId: "17841412345678",
  displayName: "Owner",
  handle: "owner",
  scopes: [],
};
beforeEach(() => {
  vi.stubEnv("ARIA_ALLOW_PRIVATE_INSTANCES", "true");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("YOUTUBE_DATA_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());
describe("real feed adapters and safe metadata", () => {
  it("accepts only provider-owned progressive Facebook media without Graph credentials", () => {
    expect(
      isOfficialFeedPlayback(
        "facebook",
        "https://video.xx.fbcdn.net/media/clip.mp4?oh=signature&oe=1234567890",
      ),
    ).toBe(true);
    for (const url of [
      "http://video.xx.fbcdn.net/clip.mp4",
      "https://video.xx.fbcdn.net.evil.example/clip.mp4",
      "https://127.0.0.1/clip.mp4",
      "https://video.xx.fbcdn.net/clip.jpg",
      "https://video.xx.fbcdn.net/clip.mp4?access_token=private",
      "https://user:secret@video.xx.fbcdn.net/clip.mp4",
    ])
      expect(isOfficialFeedPlayback("facebook", url)).toBe(false);
    expect(
      isOfficialFeedPlayback(
        "instagram",
        "https://video.xx.fbcdn.net/clip.mp4",
      ),
    ).toBe(false);
  });
  it("exposes only the public Bluesky playlist belonging to the post's author", async () => {
    const p = post();
    const result = await retrieveFeed({
      provider: "bluesky",
      kind: "public",
      config: {},
      fetchImpl: async () =>
        json({
          feed: [
            { post: p },
            {
              post: {
                ...post(2),
                embed: {
                  ...p.embed,
                  playlist:
                    "https://video.bsky.app/watch/did%3Aplc%3Aanother/fixturevideo/playlist.m3u8",
                },
              },
            },
          ],
        }),
    });
    expect(result[0].playbackUrl).toBe(p.embed.playlist);
    expect(result[1].playbackUrl).toBeUndefined();
    for (const url of [
      "https://evil.example/playlist.m3u8",
      "https://video.bsky.app.evil.example/watch/did%3Aplc%3Acreator/fixturevideo/playlist.m3u8",
      "https://video.bsky.app/watch/did%3Aplc%3Acreator/fixturevideo/playlist.m3u8?token=private",
      "http://video.bsky.app/watch/did%3Aplc%3Acreator/fixturevideo/playlist.m3u8",
    ])
      expect(isOfficialBlueskyVideo(url)).toBe(false);
  });
  it("keeps Facebook photos, album images, link previews and video embeds from authorized Page metadata", async () => {
    const call = vi.fn(async (_url: string) =>
      json({
        data: [
          {
            id: "1",
            message: "Photo",
            permalink_url: "https://www.facebook.com/owner/posts/1",
            full_picture: "https://cdn.example/photo.jpg",
          },
          {
            id: "2",
            message: "Album",
            permalink_url: "https://www.facebook.com/owner/posts/2",
            attachments: {
              data: [
                {
                  media_type: "album",
                  subattachments: {
                    data: [
                      {
                        media: { image: { src: "https://cdn.example/a.jpg" } },
                      },
                      {
                        media: { image: { src: "https://cdn.example/b.jpg" } },
                      },
                      { media: { image: { src: "http://127.0.0.1/private" } } },
                    ],
                  },
                },
              ],
            },
          },
          {
            id: "3",
            permalink_url: "https://www.facebook.com/reel/123456789/",
            full_picture: "https://cdn.example/video.jpg",
            attachments: {
              data: [
                {
                  media_type: "video",
                  type: "video_inline",
                  media: {
                    source:
                      "https://video.xx.fbcdn.net/media/clip.mp4?oh=signature&oe=1234567890",
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    const rows = await retrieveFeed({
      provider: "facebook",
      kind: "account",
      config: {},
      account,
      accessToken: "fixture",
      fetchImpl: call,
    });
    expect(rows[0].images).toEqual([{ url: "https://cdn.example/photo.jpg" }]);
    expect(rows[1].contentType).toBe("carousel");
    expect(rows[1].images).toHaveLength(2);
    expect(rows[2].contentType).toBe("video");
    expect(isOfficialFeedPlayback("facebook", rows[2].playbackUrl)).toBe(true);
    expect(isOfficialFeedEmbed("facebook", rows[2].embedUrl)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("fixture");
    expect(String(call.mock.calls[0]?.[0])).toContain("attachments");
  });
  it.each([
    "!hide",
    "!warn",
    "!no-unauthenticated",
    "porn",
    "sexual",
    "graphic-media",
  ])(
    "never exposes restricted Bluesky label %s through public display paths",
    async (label) => {
      const result = await retrieveFeed({
        provider: "bluesky",
        kind: "public",
        config: validateFeedSource("bluesky", "public", {}),
        fetchImpl: async () =>
          json({ feed: [{ post: { ...post(), labels: [{ val: label }] } }] }),
      });
      expect(result).toEqual([]);
    },
  );
  it("honors author/self labels, ignores negated labels and keeps nudity behind the explicit sensitive preference", async () => {
    const rows = [
      { ...post(1), author: { ...post().author, labels: [{ val: "!hide" }] } },
      {
        ...post(2),
        record: { ...post().record, labels: { values: [{ val: "porn" }] } },
      },
      { ...post(3), labels: [{ val: "!hide", neg: true }] },
      { ...post(4), labels: [{ val: "nudity" }] },
      { ...post(5), labels: [{ val: "!hide", exp: "invalid" }] },
    ];
    const result = await retrieveFeed({
      provider: "bluesky",
      kind: "public",
      config: validateFeedSource("bluesky", "public", {}),
      fetchImpl: async () => json({ feed: rows.map((post) => ({ post })) }),
    });
    expect(result.map((item) => item.providerPostId.split("/").at(-1))).toEqual(
      ["key3", "key4"],
    );
    expect(result[1].sensitive).toBe(true);
    expect(
      mixFeed(
        result.map((item, i) => ({
          ...item,
          id: String(i),
          sourceId: "source",
          sourceType: "public",
          topics: [],
        })),
        "s",
        DEFAULT_FEED_PREFERENCES,
        Date.now(),
      ),
    ).toHaveLength(1);
  });
  it("normalizes public Bluesky data, preserves unavailable metrics and uses the official embed route", async () => {
    const call = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return json({ feed: [{ post: post() }, { post: { notFound: true } }] });
    });
    const [item] = await retrieveFeed({
      provider: "bluesky",
      kind: "public",
      config: validateFeedSource("bluesky", "public", {}),
      fetchImpl: call,
    });
    expect(item.contentType).toBe("video");
    expect(item.likeCount).toBe(0);
    expect(item.commentCount).toBeNull();
    expect(item.publishedAt).toBe("2026-10-28T12:00:00.000Z");
    expect(item.embedUrl).toBe(
      "https://embed.bsky.app/embed/did:plc:creator/app.bsky.feed.post/key1",
    );
    expect(isOfficialFeedEmbed("bluesky", item.embedUrl)).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("uses the actual author feed for My Accounts and authorized PDS only for native following", async () => {
    const call = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("getTimeline")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer fixture",
        );
        expect(new Headers(init?.headers).get("atproto-proxy")).toBe(
          "did:web:api.bsky.app#bsky_appview",
        );
      }
      return json({ feed: [{ post: post() }] });
    });
    await retrieveFeed({
      provider: "bluesky",
      kind: "account",
      config: {},
      account: { ...account, externalAccountId: "did:plc:creator" },
      accessToken: "fixture",
      fetchImpl: call,
    });
    expect(call.mock.calls[0][0]).toContain(
      "getAuthorFeed?limit=50&actor=did%3Aplc%3Acreator",
    );
    await retrieveFeed({
      provider: "bluesky",
      kind: "timeline",
      config: {},
      account: { ...account, instanceUrl: "https://pds.example" },
      accessToken: "fixture",
      fetchImpl: call,
    });
    expect(call.mock.calls[1][0]).toContain(
      "https://pds.example/xrpc/app.bsky.feed.getTimeline",
    );
  });
  it("drops private Mastodon content and replies; turns public HTML into text without rehosting videos", async () => {
    const raw = {
      id: "20",
      visibility: "public",
      url: "https://social.example/@one/20",
      account: { id: "7", display_name: "One", acct: "one" },
      content: "<p>Hello &amp; welcome</p><script>bad()</script>",
      created_at: "2026-10-28T12:00:00Z",
      media_attachments: [
        {
          type: "video",
          url: "https://cdn.example/protected.mp4",
          preview_url: "https://cdn.example/preview.jpg",
        },
      ],
    };
    const data = await retrieveFeed({
      provider: "mastodon",
      kind: "public",
      config: { instance: "https://social.example" },
      fetchImpl: async () =>
        json([
          raw,
          { ...raw, id: "21", visibility: "private" },
          { ...raw, id: "22", visibility: "direct" },
          { ...raw, id: "23", in_reply_to_id: "19" },
        ]),
    });
    expect(data).toHaveLength(1);
    expect(data[0].caption).toBe("Hello & welcome");
    expect(data[0].canEmbed).toBe(false);
    expect(JSON.stringify(data)).not.toContain("protected.mp4");
    expect(data[0].providerPostId).toBe("https://social.example:20");
  });
  it("never forwards a Mastodon token to another instance", async () => {
    const fetchImpl = vi.fn();
    await expect(
      retrieveFeed({
        provider: "mastodon",
        kind: "public",
        config: { instance: "https://other.example" },
        account: { ...account, instanceUrl: "https://private.example" },
        accessToken: "fixture",
        fetchImpl,
      }),
    ).rejects.toThrow("another instance");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses Data API search/details, accepts only public embeddable YouTube videos and does not infer Shorts", async () => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "fixture-key");
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/search?")
        ? json({
            items: [
              { id: { videoId: "abcdefghijk" } },
              { id: { videoId: "private1234" } },
            ],
          })
        : json({
            items: [
              {
                id: "abcdefghijk",
                snippet: {
                  channelId: "UC1234567890123456789012",
                  channelTitle: "Channel",
                  title: "A video",
                  publishedAt: "2026-10-28T12:00:00Z",
                },
                status: { privacyStatus: "public", embeddable: true },
                statistics: { likeCount: "", commentCount: 0 },
                contentDetails: { duration: "PT20S" },
              },
              {
                id: "private1234",
                snippet: {},
                status: { privacyStatus: "private", embeddable: true },
              },
            ],
          }),
    );
    const result = await retrieveFeed({
      provider: "youtube",
      kind: "search",
      config: { query: "education" },
      fetchImpl,
    });
    expect(result).toHaveLength(1);
    expect(result[0].contentType).toBe("video");
    expect(result[0].likeCount).toBeNull();
    expect(result[0].commentCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("Short");
    expect(fetchImpl.mock.calls[0][0]).toContain("videoEmbeddable=true");
  });
  it("public YouTube and TikTok URLs use official oEmbed metadata and discard untrusted HTML", async () => {
    for (const provider of ["youtube", "tiktok"] as const) {
      const url =
        provider === "youtube"
          ? "https://youtu.be/abcdefghijk"
          : "https://www.tiktok.com/@creator/video/6718335390845095173";
      const [item] = await retrieveFeed({
        provider,
        kind: "url",
        config: { url },
        fetchImpl: async () =>
          json({
            author_name: "Creator",
            author_url: `https://${provider}.com/creator`,
            title: "Video",
            html: '<iframe src="https://evil.example"></iframe>',
            thumbnail_url: "javascript:alert(1)",
          }),
      });
      expect(isOfficialFeedEmbed(provider, item.embedUrl)).toBe(true);
      expect(item.thumbnailUrl).toBeUndefined();
      expect(item.publishedAt).toBeNull();
      expect(item.likeCount).toBeNull();
      expect(JSON.stringify(item)).not.toContain("evil.example");
    }
  });
  it("supports scope-gated TikTok Display API and never claims a For You algorithm", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        data: {
          videos: [
            {
              id: "6718335390845095173",
              title: "Creator video",
              share_url:
                "https://www.tiktok.com/@owner/video/6718335390845095173",
              create_time: 1793188800,
            },
          ],
        },
        error: { code: "ok" },
      }),
    );
    const ctx: FeedContext = {
      provider: "tiktok",
      kind: "account",
      config: {},
      account,
      accessToken: "fixture",
      fetchImpl,
    };
    await expect(retrieveFeed(ctx)).rejects.toThrow("video.list");
    expect(fetchImpl).not.toHaveBeenCalled();
    const result = await retrieveFeed({
      ...ctx,
      account: { ...account, scopes: ["video.list"] },
    });
    expect(result).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("/v2/video/list/");
    expect(result[0].canEmbed).toBe(true);
  });
  it.each(["facebook", "instagram", "threads"] as const)(
    "fetches the authorized %s profile photo once for the whole post batch",
    async (provider) => {
      const avatar = "https://scontent.fixture.fbcdn.net/profile.jpg?oe=123";
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(account.externalAccountId)) {
          expect(url.searchParams.get("fields")).toBe(
            provider === "facebook"
              ? "picture.width(96).height(96)"
              : provider === "instagram"
                ? "profile_picture_url"
                : "threads_profile_picture_url",
          );
          return json(
            provider === "facebook"
              ? { picture: { data: { url: avatar, is_silhouette: false } } }
              : provider === "instagram"
                ? { profile_picture_url: avatar }
                : { threads_profile_picture_url: avatar },
          );
        }
        return json({
          data: [1, 2].map((n) => ({
            id: String(n),
            permalink_url: `https://www.facebook.com/owner/posts/${n}`,
            permalink:
              provider === "instagram"
                ? `https://www.instagram.com/p/ABC${n}/`
                : `https://www.threads.com/@owner/post/ABC${n}`,
          })),
        });
      });
      const result = await retrieveFeed({
        provider,
        kind: "account",
        config: {},
        account,
        accessToken: "fixture",
        fetchImpl,
      });
      expect(result).toHaveLength(2);
      expect(result.every((item) => item.authorAvatarUrl === avatar)).toBe(
        true,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );
  it("keeps Facebook posts when the profile photo is unavailable or unsafe", async () => {
    for (const profile of [
      null,
      {
        picture: {
          data: {
            url: "https://scontent.fixture.fbcdn.net/silhouette.jpg",
            is_silhouette: true,
          },
        },
      },
      {
        picture: {
          data: {
            url: "https://graph.facebook.com/picture?access_token=private",
          },
        },
      },
      {
        picture: {
          data: {
            url: "https://graph.facebook.com/picture?appsecret_proof=private",
          },
        },
      },
      { picture: { data: { url: "javascript:alert(1)" } } },
    ]) {
      const rows = await retrieveFeed({
        provider: "facebook",
        kind: "account",
        config: {},
        account,
        accessToken: "fixture",
        fetchImpl: async (input) => {
          if (
            new URL(String(input)).pathname.endsWith(account.externalAccountId)
          )
            return json(
              profile || { error: { message: "Profile unavailable" } },
              profile ? 200 : 503,
            );
          return json({
            data: [
              {
                id: "123",
                message: "Available post",
                permalink_url: "https://www.facebook.com/owner/posts/123",
              },
            ],
          });
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].caption).toBe("Available post");
      expect(rows[0].authorAvatarUrl).toBeUndefined();
    }
  });
  it.each(["facebook", "instagram", "threads"] as const)(
    "retrieves only authorized %s account metadata and never video streams",
    async (provider) => {
      const result = await retrieveFeed({
        provider,
        kind: "account",
        config: {},
        account,
        accessToken: "fixture",
        fetchImpl: async () =>
          json({
            data: [
              {
                id: "123",
                message: "Text",
                caption: "Caption",
                text: "Thread",
                media_type: "VIDEO",
                media_url: "https://cdn.example/movie.mp4",
                thumbnail_url: "https://cdn.example/preview.jpg",
                permalink_url: "https://www.facebook.com/owner/posts/123",
                permalink:
                  provider === "instagram"
                    ? "https://www.instagram.com/p/ABC123/"
                    : "https://www.threads.com/@owner/post/ABC123",
                timestamp: "2026-10-28T12:00:00Z",
              },
            ],
          }),
      });
      expect(result).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("movie.mp4");
      expect(result[0].canEmbed).toBe(false);
    },
  );
  it("gates unimplemented API discovery while retaining honest public link references", async () => {
    await expect(
      retrieveFeed({
        provider: "linkedin",
        kind: "account",
        config: {},
        account,
        accessToken: "fixture",
      }),
    ).rejects.toThrow("not have an enabled");
    const call = vi.fn();
    const [reference] = await retrieveFeed({
      provider: "x",
      kind: "url",
      config: { url: "https://x.com/creator/status/123456789" },
      fetchImpl: call,
    });
    expect(call).not.toHaveBeenCalled();
    expect(reference.availability).toBe("preview_only");
    expect(reference.canEmbed).toBe(false);
    expect(feedCapabilities()).toHaveLength(10);
  });
  it("bounds streamed metadata responses", async () => {
    await expect(
      fetchJson("fixture", "https://example.com", {
        fetchImpl: async () => json({ text: "x".repeat(5000) }),
        maxResponseBytes: 100,
      }),
    ).rejects.toThrow("size limit");
  });
});
describe("URLs and official players", () => {
  it.each([
    "http://www.youtube.com/watch?v=abcdefghijk",
    "https://www.youtube.com.evil.example/watch?v=abcdefghijk",
    "https://user:pass@youtube.com/watch?v=abcdefghijk",
    "javascript:alert(1)",
    "https://www.youtube.com:444/watch?v=abcdefghijk",
  ])("rejects unsafe video URL %s", (url) =>
    expect(() => canonicalFeedUrl("youtube", url)).toThrow(),
  );
  it("rejects private instances even with credentials in the URL", () => {
    expect(() =>
      validateFeedSource("mastodon", "public", {
        instance: "https://user:pass@social.example",
      }),
    ).toThrow();
    expect(
      isOfficialFeedEmbed(
        "youtube",
        "https://www.youtube-nocookie.com.evil.example/embed/abcdefghijk",
      ),
    ).toBe(false);
    expect(
      isOfficialFeedEmbed(
        "bluesky",
        "https://embed.bsky.app/embed/../../../private",
      ),
    ).toBe(false);
    expect(
      isOfficialFeedEmbed("instagram", "https://evil.example/p/123/embed"),
    ).toBe(false);
  });
});
function item(
  n: number,
  provider: UniversalFeedItem["provider"],
): UniversalFeedItem {
  return {
    id: `${provider}-${n}`,
    provider,
    providerPostId: `p${n}`,
    authorId: `author${n % 3}`,
    authorName: "Creator",
    contentType: "text",
    caption: "Idea",
    images: [],
    originalUrl: "https://example.com/post",
    publishedAt: "2026-10-28T12:00:00Z",
    likeCount: null,
    commentCount: null,
    shareCount: null,
    sourceId: `source-${provider}`,
    sourceType: "public",
    topics: ["Technology"],
    canEmbed: false,
    availability: "available",
    sensitive: false,
  };
}
describe("stable cross-platform mixer", () => {
  const pool = Array.from({ length: 18 }, (_, i) =>
    item(i, i % 2 ? "bluesky" : "youtube"),
  );
  it("freezes a seeded order, changes across seeds and deduplicates native posts", () => {
    const prefs = structuredClone(DEFAULT_FEED_PREFERENCES),
      now = Date.now();
    const a = mixFeed([...pool, pool[0]], "seed", prefs, now),
      b = mixFeed(pool, "seed", prefs, now);
    expect(a).toEqual(b);
    expect(a).toHaveLength(18);
    expect(mixFeed(pool, "other", prefs, now)).not.toEqual(a);
    expect(
      new Set(a.map((i) => `${i.provider}:${i.providerPostId}`)).size,
    ).toBe(18);
    for (let i = 1; i < a.length; i++)
      expect(a[i].provider).not.toBe(a[i - 1].provider);
  });
  it("does not invent providers and respects muted/sensitive/unavailable content", () => {
    const prefs = {
      ...DEFAULT_FEED_PREFERENCES,
      mutedSourceIds: ["source-youtube"],
    };
    const a = mixFeed(
      [
        ...pool,
        { ...item(99, "bluesky"), sensitive: true },
        { ...item(100, "bluesky"), availability: "unavailable" },
      ],
      "s",
      prefs,
      Date.now(),
    );
    expect(a).toHaveLength(9);
    expect(a.every((i) => i.provider === "bluesky")).toBe(true);
  });
});
