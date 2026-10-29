import type { ProviderId } from "./index.js";
import type { UniversalFeedItem } from "./feed.js";

export type SearchKind = "all" | "people" | "posts" | "videos" | "topics";
export interface SearchPerson {
  provider: ProviderId;
  id: string;
  name: string;
  handle: string;
  description: string;
  url: string;
  avatarUrl?: string;
  origin: "live" | "collected" | "connected";
  sensitive?: boolean;
  /** Only these public creator identifiers can be subscribed to inside Aria Hub. */
  creator?: { actor: string; instance?: string };
}
export interface SearchTopic {
  provider: ProviderId;
  name: string;
  url: string;
}
export interface SearchCoverage {
  provider: ProviderId;
  mode: "live" | "collected" | "external";
  status:
    | "searched"
    | "partial"
    | "setup_required"
    | "unavailable"
    | "rate_limited";
  message: string;
  externalUrl: string;
  retryAfterSec?: number;
}
export interface UniversalSearchResponse {
  query: string;
  people: SearchPerson[];
  posts: Array<{ item: UniversalFeedItem; origin: "live" | "collected" }>;
  topics: SearchTopic[];
  coverage: SearchCoverage[];
  searchedAt: string;
  sample?: boolean;
}

/** Fixed destinations only; user input remains an encoded search term. */
export function platformSearchUrl(provider: ProviderId, query: string): string {
  const q = encodeURIComponent(new URLSearchParams({ q: query }).get("q") || "");
  const urls: Record<ProviderId, string> = {
    bluesky: `https://bsky.app/search?q=${q}`,
    mastodon: `https://mastodon.social/search?q=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    facebook: `https://www.facebook.com/search/top/?q=${q}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${q}`,
    threads: `https://www.threads.com/search?q=${q}`,
    tiktok: `https://www.tiktok.com/search?q=${q}`,
    x: `https://x.com/search?q=${q}&src=typed_query`,
    linkedin: `https://www.linkedin.com/search/results/all/?keywords=${q}`,
    pinterest: `https://www.pinterest.com/search/pins/?q=${q}`,
  };
  return urls[provider];
}
