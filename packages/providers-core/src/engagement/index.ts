import type { ProviderId } from "@aria/shared-types";
import type { SocialEngagementAdapter } from "./contract.js";
import { blueskyEngagementAdapter } from "./bluesky.js";
import { mastodonEngagementAdapter } from "./mastodon.js";
import { youtubeEngagementAdapter } from "./youtube.js";
import { metaEngagementAdapter } from "./meta.js";
export { grantedMetaInboxScopes } from "./meta.js";
export * from "./contract.js";
export * from "./capabilities.js";
export function getEngagementAdapter(
  provider: ProviderId,
): SocialEngagementAdapter | null {
  return (
    (
      {
        bluesky: blueskyEngagementAdapter,
        mastodon: mastodonEngagementAdapter,
        youtube: youtubeEngagementAdapter,
        facebook: metaEngagementAdapter,
        instagram: metaEngagementAdapter,
      } as Partial<Record<ProviderId, SocialEngagementAdapter>>
    )[provider] ?? null
  );
}
