import type {
  InboxEventType,
  InboxMessage,
  InboxSender,
} from "@aria/shared-types";
import type { EngagementEvent, SocialEngagementAdapter } from "./contract.js";
import {
  accountOrigin,
  engagementFetch,
  plainHtml,
  safeSocialUrl,
  socialDate,
  socialText,
} from "./util.js";

interface Actor {
  url?: string;
  id: string;
  acct: string;
  display_name: string;
  avatar?: string;
}
interface Status {
  id: string;
  content: string;
  created_at: string;
  url?: string;
  account: Actor;
  visibility: string;
  in_reply_to_id?: string;
  mentions?: Array<{ acct: string; id: string }>;
}
interface Notification {
  id: string;
  type: string;
  created_at: string;
  account: Actor;
  status?: Status;
}
const sender = (actor: Actor): InboxSender => ({
  id: actor.id,
  name: plainHtml(actor.display_name) || socialText(actor.acct, 200),
  handle: actor.acct,
  avatarUrl: safeSocialUrl(actor.avatar),
});
const compareId = (a: string, b: string) => {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return a > b;
  }
};

export const mastodonEngagementAdapter: SocialEngagementAdapter = {
  // Mastodon documents a one-hour Idempotency-Key cache; leave margin.
  idempotencyWindowMs: 50 * 60_000,
  async syncEvents(ctx, cursor) {
    const origin = await accountOrigin(ctx);
    const url = new URL(`${origin}/api/v1/notifications`);
    url.searchParams.set("limit", "40");
    if (cursor.after) url.searchParams.set("since_id", cursor.after);
    if (cursor.page) url.searchParams.set("max_id", cursor.page);
    const notifications = await engagementFetch<Notification[]>(
      ctx,
      url.toString(),
    );
    if (!Array.isArray(notifications))
      throw new Error("invalid_provider_response");
    const events: EngagementEvent[] = notifications.map(
      (n): EngagementEvent => {
        const status = n.status;
        const mapped: Record<string, InboxEventType> = {
          favourite: "reaction",
          reblog: "repost",
          follow: "follow",
          follow_request: "follow",
        };
        const type: InboxEventType =
          n.type === "mention"
            ? status?.visibility === "direct"
              ? "direct_message"
              : status?.in_reply_to_id
                ? "reply"
                : "mention"
            : (mapped[n.type] ?? "other_activity");
        const recipients = [
          ...new Set([
            n.account.acct,
            ...(status?.mentions ?? [])
              .filter((m) => m.id !== ctx.account.externalAccountId)
              .map((m) => m.acct),
          ]),
        ].filter((v) => /^[A-Za-z0-9_.-]+(?:@[A-Za-z0-9.-]+)?$/.test(v));
        const canReply =
          !!status &&
          ["mention", "reply", "direct_message"].includes(type) &&
          recipients.length > 0;
        return {
          externalId: n.id,
          type,
          sender: sender(n.account),
          text: status
            ? plainHtml(status.content)
            : n.type.replaceAll("_", " "),
          occurredAt: socialDate(n.created_at),
          nativeUrl: safeSocialUrl(status?.url || n.account.url),
          conversationId: status?.id,
          post: status?.in_reply_to_id
            ? { id: status.in_reply_to_id }
            : undefined,
          replyAllowed: canReply,
          replyReason: canReply
            ? undefined
            : "No replyable status is available for this activity.",
          replyContext: status
            ? { statusId: status.id, visibility: status.visibility, recipients }
            : {},
        };
      },
    );
    const newest = cursor.newest || notifications[0]?.id || cursor.after || "";
    const hasMore = !!cursor.after && notifications.length === 40;
    const next: Record<string, string> = hasMore
      ? { after: cursor.after, newest, page: notifications.at(-1)!.id }
      : {
          after:
            !cursor.after || compareId(newest, cursor.after)
              ? newest
              : cursor.after,
        };
    return { events, hasMore, cursor: next };
  },
  async getConversation(ctx, event) {
    const id = event.replyContext.statusId;
    if (typeof id !== "string" || !/^\d+$/.test(id)) return [];
    const origin = await accountOrigin(ctx);
    const thread = await engagementFetch<{
      ancestors: Status[];
      descendants: Status[];
    }>(ctx, `${origin}/api/v1/statuses/${id}/context`);
    return [...(thread.ancestors ?? []), ...(thread.descendants ?? [])]
      .slice(0, 50)
      .map(
        (s): InboxMessage => ({
          id: s.id,
          externalId: s.id,
          direction:
            s.account.id === ctx.account.externalAccountId
              ? "outgoing"
              : "incoming",
          text: plainHtml(s.content),
          sender: sender(s.account),
          occurredAt: socialDate(s.created_at),
          url: safeSocialUrl(s.url),
        }),
      );
  },
  async sendReply(ctx, input) {
    const { statusId, recipients, visibility } = input.event.replyContext;
    if (
      typeof statusId !== "string" ||
      !/^\d+$/.test(statusId) ||
      !Array.isArray(recipients) ||
      !recipients.length
    )
      throw new Error("missing_reply_context");
    const origin = await accountOrigin(ctx);
    const body = new URLSearchParams({
      status: `${recipients.map((r) => `@${r}`).join(" ")} ${input.text}`,
      in_reply_to_id: statusId,
      visibility:
        visibility === "direct"
          ? "direct"
          : ["private", "unlisted"].includes(String(visibility))
            ? String(visibility)
            : "public",
    });
    const result = await engagementFetch<Status>(
      ctx,
      `${origin}/api/v1/statuses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.actionId,
        },
        body: body.toString(),
      },
    );
    if (!result.id) throw new Error("reply_outcome_unknown");
    return { externalId: result.id, nativeUrl: safeSocialUrl(result.url) };
  },
};
