import { createHash, randomBytes } from "node:crypto";
import { assertSafeUrlShape } from "./net-guard.js";
import type { ProviderId } from "@aria/shared-types";
import type { AriaDatabase } from "@aria/db";
import { fetchJson, postForm, type FetchLike } from "./http.js";
import { ensureMastodonApp } from "./mastodon.js";
import {
  graphBase,
  PROVIDER_OAUTH,
  redirectUriFor,
  providerName,
  type ProviderOAuthConfig,
} from "./config.js";
import { getProviderCredentials } from "./db-credentials.js";
import { INBOX_OAUTH_SCOPES } from "./engagement/capabilities.js";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(24).toString("base64url");
}

export interface AuthorizeUrlResult {
  url: string;
  state: string;
  codeVerifier?: string;
}

/** Builds the provider authorization URL (PKCE where the provider requires it). */
export async function buildAuthorizeUrl(
  provider: ProviderId,
  opts?: { instanceUrl?: string; db?: AriaDatabase; access?: "publishing" | "inbox" }
): Promise<AuthorizeUrlResult> {
  if (provider === "mastodon") {
    if (!opts?.instanceUrl) throw new Error("Mastodon connect requires an instance URL");
    if (!opts.db) throw new Error("Mastodon connect requires database context");
    const instance = normalizeInstance(opts.instanceUrl);
    const creds = await ensureMastodonApp(opts.db, instance);
    const state = createState();
    const url = new URL(`${instance}/oauth/authorize`);
    url.searchParams.set("client_id", creds.clientId);
    url.searchParams.set("redirect_uri", redirectUriFor("mastodon"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read write:statuses write:media");
    url.searchParams.set("state", state);
    return { url: url.toString(), state };
  }

  const cfg = PROVIDER_OAUTH[provider as keyof typeof PROVIDER_OAUTH];
  if (!cfg) throw new Error(`Provider ${provider} does not use OAuth`);
  const creds = await getProviderCredentials(opts?.db ?? null, provider).catch(() => null);
  if (!creds) {
    throw new Error(
      `${providerName(provider)} is not configured on this server yet — register the developer app first (see docs/phase-0/PROVIDER-SETUP.md).`
    );
  }
  const url = new URL(cfg.authorizeUrl({}));
  url.searchParams.set(cfg.clientIdParam ?? "client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUriFor(provider));
  url.searchParams.set("response_type", "code");
  const scopes = [...new Set([...cfg.scopes, ...(opts?.access === "inbox" ? INBOX_OAUTH_SCOPES[provider] ?? [] : [])])];
  url.searchParams.set("scope", scopes.join(cfg.id === "tiktok" ? "," : " "));
  const state = createState();
  url.searchParams.set("state", state);
  let codeVerifier: string | undefined;
  if (cfg.usePkce) {
    const pkce = createPkcePair();
    codeVerifier = pkce.verifier;
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), state, codeVerifier };
}

/** Posts a token-endpoint form with the client authentication the provider expects. */
async function tokenRequest(
  provider: ProviderId,
  cfg: ProviderOAuthConfig,
  creds: { clientId: string; clientSecret: string },
  form: Record<string, string>,
  fetchImpl?: FetchLike
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  const body = { ...form };
  if (cfg.clientAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`).toString("base64")}`;
    // X still wants client_id in the body alongside Basic auth for PKCE grants.
    if (provider === "x") body.client_id = creds.clientId;
  } else {
    body[cfg.clientIdParam ?? "client_id"] = creds.clientId;
    body.client_secret = creds.clientSecret;
  }
  return postForm<Record<string, unknown>>(providerName(provider), cfg.tokenUrl, body, { headers, fetchImpl });
}

export interface TokenGrant {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  scopes?: string[];
  raw?: Record<string, unknown>;
}

export interface ExchangeInput {
  provider: ProviderId;
  code: string;
  codeVerifier?: string;
  instanceUrl?: string;
  fetchImpl?: FetchLike;
  db?: AriaDatabase;
}

export async function exchangeCodeForTokens(input: ExchangeInput): Promise<TokenGrant> {
  if (input.provider === "mastodon") {
    if (!input.instanceUrl) throw new Error("Mastodon callback missing instance context");
    if (!input.db) throw new Error("Mastodon callback missing database context");
    const instance = normalizeInstance(input.instanceUrl);
    const creds = await ensureMastodonApp(input.db, instance);
    const res = await postForm<Record<string, unknown>>("Mastodon", `${instance}/oauth/token`, {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code: input.code,
      redirect_uri: redirectUriFor("mastodon"),
      grant_type: "authorization_code",
      scope: "read write:statuses write:media",
    }, { fetchImpl: input.fetchImpl });
    return grantFrom(res);
  }

  const cfg = PROVIDER_OAUTH[input.provider as keyof typeof PROVIDER_OAUTH];
  const creds = await getProviderCredentials(input.db ?? null, input.provider).catch(() => null);
  if (!cfg || !creds) throw new Error(`Provider ${input.provider} is not configured`);
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUriFor(input.provider),
  };
  if (cfg.usePkce) {
    if (!input.codeVerifier) throw new Error("Missing PKCE verifier");
    form.code_verifier = input.codeVerifier;
  }
  const res = await tokenRequest(input.provider, cfg, creds, form, input.fetchImpl);
  const grant = grantFrom(res);
  // Threads: swap the ~1h token for a long-lived (~60 day) one on Threads'
  // own endpoint; it is later renewed with th_refresh_token.
  if (input.provider === "threads") {
    try {
      const long = await fetchJson<Record<string, unknown>>(
        "Threads",
        `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(creds.clientSecret)}&access_token=${encodeURIComponent(grant.accessToken)}`,
        { fetchImpl: input.fetchImpl }
      );
      const extended = grantFrom(long);
      return { ...extended, refreshToken: extended.accessToken, scopes: grant.scopes };
    } catch {
      return grant;
    }
  }
  // Facebook/Instagram code-exchange tokens live ~1–2h. Swap for a long-lived
  // (~60 day) token immediately; Page tokens and later refreshes derive from
  // it. Falls back to the short-lived token rather than failing the connect.
  if (providerIsMeta(input.provider)) {
    try {
      const long = await fetchJson<Record<string, unknown>>(
        providerName(input.provider),
        `${graphBase()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}&fb_exchange_token=${encodeURIComponent(grant.accessToken)}`,
        { fetchImpl: input.fetchImpl }
      );
      const extended = grantFrom(long);
      if (extended.accessToken) {
        // Meta issues no refresh tokens — the long-lived token refreshes
        // itself via fb_exchange_token, so carry it as the refresh token too.
        return { ...extended, refreshToken: extended.accessToken, scopes: grant.scopes };
      }
    } catch {
      return grant;
    }
  }
  return grant;
}

/** Facebook Login providers (Threads has its own OAuth and token endpoints). */
function providerIsMeta(provider: ProviderId): boolean {
  return provider === "facebook" || provider === "instagram";
}

export async function refreshAccessToken(
  provider: ProviderId,
  refreshToken: string,
  opts?: {
    instanceUrl?: string;
    fetchImpl?: FetchLike;
    blueskyInstance?: string;
    /** Facebook Page id when refreshing a Page account's token. */
    facebookPageId?: string;
    db?: AriaDatabase;
  }
): Promise<TokenGrant> {
  if (provider === "bluesky") {
    // App-password sessions refresh via the session endpoint, not a form grant.
    const instance = opts?.blueskyInstance ?? "https://bsky.social";
    const session = await postForm<Record<string, unknown>>(
      "Bluesky",
      `${instance}/xrpc/com.atproto.server.refreshSession`,
      {},
      { headers: { Authorization: `Bearer ${refreshToken}` }, fetchImpl: opts?.fetchImpl }
    ).then((r) => r as unknown as { accessJwt: string; refreshJwt: string; did: string; handle: string });
    return {
      accessToken: session.accessJwt,
      refreshToken: session.refreshJwt,
      raw: { did: session.did, handle: session.handle },
    };
  }
  if (provider === "mastodon") {
    const instance = normalizeInstance(opts?.instanceUrl ?? "https://mastodon.social");
    if (!opts?.db) throw new Error("Mastodon refresh missing database context");
    const creds = await ensureMastodonApp(opts.db, instance);
    const res = await postForm<Record<string, unknown>>("Mastodon", `${instance}/oauth/token`, {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }, { fetchImpl: opts?.fetchImpl });
    return grantFrom(res);
  }
  if (provider === "facebook") {
    // The stored "refresh token" is the long-lived user token; re-derive the
    // Page token for this account from it (Page tokens outlive the grant).
    if (!opts?.facebookPageId) throw new Error("Facebook refresh missing page context");
    const res = await fetchJson<{ data: Array<{ id: string; access_token: string }> }>(
      "Facebook",
      `${graphBase()}/me/accounts?fields=access_token&limit=100`,
      { headers: { Authorization: `Bearer ${refreshToken}` }, fetchImpl: opts?.fetchImpl }
    );
    const page = res.data.find((p) => p.id === opts.facebookPageId);
    if (!page) throw new Error("This Page is no longer manageable by the connecting Facebook user — reconnect the account.");
    // Keep the user token as the refresh token. Page tokens derived from a
    // long-lived user token don't expire, so no expiry is recorded.
    return { accessToken: page.access_token, refreshToken, raw: page };
  }
  if (provider === "threads") {
    // Long-lived Threads tokens (≥24h old, unexpired) renew themselves for another ~60 days.
    const res = await fetchJson<Record<string, unknown>>(
      "Threads",
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(refreshToken)}`,
      { fetchImpl: opts?.fetchImpl }
    );
    const renewed = grantFrom(res);
    return { ...renewed, refreshToken: renewed.accessToken };
  }
  if (provider === "instagram") {
    const cfgMeta = PROVIDER_OAUTH[provider as keyof typeof PROVIDER_OAUTH];
    const credsMeta = await getProviderCredentials(opts?.db ?? null, provider).catch(() => null);
    if (!cfgMeta || !credsMeta) throw new Error(`Provider ${provider} is not configured`);
    const res = await fetchJson<Record<string, unknown>>(
      providerName(provider),
      `${graphBase()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(credsMeta.clientId)}&client_secret=${encodeURIComponent(credsMeta.clientSecret)}&fb_exchange_token=${encodeURIComponent(refreshToken)}`,
      { fetchImpl: opts?.fetchImpl }
    );
    const extended = grantFrom(res);
    return { ...extended, refreshToken: extended.accessToken };
  }
  const cfg = PROVIDER_OAUTH[provider as keyof typeof PROVIDER_OAUTH];
  const creds = await getProviderCredentials(opts?.db ?? null, provider).catch(() => null);
  if (!cfg || !creds) throw new Error(`Provider ${provider} is not configured`);
  const res = await tokenRequest(
    provider,
    cfg,
    creds,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    opts?.fetchImpl
  );
  const grant = grantFrom(res);
  // Providers that don't rotate refresh tokens (Google) omit it — keep the old one.
  return { ...grant, refreshToken: grant.refreshToken ?? refreshToken };
}

function grantFrom(res: Record<string, unknown>): TokenGrant {
  const accessToken = (res.access_token as string) ?? "";
  if (!accessToken) throw new Error("Provider token response missing access_token");
  return {
    accessToken,
    refreshToken: res.refresh_token as string | undefined,
    expiresInSeconds: res.expires_in as number | undefined,
    scopes: typeof res.scope === "string" ? res.scope.split(/[ ,]+/).filter(Boolean) : undefined,
    raw: res,
  };
}

export function normalizeInstance(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Instance URL must be the server root (e.g. https://mastodon.social)");
  }
  if (url.username || url.password) throw new Error("Instance URL must not contain credentials");
  assertSafeUrlShape(url);
  return `${url.protocol}//${url.host}`;
}
