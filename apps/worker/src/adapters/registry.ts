import type { ProviderId } from "@aria/shared-types";
import type { SocialProviderAdapter } from "./contract.js";
import { blueskyAdapter } from "./bluesky.js";
import { mastodonAdapter } from "./mastodon.js";
import { facebookAdapter } from "./facebook.js";
import { instagramAdapter } from "./instagram.js";
import { threadsAdapter } from "./threads.js";
import { linkedinAdapter } from "./linkedin.js";
import { youtubeAdapter } from "./youtube.js";
import { xAdapter } from "./x.js";
import { pinterestAdapter } from "./pinterest.js";
import { getMockAdapter } from "./mock.js";

/**
 * Adapter registry — real integrations for every provider (Phase 5 complete).
 * Set ARIA_ADAPTER_MODE=mock to route everything through the mock adapter
 * (used by the pipeline test-suite and offline demos).
 */
export function getAdapter(id: ProviderId): SocialProviderAdapter {
  if (process.env.ARIA_ADAPTER_MODE === "mock") {
    return getMockAdapter(id);
  }
  switch (id) {
    case "bluesky":
      return blueskyAdapter;
    case "mastodon":
      return mastodonAdapter;
    case "facebook":
      return facebookAdapter;
    case "instagram":
      return instagramAdapter;
    case "threads":
      return threadsAdapter;
    case "linkedin":
      return linkedinAdapter;
    case "youtube":
      return youtubeAdapter;
    case "x":
      return xAdapter;
    case "pinterest":
      return pinterestAdapter;
    default:
      return getMockAdapter(id);
  }
}

/** Whether publishing this provider requires a live credential from the vault. */
export function usesRealCredentials(id: ProviderId): boolean {
  return id in PROVIDER_IS_REAL;
}

const PROVIDER_IS_REAL: Record<string, true> = {
  bluesky: true,
  mastodon: true,
  facebook: true,
  instagram: true,
  threads: true,
  linkedin: true,
  youtube: true,
  x: true,
  pinterest: true,
};
