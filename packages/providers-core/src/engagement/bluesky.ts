import type {
  InboxEventType,
  InboxMessage,
  InboxSender,
} from "@aria/shared-types";
import type { EngagementEvent, SocialEngagementAdapter } from "./contract.js";
import {
  accountOrigin,
  engagementFetch,
  safeSocialUrl,
  socialDate,
  socialText,
} from "./util.js";
import { DEFAULT_BLUESKY_INSTANCE } from "../bluesky.js";
import { ProviderHttpError } from "../http.js";

interface Actor {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}
interface Ref {
  uri: string;
  cid: string;
}
interface RecordData {
  text?: string;
  createdAt?: string;
  reply?: { root: Ref; parent: Ref };
}
interface Post {
  uri: string;
  cid: string;
  author: Actor;
  record: RecordData;
  indexedAt?: string;
}
interface Thread {
  notFound?: boolean;
  blocked?: boolean;
  post?: Post;
  parent?: Thread;
  replies?: Thread[];
}
interface Notification {
  uri: string;
  cid: string;
  author: Actor;
  reason: string;
  reasonSubject?: string;
  record: RecordData;
  indexedAt: string;
}
const sender = (actor: Actor): InboxSender => ({
  id: actor.did,
  name: socialText(actor.displayName || actor.handle || actor.did, 200),
  handle: actor.handle,
  avatarUrl: safeSocialUrl(actor.avatar),
});
function postUrl(uri?: string): string | undefined {
  const parts = uri?.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return parts
    ? `https://bsky.app/profile/${encodeURIComponent(parts[1])}/post/${encodeURIComponent(parts[2])}`
    : undefined;
}
function event(notification: Notification): EngagementEvent {
  const types: Record<string, InboxEventType> = {
    mention: "mention",
    reply: "reply",
    quote: "mention",
    like: "reaction",
    repost: "repost",
    follow: "follow",
  };
  const type = types[notification.reason] ?? "other_activity";
  const replyAllowed =
    ["mention", "reply"].includes(type) &&
    !!postUrl(notification.uri) &&
    !!notification.cid;
  const root = notification.record.reply?.root ?? {
    uri: notification.uri,
    cid: notification.cid,
  };
  return {
    externalId: `${notification.reason}:${notification.uri}`,
    type,
    sender: sender(notification.author),
    text:
      socialText(notification.record.text) ||
      (
        {
          reaction: "Liked your post",
          repost: "Reposted your post",
          follow: "Followed your account",
        } as Record<string, string>
      )[type] ||
      notification.reason,
    occurredAt: socialDate(notification.indexedAt),
    nativeUrl:
      postUrl(notification.reasonSubject || notification.uri) ||
      `https://bsky.app/profile/${encodeURIComponent(notification.author.did)}`,
    conversationId: root.uri,
    post: notification.reasonSubject
      ? {
          id: notification.reasonSubject,
          url: postUrl(notification.reasonSubject),
        }
      : undefined,
    replyAllowed,
    replyReason: replyAllowed
      ? undefined
      : "This activity cannot be replied to through the integration.",
    replyContext: replyAllowed
      ? {
          uri: notification.uri,
          cid: notification.cid,
          rootUri: root.uri,
          rootCid: root.cid,
        }
      : {},
  };
}
export const blueskyEngagementAdapter: SocialEngagementAdapter = {
  idempotencyWindowMs: 7 * 86400000,
  async syncEvents(ctx, cursor) {
    const origin = await accountOrigin(ctx, DEFAULT_BLUESKY_INSTANCE);
    const url = new URL(
      `${origin}/xrpc/app.bsky.notification.listNotifications`,
    );
    url.searchParams.set("limit", "50");
    if (cursor.page) url.searchParams.set("cursor", cursor.page);
    const result = await engagementFetch<{
      notifications: Notification[];
      cursor?: string;
    }>(ctx, url.toString());
    if (!Array.isArray(result.notifications))
      throw new Error("invalid_provider_response");
    const boundary = cursor.after || "";
    const newer = result.notifications.filter(
      (n) => !boundary || n.indexedAt >= boundary,
    );
    const events = newer.map(event);
    const newest =
      cursor.newest || result.notifications[0]?.indexedAt || cursor.after || "";
    const reachedBoundary = result.notifications.some(
      (n) => boundary && n.indexedAt < boundary,
    );
    // Initial import is deliberately bounded to the latest 50 notifications.
    const hasMore =
      !!cursor.after &&
      !reachedBoundary &&
      !!result.cursor &&
      result.notifications.length === 50;
    const next: Record<string, string> = hasMore
      ? { after: boundary, newest, page: result.cursor! }
      : { after: newest };
    return { events, hasMore, cursor: next };
  },
  async getConversation(ctx, item) {
    const uri = String(item.replyContext.uri || item.post?.id || "");
    if (!postUrl(uri)) return [];
    const origin = await accountOrigin(ctx, DEFAULT_BLUESKY_INSTANCE);
    const result = await engagementFetch<{ thread: Thread }>(
      ctx,
      `${origin}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=2&parentHeight=10`,
    );
    if (!result.thread) throw new Error("invalid_provider_response");
    if (result.thread.notFound || result.thread.blocked)
      throw new ProviderHttpError(
        "Bluesky post is unavailable",
        404,
        "bluesky",
      );
    const messages: InboxMessage[] = [];
    const visit = (thread?: Thread, parents = false) => {
      if (!thread || messages.length >= 50) return;
      if (parents) visit(thread.parent, true);
      if (thread.post) {
        const p = thread.post;
        messages.push({
          id: p.uri,
          externalId: p.uri,
          direction:
            p.author.did === ctx.account.externalAccountId
              ? "outgoing"
              : "incoming",
          text: socialText(p.record.text),
          sender: sender(p.author),
          occurredAt: socialDate(p.record.createdAt || p.indexedAt),
          url: postUrl(p.uri),
        });
      }
      if (!parents) for (const reply of thread.replies ?? []) visit(reply);
    };
    visit(result.thread, true);
    for (const reply of result.thread?.replies ?? []) visit(reply);
    return messages;
  },
  async sendReply(ctx, input) {
    const c = input.event.replyContext;
    if (
      ![c.uri, c.cid, c.rootUri, c.rootCid].every(
        (v) => typeof v === "string" && v,
      ) ||
      !postUrl(String(c.uri)) ||
      !postUrl(String(c.rootUri))
    )
      throw new Error("missing_reply_context");
    const origin = await accountOrigin(ctx, DEFAULT_BLUESKY_INSTANCE);
    const result = await engagementFetch<{ uri: string; cid: string }>(
      ctx,
      `${origin}/xrpc/com.atproto.repo.putRecord`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: ctx.account.externalAccountId,
          collection: "app.bsky.feed.post",
          rkey: `inbox${input.actionId.replaceAll("-", "")}`,
          record: {
            $type: "app.bsky.feed.post",
            text: input.text,
            createdAt: input.createdAt,
            reply: {
              parent: { uri: c.uri, cid: c.cid },
              root: { uri: c.rootUri, cid: c.rootCid },
            },
          },
        }),
      },
    );
    if (!result.uri || !result.cid) throw new Error("reply_outcome_unknown");
    return { externalId: result.uri, nativeUrl: postUrl(result.uri) };
  },
};
