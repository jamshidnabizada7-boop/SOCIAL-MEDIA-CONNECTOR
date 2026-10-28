import type { InboxMessage, InboxSender } from "@aria/shared-types";
import { graphBase } from "../config.js";
import { ProviderHttpError } from "../http.js";
import type {
  EngagementContext,
  EngagementEvent,
  SocialEngagementAdapter,
} from "./contract.js";
import {
  engagementFetch,
  safeSocialUrl,
  socialDate,
  socialText,
} from "./util.js";

interface Page<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}
interface Media {
  id: string;
  message?: string;
  caption?: string;
  permalink?: string;
  permalink_url?: string;
  is_comment_enabled?: boolean;
}
interface Comment {
  id: string;
  from?: { id?: string; name?: string; username?: string };
  username?: string;
  message?: string;
  text?: string;
  created_time?: string;
  timestamp?: string;
  permalink_url?: string;
  can_comment?: boolean;
  parent?: { id: string };
  parent_id?: string;
  comments?: Page<Comment>;
  replies?: Page<Comment>;
}
const id = (value: string) => {
  if (!/^[\d_]+$/.test(value)) throw new Error("invalid_meta_object_id");
  return encodeURIComponent(value);
};
const isInstagram = (ctx: EngagementContext) =>
  ctx.account.provider === "instagram";
const fields = (ig: boolean) =>
  ig
    ? "id,text,timestamp,from,username,parent_id"
    : "id,message,created_time,from,permalink_url,can_comment,parent";
const sender = (c: Comment): InboxSender => ({
  id: c.from?.id || `anonymous:${c.id}`,
  name: socialText(
    c.from?.name || c.from?.username || c.username || "Platform user",
    200,
  ),
  handle: c.from?.username || c.username,
});
async function read<T>(
  ctx: EngagementContext,
  endpoint: string,
  query: Record<string, string>,
): Promise<T> {
  const url = new URL(`${graphBase()}/${endpoint}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  return engagementFetch<T>(ctx, url.toString());
}
function normalized(
  ctx: EngagementContext,
  c: Comment,
  media: Media,
  parent?: string,
): EngagementEvent {
  const ig = isInstagram(ctx),
    root = parent || c.parent_id || c.parent?.id || c.id;
  const allowed = ig
    ? media.is_comment_enabled !== false
    : c.can_comment === true;
  return {
    externalId: c.id,
    type: parent || c.parent_id || c.parent?.id ? "reply" : "comment",
    sender: sender(c),
    text: socialText(ig ? c.text : c.message),
    occurredAt: socialDate(ig ? c.timestamp : c.created_time),
    nativeUrl: safeSocialUrl(
      c.permalink_url || media.permalink || media.permalink_url,
    ),
    conversationId: root,
    post: {
      id: media.id,
      text: socialText(media.caption || media.message, 2000),
      url: safeSocialUrl(media.permalink || media.permalink_url),
    },
    replyContext: { parentId: root, objectId: media.id },
    replyAllowed: allowed,
    replyReason: allowed
      ? undefined
      : "The platform has disabled replies to this interaction.",
  };
}
/** Bounded traversal of 10 owned posts/media. Provider next URLs are never fetched. */
export const metaEngagementAdapter: SocialEngagementAdapter = {
  idempotencyWindowMs: 0,
  async syncEvents(ctx, cursor) {
    const ig = isInstagram(ctx);
    let objectIds: string[] = [];
    if (cursor.objects) {
      try {
        objectIds = JSON.parse(cursor.objects) as string[];
      } catch {
        throw new Error("invalid_sync_cursor");
      }
    }
    if (
      !Array.isArray(objectIds) ||
      objectIds.length > 10 ||
      objectIds.some((v) => typeof v !== "string" || !/^[\d_]+$/.test(v))
    )
      throw new Error("invalid_sync_cursor");
    let index = Number(cursor.index || 0);
    if (!Number.isInteger(index) || index < 0 || index > 9)
      throw new Error("invalid_sync_cursor");
    let media: Media;
    if (!objectIds.length) {
      const result = await read<Page<Media>>(
        ctx,
        `${id(ctx.account.externalAccountId)}/${ig ? "media" : "published_posts"}`,
        {
          fields: ig
            ? "id,caption,permalink,is_comment_enabled"
            : "id,message,permalink_url",
          limit: "10",
        },
      );
      if (!Array.isArray(result.data))
        throw new Error("invalid_provider_response");
      objectIds = result.data.slice(0, 10).map((m) => m.id);
      index = 0;
      if (!objectIds.length) return { events: [], cursor: {}, hasMore: false };
      media = result.data[0];
    } else {
      try {
        media = await read<Media>(ctx, id(objectIds[index]), {
          fields: ig
            ? "id,caption,permalink,is_comment_enabled"
            : "id,message,permalink_url",
        });
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || error.status !== 404)
          throw error;
        const next: Record<string, string> =
          index + 1 < objectIds.length
            ? { objects: JSON.stringify(objectIds), index: String(index + 1) }
            : {};
        return { events: [], cursor: next, hasMore: !!next.objects };
      }
    }
    const children = ig ? "replies" : "comments";
    const result = await read<Page<Comment>>(ctx, `${id(media.id)}/comments`, {
      fields: `${fields(ig)},${children}.limit(25){${fields(ig)}}`,
      limit: "50",
      ...(ig ? {} : { filter: "toplevel", order: "reverse_chronological" }),
      ...(cursor.page ? { after: cursor.page } : {}),
    });
    if (!Array.isArray(result.data))
      throw new Error("invalid_provider_response");
    const events = result.data
      .flatMap((c) => [
        normalized(ctx, c, media),
        ...(c[children]?.data ?? [])
          .slice(0, 25)
          .map((r) => normalized(ctx, r, media, c.id)),
      ])
      .filter(
        (e) =>
          e.sender.id !== ctx.account.externalAccountId &&
          e.sender.handle !== ctx.account.handle.replace(/^@/, ""),
      );
    const pages = Number(cursor.pages || 0) + 1;
    const next: Record<string, string> = {};
    if (result.paging?.next && result.paging.cursors?.after && pages < 5)
      Object.assign(next, {
        objects: JSON.stringify(objectIds),
        index: String(index),
        page: result.paging.cursors.after,
        pages: String(pages),
      });
    else if (index + 1 < objectIds.length)
      Object.assign(next, {
        objects: JSON.stringify(objectIds),
        index: String(index + 1),
      });
    return { events, cursor: next, hasMore: !!next.objects };
  },
  async getConversation(ctx, event) {
    const ig = isInstagram(ctx),
      parentId = String(event.replyContext.parentId || "");
    const result = await read<Page<Comment>>(
      ctx,
      `${id(parentId)}/${ig ? "replies" : "comments"}`,
      { fields: fields(ig), limit: "100" },
    );
    if (!Array.isArray(result.data))
      throw new Error("invalid_provider_response");
    return result.data.slice(0, 100).map(
      (c): InboxMessage => ({
        id: c.id,
        externalId: c.id,
        direction:
          c.from?.id === ctx.account.externalAccountId ||
          (c.username || c.from?.username) ===
            ctx.account.handle.replace(/^@/, "")
            ? "outgoing"
            : "incoming",
        sender: sender(c),
        text: socialText(ig ? c.text : c.message),
        occurredAt: socialDate(ig ? c.timestamp : c.created_time),
        url: safeSocialUrl(c.permalink_url || event.nativeUrl),
      }),
    );
  },
  async sendReply(ctx, input) {
    const parentId = String(input.event.replyContext.parentId || "");
    const result = await engagementFetch<{ id?: string }>(
      ctx,
      `${graphBase()}/${id(parentId)}/${isInstagram(ctx) ? "replies" : "comments"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: input.text }).toString(),
      },
    );
    if (!result.id) throw new Error("reply_outcome_unknown");
    return { externalId: result.id, nativeUrl: input.event.nativeUrl };
  },
};
/** Meta's OAuth token response often omits scope; verify granted user permissions explicitly. */
export async function grantedMetaInboxScopes(
  accessToken: string,
  fetchImpl?: EngagementContext["fetchImpl"],
): Promise<string[]> {
  const result = await engagementFetch<{
    data: Array<{ permission: string; status: string }>;
  }>(
    {
      account: {
        id: "",
        workspaceId: "",
        provider: "facebook",
        externalAccountId: "",
        displayName: "",
        handle: "",
        connection: "healthy",
        scopes: [],
      },
      accessToken,
      fetchImpl,
    },
    `${graphBase()}/me/permissions`,
  );
  if (!Array.isArray(result.data))
    throw new ProviderHttpError(
      "Meta permission verification failed",
      403,
      "facebook",
    );
  return result.data
    .filter((p) => p.status === "granted")
    .map((p) => p.permission);
}
