import { fetchJson, type FetchLike } from "./http.js";
import { DEFAULT_BLUESKY_INSTANCE } from "./bluesky.js";
import { normalizeInstance } from "./oauth.js";

/**
 * Engagement metrics for providers that expose them with the scopes we
 * already hold. Networks that need extra review-gated scopes (Meta insights,
 * LinkedIn organization analytics, X paid tiers) are not polled.
 * Fields a network doesn't report stay null — never zero.
 */
export interface PostMetricsSnapshot {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagements: number | null;
  raw?: Record<string, unknown>;
}

export const METRICS_PROVIDERS = ["mastodon", "bluesky", "youtube"] as const;

function sumKnown(...values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

export async function mastodonStatusMetrics(
  instanceUrl: string,
  accessToken: string,
  statusId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<PostMetricsSnapshot> {
  const instance = normalizeInstance(instanceUrl);
  const s = await fetchJson<{ favourites_count?: number; reblogs_count?: number; replies_count?: number }>(
    "Mastodon",
    `${instance}/api/v1/statuses/${encodeURIComponent(statusId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
  );
  return {
    impressions: null,
    likes: s.favourites_count ?? null,
    shares: s.reblogs_count ?? null,
    comments: s.replies_count ?? null,
    engagements: sumKnown(s.favourites_count, s.reblogs_count, s.replies_count),
  };
}

export async function blueskyPostMetrics(
  accessJwt: string,
  uri: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<PostMetricsSnapshot> {
  const instance = opts?.instanceUrl ?? DEFAULT_BLUESKY_INSTANCE;
  const res = await fetchJson<{
    posts?: Array<{ likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }>;
  }>("Bluesky", `${instance}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
    fetchImpl: opts?.fetchImpl,
  });
  const p = res.posts?.[0];
  if (!p) return { impressions: null, likes: null, comments: null, shares: null, engagements: null };
  const shares = sumKnown(p.repostCount, p.quoteCount);
  return {
    impressions: null,
    likes: p.likeCount ?? null,
    shares,
    comments: p.replyCount ?? null,
    engagements: sumKnown(p.likeCount, shares, p.replyCount),
  };
}

export async function youtubeVideoMetrics(
  accessToken: string,
  videoId: string,
  opts?: { fetchImpl?: FetchLike }
): Promise<PostMetricsSnapshot> {
  const res = await fetchJson<{
    items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
  }>("YouTube", `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl: opts?.fetchImpl,
  });
  const st = res.items?.[0]?.statistics;
  const num = (v?: string) => (v === undefined ? null : Number(v));
  const likes = num(st?.likeCount);
  const comments = num(st?.commentCount);
  return {
    impressions: num(st?.viewCount),
    likes,
    comments,
    shares: null,
    engagements: sumKnown(likes, comments),
  };
}
