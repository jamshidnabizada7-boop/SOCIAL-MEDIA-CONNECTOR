# Developer App Setup Guide (Phase 0 deliverable)

Every provider needs a developer application before OAuth works. This document
lists exactly what to register, what to configure, and what to request. The
redirect URI to use everywhere (dev):

```
http://localhost:4100/v1/oauth/callback/{provider}
```

Production: `https://app.ariahub.co/v1/oauth/callback/{provider}`

Secrets go into `.env` (never committed) per `.env.example`. After registering
each app, record status in the Admin → Providers screen.

---

## No registration needed

- **Bluesky** — app passwords (or atproto OAuth client metadata hosting). Nothing to register.
- **Mastodon** — apps are registered programmatically per instance at connect
  time (`POST /api/v1/apps`). Zero manual work.

## Meta (Facebook Pages, Instagram, Threads) — one Meta app

1. Create app at developers.facebook.com → type **Business**.
2. Add products: **Facebook Login for Business**, **Instagram Graph API**, **Threads API**.
3. Configure Facebook Login → Valid OAuth Redirect URIs (both dev + prod).
4. Request permissions: `pages_show_list`, `pages_manage_posts`,
   `pages_manage_engagement`, `pages_read_engagement`, `publish_video`,
   `instagram_basic`, `instagram_content_publish`, `threads_basic`,
   `threads_content_publish`.
5. App Review + Business Verification required for advanced access. In
   Development Mode, only app admins/developers/testers can authorize.
6. Store as `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` (shared across the three
   Meta providers).

Status: **pending user registration + review** — dev-mode testing possible immediately.

## LinkedIn

1. Create app on developer.linkedin.com; add product **"Share on LinkedIn"** /
   Community Management API (current product names on the portal).
2. Redirect URLs as above. Verify the app (company page association).
3. Permissions: `w_member_social`, `w_organization_social`, `r_organization_social`.
4. `r_member_social` (reading member posts) is restricted — not needed for MVP.
5. Store as `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.

Status: **pending user registration**; org posting needs approved product access.

## TikTok

1. Create app on developers.tiktok.com → add **Content Posting API**.
2. Request scopes `user.info.basic`, `video.upload`, `video.publish`.
3. **Direct Post requires an app audit**; unaudited clients post privately
   (usable as a private sandbox). Plan the audit before public launch.
4. Sign the Content Posting/ToS agreement in the portal.
5. Store as `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.

Status: **pending registration + audit** — private-mode integration testable.

## YouTube (Google)

1. Google Cloud project → enable **YouTube Data API v3**.
2. OAuth consent screen in **Testing** mode → add your own account as test user
   (≤100 users allowed) → publishing works for those users without audit.
3. OAuth client: Web application, redirect URIs as above.
4. Store as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Quota: default 10,000 units/day (videos.insert ≈1600 → ~6 uploads/day);
   request more via the quota form when needed.

Status: **self-serve, ~15 minutes** — full integration testing possible today.

## X

1. Developer account at developer.x.com → project + app (docs now at docs.x.com).
2. **Pay-per-usage pricing (verified 2026-10-02):** no subscriptions, no free
   tier — credits are prepaid and deducted per request. **Post: Create costs
   $0.015 per request** ($0.20 with a URL attachment); post reads $0.005
   (capped at 3M/month). Budget accordingly and treat X as a metered
   destination in the product (usage counter + admin rate-limit panel).
3. OAuth 2.0 PKCE, redirect URIs as above; scopes
   `tweet.read tweet.write users.read offline.access`.
4. Store as `X_CLIENT_ID` / `X_CLIENT_SECRET`.

Status: **self-serve registration + prepaid credits** — register now, budget
per post.

## Pinterest

1. Create app on developers.pinterest.com (self-serve).
2. Redirect URIs as above; scopes `boards:read`, `pins:read`, `pins:write`,
   `user_accounts:read`.
3. Some features limited until app approval — Pin creation typically works
   immediately for the connected account.
4. Store as `PINTEREST_APP_ID` / `PINTEREST_APP_SECRET`.

Status: **self-serve** — testable today for the owner account.

---

## Registration checklist (for the user)

- [ ] Meta app + 3 products (Facebook Login for Business, IG Graph, Threads)
- [ ] LinkedIn app + Share on LinkedIn product
- [ ] TikTok app + Content Posting API (schedule audit)
- [ ] Google Cloud project + YouTube Data API v3 (Testing consent mode)
- [ ] X app (decide API tier)
- [ ] Pinterest app
- [ ] Generate `ARIA_ENCRYPTION_KEY` (`openssl rand -hex 32`) and set in `.env`
- [ ] Fill provider client id/secret pairs into `.env`
- [ ] Record per-provider status in Admin → Providers (API version, review state)
