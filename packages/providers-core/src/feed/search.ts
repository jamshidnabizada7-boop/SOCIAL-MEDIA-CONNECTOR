import type { SearchPerson, SearchTopic } from "@aria/shared-types";
import { plainHtml } from "../engagement/util.js";
import { ProviderHttpError } from "../http.js";
import {
  readFeedMetadata,
  normalizeMastodonFeedItem,
  retrieveFeed,
  publicBlueskyLabels,
  safeFeedUrl,
  type FeedContext,
  type RetrievedFeedItem,
} from "./index.js";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown, max = 1000) =>
  typeof v === "string" ? v.slice(0, max) : "";
export interface NetworkSearchResult {
  people: SearchPerson[];
  posts: RetrievedFeedItem[];
  topics: SearchTopic[];
  partial: boolean;
  retryAfterSec?: number;
}

/** Bounded official reads. Searching never subscribes, publishes or follows an account. */
export async function searchNetwork(
  context: FeedContext,
  query: string,
): Promise<NetworkSearchResult> {
  const ctx = { ...context, timeoutMs: 6000 };
  const result: NetworkSearchResult = {
    people: [],
    posts: [],
    topics: [],
    partial: false,
  };
  if (ctx.provider === "bluesky" || ctx.provider === "youtube") {
    const key = process.env.YOUTUBE_DATA_API_KEY;
    if (ctx.provider === "youtube" && !key)
      throw new Error("YouTube search requires its Data API key.");
    const origin =
      process.env.NODE_ENV !== "production" &&
      process.env.ARIA_FEED_BLUESKY_ORIGIN
        ? process.env.ARIA_FEED_BLUESKY_ORIGIN.replace(/\/$/, "")
        : "https://public.api.bsky.app";
    const term = query.replace(/^@/, "");
    const peopleUrl =
      ctx.provider === "bluesky"
        ? `${origin}/xrpc/app.bsky.actor.searchActors?${new URLSearchParams({ q: term, limit: "12" })}`
        : `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: "snippet", q: term, type: "channel", maxResults: "12", key: key!, safeSearch: "strict" })}`;
    const responses = await Promise.allSettled([
      readFeedMetadata(ctx, peopleUrl),
      retrieveFeed({ ...ctx, kind: "search", config: { query: term } }),
    ]);
    if (responses.every((r) => r.status === "rejected"))
      throw (responses[0] as PromiseRejectedResult).reason;
    result.partial = responses.some((r) => r.status === "rejected");
    for (const response of responses)
      if (
        response.status === "rejected" &&
        response.reason instanceof ProviderHttpError &&
        response.reason.status === 429
      )
        result.retryAfterSec = Math.max(
          result.retryAfterSec || 0,
          response.reason.retryAfterSec || 60,
        );
    if (responses[1].status === "fulfilled")
      result.posts = responses[1].value.slice(0, 12);
    if (responses[0].status === "fulfilled") {
      if (ctx.provider === "bluesky")
        for (const p of rows(responses[0].value.actors).slice(0, 12)) {
          const labels = publicBlueskyLabels(p.labels),
            did = text(p.did, 300),
            handle = text(p.handle, 300);
          if (
            !labels ||
            !/^did:(plc|web):[\w.:%-]+$/.test(did) ||
            p.blockedBy ||
            p.blocking ||
            !handle
          )
            continue;
          result.people.push({
            provider: "bluesky",
            id: did,
            name: text(p.displayName) || handle,
            handle,
            description: text(p.description),
            url: `https://bsky.app/profile/${encodeURIComponent(did)}`,
            avatarUrl: safeFeedUrl(p.avatar),
            origin: "live",
            sensitive: labels.includes("nudity"),
            creator: { actor: did },
          });
        }
      else
        for (const p of rows(responses[0].value.items).slice(0, 12)) {
          const snippet = obj(p.snippet),
            channel = text(obj(p.id).channelId);
          if (!/^UC[\w-]{22}$/.test(channel)) continue;
          result.people.push({
            provider: "youtube",
            id: channel,
            name: plainHtml(text(snippet.title)),
            handle: channel,
            description: plainHtml(text(snippet.description)),
            url: `https://www.youtube.com/channel/${channel}`,
            avatarUrl: safeFeedUrl(obj(obj(snippet.thumbnails).default).url),
            origin: "live",
            creator: { actor: channel },
          });
        }
    }
    return result;
  }
  if (ctx.provider === "mastodon") {
    const origin = new URL(ctx.config.instance || "https://mastodon.social")
      .origin;
    if (
      ctx.accessToken &&
      (!ctx.account?.instanceUrl ||
        new URL(ctx.account.instanceUrl).origin !== origin)
    )
      throw new Error("Account credentials do not belong to this instance.");
    const params = new URLSearchParams({
      q: query,
      limit: "10",
      exclude_unreviewed: "true",
    });
    // Remote resolution and offset are deliberately omitted, including for anonymous requests.
    const data = await readFeedMetadata(
      ctx,
      `${origin}/api/v2/search?${params}`,
      !!ctx.accessToken,
    );
    for (const p of rows(data.accounts).slice(0, 10)) {
      const url = safeFeedUrl(p.url),
        accountId = text(p.id, 30),
        handle = text(p.acct, 300);
      if (
        !url ||
        !/^\d+$/.test(accountId) ||
        !handle ||
        p.suspended ||
        p.limited ||
        p.discoverable === false ||
        p.noindex === true
      )
        continue;
      result.people.push({
        provider: "mastodon",
        id: `${origin}:${accountId}`,
        name: text(p.display_name) || handle,
        handle,
        description: plainHtml(text(p.note, 5000)).slice(0, 1000),
        url,
        avatarUrl: safeFeedUrl(p.avatar_static),
        origin: "live",
        creator: { actor: accountId, instance: origin },
      });
    }
    result.posts = rows(data.statuses)
      .map((p) => normalizeMastodonFeedItem(ctx, p))
      .filter((p): p is RetrievedFeedItem => !!p)
      .slice(0, 10);
    result.topics = rows(data.hashtags)
      .flatMap((p) => {
        const url = safeFeedUrl(p.url),
          name = text(p.name, 120);
        return url && name
          ? [{ provider: "mastodon" as const, name, url }]
          : [];
      })
      .slice(0, 10);
    return result;
  }
  throw new Error("Global API search is not enabled for this platform.");
}
