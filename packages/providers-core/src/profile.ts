import { fetchJson, type FetchLike } from "./http.js";
import type { ProviderId } from "@aria/shared-types";
import { mastodonVerifyCredentials } from "./mastodon.js";

export interface FetchedProfile {
  externalAccountId: string;
  displayName: string;
  handle: string;
  /** Known follower count when the provider exposes one. */
  followers?: number | null;
  /** Provider-side account token (e.g. Facebook Page access token). */
  accessToken?: string;
  /** facebook_pages can yield several pages — one account row per page. */
  extra?: Array<{
    externalAccountId: string;
    displayName: string;
    handle: string;
    followers?: number | null;
    accessToken?: string;
  }>;
}

/**
 * Post-token profile fetchers. Facebook/Instagram/Threads/LinkedIn endpoints
 * verified 2026-09-30; the rest follow their documented stable shapes and are
 * re-verified at each provider's adapter pass. All failures throw — callers
 * translate errors into connection notes rather than half-creating accounts.
 */
export async function fetchProfile(
  provider: ProviderId,
  accessToken: string,
  opts?: { instanceUrl?: string; fetchImpl?: FetchLike }
): Promise<FetchedProfile> {
  switch (provider) {
    case "facebook": {
      // access_token here is the Page access token — the only token that can
      // publish to the Page. followers_count covers New Pages Experience;
      // fan_count is the classic Pages field.
      const res = await fetchJson<{
        data: Array<{ id: string; name: string; access_token?: string; fan_count?: number; followers_count?: number }>;
      }>(
        "Facebook",
        "https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,fan_count,followers_count&limit=20",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      const pages = res.data ?? [];
      if (pages.length === 0) {
        throw Object.assign(new Error("No Facebook Pages are manageable by this account. Publishing requires a Page."), {
          code: "no_pages",
        });
      }
      const first = pages[0];
      return {
        externalAccountId: first.id,
        displayName: first.name,
        handle: `facebook.com/profile.php?id=${first.id}`,
        followers: first.followers_count ?? first.fan_count ?? null,
        accessToken: first.access_token,
        extra: pages.slice(1).map((p) => ({
          externalAccountId: p.id,
          displayName: p.name,
          handle: `facebook.com/profile.php?id=${p.id}`,
          followers: p.followers_count ?? p.fan_count ?? null,
          accessToken: p.access_token,
        })),
      };
    }
    case "instagram": {
      const res = await fetchJson<{ user_id?: string; id?: string; username?: string }>(
        "Instagram",
        "https://graph.facebook.com/v23.0/me?fields=user_id,username",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      const id = res.user_id ?? res.id ?? "";
      return { externalAccountId: id, displayName: res.username ?? "Instagram account", handle: `@${res.username ?? id}` };
    }
    case "threads": {
      const res = await fetchJson<{ id: string; username: string }>(
        "Threads",
        "https://graph.threads.net/v1.0/me?fields=id,username",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      return { externalAccountId: res.id, displayName: res.username, handle: `@${res.username}` };
    }
    case "linkedin": {
      const res = await fetchJson<{ sub: string; name?: string; email?: string }>(
        "LinkedIn",
        "https://api.linkedin.com/v2/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      return {
        externalAccountId: res.sub,
        displayName: res.name ?? "LinkedIn member",
        handle: `linkedin.com/in/${res.sub}`,
      };
    }
    case "tiktok": {
      const res = await fetchJson<{ data?: { user?: { open_id?: string; display_name?: string } } }>(
        "TikTok",
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      const user = res.data?.user;
      if (!user?.open_id) throw new Error("TikTok profile unavailable for this token");
      return {
        externalAccountId: user.open_id,
        displayName: user.display_name ?? "TikTok creator",
        handle: `@${user.display_name ?? user.open_id}`,
      };
    }
    case "youtube": {
      const res = await fetchJson<{ items?: Array<{ id: string; snippet: { title: string; customUrl?: string } }> }>(
        "YouTube",
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      const channel = res.items?.[0];
      if (!channel) throw new Error("No YouTube channel is associated with this Google account");
      return {
        externalAccountId: channel.id,
        displayName: channel.snippet.title,
        handle: channel.snippet.customUrl ? `youtube.com/${channel.snippet.customUrl}` : `youtube.com/channel/${channel.id}`,
      };
    }
    case "x": {
      const res = await fetchJson<{ data: { id: string; name: string; username: string } }>(
        "X",
        "https://api.x.com/2/users/me",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      return { externalAccountId: res.data.id, displayName: res.data.name, handle: `@${res.data.username}` };
    }
    case "pinterest": {
      const res = await fetchJson<{ id?: string; username?: string; business_id?: string }>(
        "Pinterest",
        "https://api.pinterest.com/v5/user_account",
        { headers: { Authorization: `Bearer ${accessToken}` }, fetchImpl: opts?.fetchImpl }
      );
      const id = res.business_id ?? res.id ?? "";
      return { externalAccountId: id, displayName: res.username ?? "Pinterest account", handle: `pinterest.com/${res.username ?? ""}` };
    }
    case "mastodon": {
      if (!opts?.instanceUrl) throw new Error("Mastodon account missing instance URL");
      const acct = await mastodonVerifyCredentials(opts.instanceUrl, accessToken, { fetchImpl: opts.fetchImpl });
      const host = new URL(opts.instanceUrl).host;
      return {
        externalAccountId: acct.id,
        displayName: acct.display_name || acct.username,
        handle: `@${acct.username}@${host}`,
      };
    }
    case "bluesky":
      // App-password flow resolves identity at connect time (createSession.did/handle).
      throw new Error("Bluesky identity is resolved during app-password connect");
  }
}
