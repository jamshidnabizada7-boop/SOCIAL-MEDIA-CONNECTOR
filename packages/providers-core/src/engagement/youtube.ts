import type { InboxMessage, InboxSender } from "@aria/shared-types";
import type { EngagementEvent, SocialEngagementAdapter } from "./contract.js";
import {
  engagementFetch,
  safeSocialUrl,
  socialDate,
  socialText,
} from "./util.js";

interface Comment {
  id: string;
  snippet: {
    textOriginal?: string;
    textDisplay?: string;
    authorDisplayName?: string;
    authorChannelId?: { value: string };
    authorProfileImageUrl?: string;
    publishedAt: string;
    updatedAt?: string;
    parentId?: string;
  };
}
interface CommentThread {
  id: string;
  snippet: {
    channelId: string;
    videoId?: string;
    canReply: boolean;
    topLevelComment: Comment;
  };
  replies?: { comments?: Comment[] };
}
const sender = (c: Comment): InboxSender => ({
  id: c.snippet.authorChannelId?.value || c.id,
  name: socialText(c.snippet.authorDisplayName || "YouTube user", 200),
  avatarUrl: safeSocialUrl(c.snippet.authorProfileImageUrl),
});
const url = (video: string, comment: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(video)}&lc=${encodeURIComponent(comment)}`;
function normalize(
  c: Comment,
  thread: CommentThread,
  isReply: boolean,
): EngagementEvent {
  const parent = thread.snippet.topLevelComment.id;
  return {
    externalId: c.id,
    type: isReply ? "reply" : "comment",
    sender: sender(c),
    text: socialText(c.snippet.textOriginal || c.snippet.textDisplay),
    occurredAt: socialDate(c.snippet.publishedAt),
    nativeUrl: thread.snippet.videoId
      ? url(thread.snippet.videoId, c.id)
      : undefined,
    conversationId: parent,
    post: thread.snippet.videoId
      ? {
          id: thread.snippet.videoId,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(thread.snippet.videoId)}`,
        }
      : undefined,
    replyAllowed: !!thread.snippet.canReply,
    replyReason: thread.snippet.canReply
      ? undefined
      : "YouTube does not allow replies to this thread.",
    replyContext: { parentId: parent, videoId: thread.snippet.videoId || "" },
  };
}
export const youtubeEngagementAdapter: SocialEngagementAdapter = {
  idempotencyWindowMs: 0,
  async syncEvents(ctx, cursor) {
    const endpoint = new URL(
      "https://www.googleapis.com/youtube/v3/commentThreads",
    );
    endpoint.searchParams.set("part", "snippet,replies");
    endpoint.searchParams.set(
      "allThreadsRelatedToChannelId",
      ctx.account.externalAccountId,
    );
    endpoint.searchParams.set("maxResults", "50");
    endpoint.searchParams.set("order", "time");
    endpoint.searchParams.set("textFormat", "plainText");
    if (cursor.page) endpoint.searchParams.set("pageToken", cursor.page);
    const result = await engagementFetch<{
      items: CommentThread[];
      nextPageToken?: string;
    }>(ctx, endpoint.toString());
    if (!Array.isArray(result.items))
      throw new Error("invalid_provider_response");
    const threads = result.items.filter(
      (t) => t.snippet.channelId === ctx.account.externalAccountId,
    );
    const events = threads.flatMap((t) => [
      normalize(t.snippet.topLevelComment, t, false),
      ...(t.replies?.comments ?? [])
        .filter(
          (c) =>
            c.snippet.authorChannelId?.value !== ctx.account.externalAccountId,
        )
        .map((c) => normalize(c, t, true)),
    ]);
    const newest =
      cursor.newest ||
      threads[0]?.snippet.topLevelComment.snippet.publishedAt ||
      cursor.after ||
      "";
    const reached = threads.some(
      (t) =>
        cursor.after &&
        t.snippet.topLevelComment.snippet.publishedAt <= cursor.after,
    );
    const hasMore = !!cursor.after && !reached && !!result.nextPageToken;
    const next: Record<string, string> = hasMore
      ? { after: cursor.after, newest, page: result.nextPageToken! }
      : { after: newest };
    return {
      events: events.filter(
        (e) => e.sender.id !== ctx.account.externalAccountId,
      ),
      hasMore,
      cursor: next,
    };
  },
  async getConversation(ctx, event) {
    const parent = event.replyContext.parentId;
    if (typeof parent !== "string") return [];
    const result = await engagementFetch<{ items: Comment[] }>(
      ctx,
      `https://www.googleapis.com/youtube/v3/comments?part=snippet&maxResults=100&textFormat=plainText&parentId=${encodeURIComponent(parent)}`,
    );
    return (result.items ?? []).slice(0, 100).map(
      (c): InboxMessage => ({
        id: c.id,
        externalId: c.id,
        direction:
          c.snippet.authorChannelId?.value === ctx.account.externalAccountId
            ? "outgoing"
            : "incoming",
        text: socialText(c.snippet.textOriginal || c.snippet.textDisplay),
        sender: sender(c),
        occurredAt: socialDate(c.snippet.publishedAt),
        url: event.replyContext.videoId
          ? url(String(event.replyContext.videoId), c.id)
          : undefined,
      }),
    );
  },
  async sendReply(ctx, input) {
    const parent = input.event.replyContext.parentId;
    if (typeof parent !== "string" || !parent)
      throw new Error("missing_reply_context");
    const result = await engagementFetch<Comment>(
      ctx,
      "https://www.googleapis.com/youtube/v3/comments?part=snippet",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: { parentId: parent, textOriginal: input.text },
        }),
      },
    );
    if (!result.id) throw new Error("reply_outcome_unknown");
    return {
      externalId: result.id,
      nativeUrl: input.event.replyContext.videoId
        ? url(String(input.event.replyContext.videoId), result.id)
        : undefined,
    };
  },
};
