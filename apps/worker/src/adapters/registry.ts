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
import { PROVIDERS } from "@aria/shared-types";

/**
 * Fail-closed stand-in for providers without a real integration (TikTok).
 * Validation rejects every post with a clear, non-retryable message, so
 * nothing is ever marked published that wasn't.
 */
function unsupportedAdapter(id: ProviderId): SocialProviderAdapter {
  const name = PROVIDERS[id]?.name ?? id;
  const error = {
    code: "provider_not_available",
    title: `Publishing to ${name} isn't available yet`,
    message: `${name} publishing is not enabled on this server. Remove ${name} from the post's destinations.`,
    retryable: false,
  };
  return {
    id,
    capabilities: () => PROVIDERS[id].capabilities,
    validateContent: () => error,
    uploadMedia: async () => {
      throw Object.assign(new Error(`${error.message} non_retryable`), { code: error.code });
    },
    createPost: async () => {
      throw Object.assign(new Error(`${error.message} non_retryable`), { code: error.code });
    },
    getPostStatus: async () => ({ state: "failed" as const, error }),
    normalizeError: () => error,
  };
}

/**
 * Adapter registry. Set ARIA_ADAPTER_MODE=mock to route everything through
 * the mock adapter (pipeline test-suite and offline demos). Providers without
 * a real integration fail closed — never the mock — outside mock mode.
 */
export function getAdapter(id: ProviderId): SocialProviderAdapter {
  assertAdapterMode();
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
      return unsupportedAdapter(id);
  }
}

/** Reject simulated delivery before a production worker can claim any jobs. */
export function assertAdapterMode(): void {
  if (process.env.NODE_ENV === "production" && process.env.ARIA_ADAPTER_MODE === "mock") {
    throw new Error("ARIA_ADAPTER_MODE=mock is forbidden in production. No publishing jobs were accepted.");
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
