import type { ProviderId } from "./index.js";

export const FEED_VIEWS = [
  "for_you",
  "following",
  "videos",
  "posts",
  "my_accounts",
  "saved",
  "explore",
] as const;
export type FeedView = (typeof FEED_VIEWS)[number];
export const FEED_TOPICS = [
  "Technology",
  "AI",
  "Education",
  "Entertainment",
  "Sports",
  "Travel",
  "News",
  "Business",
  "Lifestyle",
] as const;
export type FeedContentType = "video" | "image" | "carousel" | "text" | "link";
export type FeedSourceKind =
  "public" | "creator" | "search" | "account" | "url" | "timeline";
export interface FeedSourceConfig {
  actor?: string;
  instance?: string;
  query?: string;
  feed?: string;
  url?: string;
}
export interface UniversalFeedItem {
  id: string;
  provider: ProviderId;
  providerPostId: string;
  authorId: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  contentType: FeedContentType;
  caption: string;
  thumbnailUrl?: string;
  images: Array<{ url: string; alt?: string }>;
  embedUrl?: string;
  originalUrl: string;
  publishedAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  sourceType: FeedSourceKind;
  sourceId: string;
  topics: string[];
  canEmbed: boolean;
  availability: "available" | "preview_only" | "unavailable";
  sensitive: boolean;
  saved?: boolean;
  following?: boolean;
  sample?: boolean;
}
export interface FeedSource {
  id: string;
  provider: ProviderId;
  kind: FeedSourceKind;
  label: string;
  config: FeedSourceConfig;
  topics: string[];
  enabled: boolean;
  removable: boolean;
  accountId: string | null;
  status: "pending" | "healthy" | "blocked" | "error";
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  error: string | null;
}
export interface FeedPreferences {
  favoriteProviders: ProviderId[];
  topics: string[];
  mutedSourceIds: string[];
  reducedSourceIds: string[];
  showSensitive: boolean;
  allowEmbeds: boolean;
}
export const DEFAULT_FEED_PREFERENCES: FeedPreferences = {
  favoriteProviders: [],
  topics: [],
  mutedSourceIds: [],
  reducedSourceIds: [],
  showSensitive: false,
  allowEmbeds: false,
};
export interface FeedFilters {
  view?: FeedView;
  provider?: ProviderId;
  contentType?: FeedContentType;
  search?: string;
  topic?: string;
  cursor?: string;
  limit?: number;
}
export interface FeedPage {
  items: UniversalFeedItem[];
  nextCursor: string | null;
  sessionId: string;
  expiresAt: string;
  cachedAt: string;
  sourcesPending: boolean;
}
export interface FeedCapability {
  provider: ProviderId;
  kinds: FeedSourceKind[];
  discovery: string;
  embeds: string;
  requirements: string;
  configured: boolean;
}

/** Only provider-owned player origins; never accept raw iframe markup from a source. */
export function isOfficialFeedEmbed(
  provider: ProviderId,
  value?: string,
): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return false;
    if (provider === "youtube")
      return (
        u.hostname === "www.youtube-nocookie.com" &&
        /^\/embed\/[\w-]{11}$/.test(u.pathname)
      );
    if (provider === "tiktok")
      return (
        u.hostname === "www.tiktok.com" &&
        /^\/player\/v1\/\d{10,30}$/.test(u.pathname)
      );
    if (provider === "bluesky")
      return (
        u.hostname === "embed.bsky.app" &&
        /^\/embed\/did:(?:plc|web):[\w.:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/.test(
          u.pathname,
        )
      );
    return false;
  } catch {
    return false;
  }
}
