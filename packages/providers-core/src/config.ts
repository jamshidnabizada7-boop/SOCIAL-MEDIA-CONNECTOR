import type { ProviderId } from "@aria/shared-types";
import { PROVIDERS } from "@aria/shared-types";

export interface ProviderOAuthConfig {
  id: ProviderId;
  authorizeUrl: (env: Record<string, string | undefined>) => string;
  tokenUrl: string;
  scopes: string[];
  /** PKCE with S256 — required by TikTok and X. */
  usePkce: boolean;
  /** Extra authorize params (e.g. YouTube's access_type=offline). */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * How the client authenticates at the token endpoint:
   *  - "body": client_id + client_secret form fields (Google, LinkedIn, Meta)
   *  - "basic": HTTP Basic header (Pinterest; X confidential clients)
   */
  clientAuth?: "body" | "basic";
  /** Name of the client id parameter — TikTok calls it client_key. */
  clientIdParam?: string;
  /** Env keys that must be present to enable this provider's real OAuth. */
  requiredEnv: [string, string][];
  /** Profile fetcher kind — implemented in profile.ts. */
  profileKind:
    | "facebook_pages"
    | "instagram_business"
    | "threads"
    | "linkedin_openid"
    | "tiktok_user"
    | "youtube_channel"
    | "x_me"
    | "pinterest_me";
  /** Documented-verification status carried over from Phase 0. */
  verified: boolean;
}

/**
 * Graph API version. Meta supports each version for ~2 years; bump
 * META_GRAPH_VERSION (e.g. "v25.0") after checking the changelog, no deploy of
 * code needed.
 */
export function metaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION?.trim() || "v23.0";
}

export function graphBase(): string {
  return `https://graph.facebook.com/${metaGraphVersion()}`;
}

/**
 * OAuth endpoints per provider. Facebook/Instagram/Threads/LinkedIn verified
 * 2026-09-30 (see docs/phase-0/PROVIDER-MATRIX.md); the remainder follow their
 * documented stable URLs — re-verify at each provider's Phase 5 adapter pass.
 */
export const PROVIDER_OAUTH: Partial<Record<ProviderId, ProviderOAuthConfig>> = {
  facebook: {
    id: "facebook",
    authorizeUrl: () => `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`,
    get tokenUrl() {
      return `${graphBase()}/oauth/access_token`;
    },
    // publish_video retired by Meta (now "Live Video API"); pages_manage_posts covers video posts.
    scopes: ["pages_show_list", "pages_manage_posts", "pages_manage_engagement", "pages_read_engagement"],
    usePkce: false,
    requiredEnv: [["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]],
    profileKind: "facebook_pages",
    verified: true,
  },
  instagram: {
    id: "instagram",
    authorizeUrl: () => `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`,
    get tokenUrl() {
      return `${graphBase()}/oauth/access_token`;
    },
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
    usePkce: false,
    requiredEnv: [["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]],
    profileKind: "instagram_business",
    verified: true,
  },
  threads: {
    id: "threads",
    authorizeUrl: () => `https://threads.net/oauth/authorize`,
    tokenUrl: `https://graph.threads.net/oauth/access_token`,
    scopes: ["threads_basic", "threads_content_publish"],
    usePkce: false,
    requiredEnv: [["THREADS_APP_ID", "THREADS_APP_SECRET"]],
    profileKind: "threads",
    verified: true,
  },
  linkedin: {
    id: "linkedin",
    authorizeUrl: () => `https://www.linkedin.com/oauth/v2/authorization`,
    tokenUrl: `https://www.linkedin.com/oauth/v2/accessToken`,
    scopes: ["openid", "profile", "w_member_social", "w_organization_social", "r_organization_social"],
    usePkce: false,
    requiredEnv: [["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]],
    profileKind: "linkedin_openid",
    verified: true,
  },
  tiktok: {
    id: "tiktok",
    authorizeUrl: () => `https://www.tiktok.com/v2/auth/authorize/`,
    tokenUrl: `https://open.tiktokapis.com/v2/oauth/token/`,
    scopes: ["user.info.basic", "video.upload", "video.publish"],
    usePkce: true,
    clientIdParam: "client_key",
    requiredEnv: [["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]],
    profileKind: "tiktok_user",
    verified: true,
  },
  youtube: {
    id: "youtube",
    authorizeUrl: () => `https://accounts.google.com/o/oauth2/v2/auth`,
    tokenUrl: `https://oauth2.googleapis.com/token`,
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    usePkce: false,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    requiredEnv: [["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
    profileKind: "youtube_channel",
    verified: false,
  },
  x: {
    id: "x",
    authorizeUrl: () => `https://x.com/i/oauth2/authorize`,
    tokenUrl: `https://api.x.com/2/oauth2/token`,
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    usePkce: true,
    // Confidential client (we hold a secret): X requires Basic auth.
    clientAuth: "basic",
    requiredEnv: [["X_CLIENT_ID", "X_CLIENT_SECRET"]],
    profileKind: "x_me",
    verified: false,
  },
  pinterest: {
    id: "pinterest",
    authorizeUrl: () => `https://www.pinterest.com/oauth/`,
    tokenUrl: `https://api.pinterest.com/v5/oauth/token`,
    scopes: ["user_accounts:read", "boards:read", "pins:read", "pins:write"],
    usePkce: false,
    clientAuth: "basic",
    requiredEnv: [["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"]],
    profileKind: "pinterest_me",
    verified: false,
  },
  // mastodon is per-instance — handled specially in oauth.ts / mastodon.ts.
  // bluesky uses app passwords — no OAuth.
};

export function providerName(id: ProviderId): string {
  return PROVIDERS[id]?.name ?? id;
}

export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:4100";
}

export function redirectUriFor(provider: ProviderId): string {
  return `${appBaseUrl()}/v1/oauth/callback/${provider}`;
}

/** Client credentials from env, when the operator registered the app. */
export function providerCredentials(id: ProviderId): { clientId: string; clientSecret: string } | null {
  const cfg = PROVIDER_OAUTH[id as keyof typeof PROVIDER_OAUTH];
  if (!cfg) return null;
  const [idKey, secretKey] = cfg.requiredEnv[0];
  const clientId = process.env[idKey];
  const clientSecret = process.env[secretKey];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function providerConfigured(id: ProviderId): boolean {
  return id === "bluesky" || id === "mastodon" || providerCredentials(id) !== null;
}
