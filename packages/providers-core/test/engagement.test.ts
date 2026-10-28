import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engagementCapabilities,
  getEngagementAdapter,
  buildAuthorizeUrl,
  grantedMetaInboxScopes,
  type EngagementAccount,
  type EngagementContext,
  type EngagementEvent,
} from "../src/index.js";
const account: EngagementAccount = {
  id: "a",
  workspaceId: "w",
  provider: "bluesky",
  externalAccountId: "did:plc:self",
  displayName: "Self",
  handle: "self.test",
  connection: "healthy",
  scopes: ["app password"],
  instanceUrl: "http://127.0.0.1:4182",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const event: EngagementEvent = {
  externalId: "incoming",
  type: "reply",
  sender: { id: "other", name: "Other" },
  text: "Hello",
  occurredAt: "2026-10-28T00:00:00Z",
  replyAllowed: true,
  replyContext: {
    uri: "at://did:plc:other/app.bsky.feed.post/reply",
    cid: "parent-cid",
    rootUri: "at://did:plc:self/app.bsky.feed.post/root",
    rootCid: "root-cid",
  },
};
afterEach(() => vi.unstubAllEnvs());
function context(
  provider: EngagementAccount["provider"],
  fetchImpl: EngagementContext["fetchImpl"],
) {
  vi.stubEnv("ARIA_ALLOW_PRIVATE_INSTANCES", "true");
  return {
    account: { ...account, provider },
    accessToken: "fixture-only",
    fetchImpl,
  };
}
describe("social engagement protocols", () => {
  it("gates reading and replying on actual scopes, independently of publishing", () => {
    const cap = engagementCapabilities({
      ...account,
      provider: "youtube",
      scopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ],
    });
    expect(cap.status).toBe("available");
    expect(cap.replyTypes).toEqual([]);
    expect(cap.missingReplyScopes).toContain(
      "https://www.googleapis.com/auth/youtube.force-ssl",
    );
    expect(
      engagementCapabilities({
        ...account,
        provider: "mastodon",
        scopes: ["read", "write:statuses"],
      }).replyTypes,
    ).toContain("direct_message");
    expect(
      engagementCapabilities({ ...account, connection: "needs_reauth" })
        .replyTypes,
    ).toEqual([]);
    for (const p of [
      "threads",
      "linkedin",
      "tiktok",
      "x",
      "pinterest",
    ] as const)
      expect(getEngagementAdapter(p)).toBeNull();
  });
  it("adds inbox OAuth permissions only when explicitly requested", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
    const publishing = new URL((await buildAuthorizeUrl("youtube")).url),
      inbox = new URL(
        (await buildAuthorizeUrl("youtube", { access: "inbox" })).url,
      );
    expect(publishing.searchParams.get("scope")).not.toContain(
      "youtube.force-ssl",
    );
    expect(inbox.searchParams.get("scope")).toContain("youtube.force-ssl");
  });
  it("normalizes Bluesky events with stable IDs and preserves root/parent references", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        notifications: [
          {
            uri: event.replyContext.uri,
            cid: "parent-cid",
            reason: "reply",
            author: { did: "did:plc:other", handle: "other.test" },
            record: {
              text: "Hello",
              reply: {
                root: { uri: event.replyContext.rootUri, cid: "root-cid" },
              },
            },
            indexedAt: event.occurredAt,
          },
        ],
      }),
    );
    const result = await getEngagementAdapter("bluesky")!.syncEvents(
      context("bluesky", fetchImpl),
      {},
    );
    expect(result.events[0].externalId).toBe(`reply:${event.replyContext.uri}`);
    expect(result.events[0].replyContext.rootCid).toBe("root-cid");
    expect(result.cursor.after).toBe(event.occurredAt);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toContain(
      "listNotifications",
    );
  });
  it("uses a deterministic Bluesky record key for retries and keeps threading", async () => {
    const requests: RequestInit[] = [];
    const ctx = context("bluesky", async (_url, init) => {
      requests.push(init!);
      return json({
        uri: "at://did:plc:self/app.bsky.feed.post/confirmed",
        cid: "confirmed",
      });
    });
    const input = {
      event,
      actionId: "33b38ef9-dce8-4ca8-937a-07bf7d66ddab",
      text: "Reply",
      createdAt: event.occurredAt,
    };
    await getEngagementAdapter("bluesky")!.sendReply(ctx, input);
    await getEngagementAdapter("bluesky")!.sendReply(ctx, input);
    expect(requests[0].body).toBe(requests[1].body);
    const body = JSON.parse(String(requests[0].body));
    expect(body.record.reply.parent.cid).toBe("parent-cid");
    expect(body.record.reply.root.cid).toBe("root-cid");
    expect(body.rkey).toMatch(/^inbox/);
  });
  it("keeps Bluesky continuation cursors until the previous watermark is reached", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      uri: `at://did:plc:other/app.bsky.feed.post/${i}`,
      cid: "c",
      reason: "mention",
      author: { did: "other" },
      record: { text: "Hi" },
      indexedAt: "2026-10-28T01:00:00Z",
    }));
    const ctx = context("bluesky", async () =>
      json({ notifications: rows, cursor: "page-2" }),
    );
    const result = await getEngagementAdapter("bluesky")!.syncEvents(ctx, {
      after: "2026-10-27T00:00:00Z",
    });
    expect(result.hasMore).toBe(true);
    expect(result.cursor.page).toBe("page-2");
    expect(result.cursor.after).toBe("2026-10-27T00:00:00Z");
  });
  it("sanitizes Mastodon HTML and distinguishes private mentions", async () => {
    const ctx = context("mastodon", async () =>
      json([
        {
          id: "123",
          type: "mention",
          created_at: event.occurredAt,
          account: {
            id: "42",
            acct: "friend@remote.test",
            display_name: "Friend",
          },
          status: {
            id: "456",
            visibility: "direct",
            content: "<p>Hello &amp; welcome</p><script>secret()</script>",
            mentions: [],
            created_at: event.occurredAt,
          },
        },
      ]),
    );
    const result = await getEngagementAdapter("mastodon")!.syncEvents(ctx, {});
    expect(result.events[0].type).toBe("direct_message");
    expect(result.events[0].text).toBe("Hello & welcome");
    expect(result.events[0].replyContext.visibility).toBe("direct");
  });
  it("sends Mastodon private replies to original recipients with Idempotency-Key", async () => {
    let captured: RequestInit | undefined;
    const ctx = context("mastodon", async (_u, init) => {
      captured = init;
      return json({ id: "789", url: "https://social.test/@self/789" });
    });
    await getEngagementAdapter("mastodon")!.sendReply(ctx, {
      actionId: "fixed-action",
      event: {
        ...event,
        replyContext: {
          statusId: "456",
          recipients: ["friend@remote.test"],
          visibility: "direct",
        },
      },
      text: "Hello",
      createdAt: event.occurredAt,
    });
    const body = new URLSearchParams(String(captured?.body));
    expect(body.get("visibility")).toBe("direct");
    expect(body.get("in_reply_to_id")).toBe("456");
    expect(body.get("status")).toBe("@friend@remote.test Hello");
    expect(new Headers(captured?.headers).get("Idempotency-Key")).toBe(
      "fixed-action",
    );
  });
  it("queries YouTube owned channel threads and replies to the top-level comment", async () => {
    const urls: string[] = [],
      requests: RequestInit[] = [];
    const ctx = context("youtube", async (u, init) => {
      urls.push(u);
      requests.push(init!);
      return json(
        u.includes("commentThreads")
          ? {
              items: [
                {
                  id: "thread",
                  snippet: {
                    channelId: account.externalAccountId,
                    videoId: "video",
                    canReply: true,
                    topLevelComment: {
                      id: "comment",
                      snippet: {
                        textOriginal: "Question",
                        authorChannelId: { value: "other" },
                        publishedAt: event.occurredAt,
                      },
                    },
                  },
                },
              ],
            }
          : { id: "reply" },
      );
    });
    const result = await getEngagementAdapter("youtube")!.syncEvents(ctx, {});
    expect(
      new URL(urls[0]).searchParams.get("allThreadsRelatedToChannelId"),
    ).toBe(account.externalAccountId);
    await getEngagementAdapter("youtube")!.sendReply(ctx, {
      actionId: "x",
      event: result.events[0],
      text: "Answer",
      createdAt: event.occurredAt,
    });
    expect(JSON.parse(String(requests[1].body)).snippet).toEqual({
      parentId: "comment",
      textOriginal: "Answer",
    });
  });
  it("rejects malformed success and respects provider Retry-After", async () => {
    const adapter = getEngagementAdapter("youtube")!;
    await expect(
      adapter.sendReply(
        context("youtube", async () => json({})),
        {
          actionId: "x",
          event: { ...event, replyContext: { parentId: "p" } },
          text: "Answer",
          createdAt: event.occurredAt,
        },
      ),
    ).rejects.toThrow("reply_outcome_unknown");
    await expect(
      adapter.syncEvents(
        context(
          "youtube",
          async () =>
            new Response("{}", {
              status: 429,
              headers: { "Retry-After": "120" },
            }),
        ),
        {},
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterSec: 120 });
  });
  it.each(["facebook", "instagram"] as const)(
    "ingests owned %s comments and replies with real wire endpoints",
    async (provider) => {
      const ig = provider === "instagram",
        urls: string[] = [];
      const c = {
        id: "456",
        from: { id: "42", name: "Friend" },
        text: "Question",
        message: "Question",
        timestamp: event.occurredAt,
        created_time: event.occurredAt,
        can_comment: true,
      };
      const ctx = context(provider, async (u) => {
        urls.push(u);
        return json(
          u.includes("/comments?")
            ? {
                data: [
                  {
                    ...c,
                    [ig ? "replies" : "comments"]: {
                      data: [{ ...c, id: "789" }],
                    },
                  },
                ],
              }
            : {
                data: [
                  {
                    id: "123",
                    caption: "Original",
                    message: "Original",
                    permalink: "https://www.instagram.com/p/fixture/",
                    permalink_url: "https://www.facebook.com/123",
                    is_comment_enabled: true,
                  },
                ],
              },
        );
      });
      ctx.account.externalAccountId = "11";
      const result = await getEngagementAdapter(provider)!.syncEvents(ctx, {});
      expect(urls[0]).toContain(ig ? "/11/media?" : "/11/published_posts?");
      expect(result.events.map((e) => e.type)).toEqual(["comment", "reply"]);
      expect(result.events[1].replyContext.parentId).toBe("456");
      expect(result.events[0].post?.text).toBe("Original");
    },
  );
  it.each(["facebook", "instagram"] as const)(
    "sends %s replies to the original thread and treats missing IDs as unknown",
    async (provider) => {
      let target = "",
        body = "";
      const ctx = context(provider, async (u, init) => {
        target = u;
        body = String(init?.body);
        return json({ id: "789" });
      });
      const input = {
        actionId: "action",
        event: { ...event, replyContext: { parentId: "456" } },
        text: "Answer & thanks",
        createdAt: event.occurredAt,
      };
      const adapter = getEngagementAdapter(provider)!;
      await adapter.sendReply(ctx, input);
      expect(target).toMatch(
        provider === "instagram" ? /\/456\/replies$/ : /\/456\/comments$/,
      );
      expect(new URLSearchParams(body).get("message")).toBe(input.text);
      expect(adapter.idempotencyWindowMs).toBe(0);
      ctx.fetchImpl = async () => json({});
      await expect(adapter.sendReply(ctx, input)).rejects.toThrow(
        "reply_outcome_unknown",
      );
    },
  );
  it("does not follow a provider-supplied pagination URL with credentials", async () => {
    const urls: string[] = [];
    const ctx = context("facebook", async (u) => {
      urls.push(u);
      return json(
        u.includes("/comments?")
          ? {
              data: [],
              paging: {
                next: "http://169.254.169.254/secret",
                cursors: { after: "opaque-after" },
              },
            }
          : { data: [{ id: "123" }] },
      );
    });
    ctx.account.externalAccountId = "11";
    const adapter = getEngagementAdapter("facebook")!;
    const result = await adapter.syncEvents(ctx, {});
    expect(result.cursor.page).toBe("opaque-after");
    ctx.fetchImpl = async (u) => {
      urls.push(u);
      return json(u.includes("/comments?") ? { data: [] } : { id: "123" });
    };
    await adapter.syncEvents(ctx, result.cursor);
    expect(
      urls.every((u) => new URL(u).hostname === "graph.facebook.com"),
    ).toBe(true);
    expect(urls.at(-1)).toContain("after=opaque-after");
  });
  it("verifies granted Meta permissions and maps revoked tokens to authorization failures", async () => {
    expect(
      await grantedMetaInboxScopes("fixture", async () =>
        json({
          data: [
            { permission: "pages_manage_engagement", status: "granted" },
            { permission: "pages_read_user_content", status: "declined" },
          ],
        }),
      ),
    ).toEqual(["pages_manage_engagement"]);
    const ctx = context("facebook", async () =>
      json({ error: { code: 190, message: "Expired token" } }, 400),
    );
    ctx.account.externalAccountId = "11";
    await expect(
      getEngagementAdapter("facebook")!.syncEvents(ctx, {}),
    ).rejects.toMatchObject({ status: 401 });
  });
});
