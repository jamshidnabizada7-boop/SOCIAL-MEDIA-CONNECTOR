# Provider Capability Matrix — verified 2026-09-30

Legend: **✅** = verified today against official provider documentation (source linked).
**⚠️** = widely documented, carried from prior knowledge — **must be re-verified against
official docs before the adapter for that provider is implemented.** Never rely on ⚠️
values in shipped code; the capability registry is the single source of truth and each
entry carries its own `verifiedAt`.

---

## Meta — Facebook Pages ✅

| Capability | Verified value | Source |
|---|---|---|
| Publish endpoint | `POST /{page-id}/feed` (text/link), `POST /{page-id}/photos`, video via Video API | [Posts API](https://developers.facebook.com/docs/pages-api/posts) |
| Permissions | `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `publish_video` (video) + Page tasks CREATE_CONTENT/MANAGE/MODERATE | same |
| Scheduled publishing | `published=false` + `scheduled_publish_time`; **10 minutes – 30 days ahead** | same |
| Edit / delete | Both supported; **an app can only edit posts it created itself** | same |
| Current API version | **v25.0** (docs examples) | same |
| Account types | Pages only. Personal profiles are NOT supported for publishing | platform policy |
| Rate limits | Page-level throttling (BUC) — ⚠️ exact headers re-verify at implementation | — |
| Notes | Photo `POST /photos` returns `id` + `post_id`. Best practice: never pass access_token as URL param. | same |

## Meta — Instagram (Graph API) ✅

| Capability | Verified value | Source |
|---|---|---|
| Publish flow | 2-step: `POST /{ig-user-id}/media` (container) → `POST /{ig-user-id}/media_publish` (`creation_id`) | [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| Container status | `GET /{container-id}?fields=status_code` → `IN_PROGRESS / FINISHED / EXPIRED / ERROR / PUBLISHED`; poll ≤1/min, ≤5 min | same |
| Permissions (FB Login) | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` | same |
| Permissions (IG Login) | `instagram_business_basic`, `instagram_business_content_publish`; host `graph.instagram.com` | same |
| Eligible accounts | Business/Creator **linked to a Facebook Page** | same |
| Rate limit | **100 API-published posts / 24h** moving window (carousels count as 1); check via `GET /{ig-user-id}/content_publishing_limit`. (Doc internally shows one 50/24h mention in carousel section — treat 100 as primary, re-verify) | same |
| Images | **JPEG only**; publicly hosted URL or resumable upload (FB Login only) | same |
| Carousel | max **10 items**, mixed image/video; images cropped to first image's ratio | same |
| Alt text | `alt_text` field on `/media` (added 2025-03-24); images only | same |
| AI disclosure | `is_ai_generated` (carousel container only) | same |
| Branded content | `branded_content_sponsor_ids` (≤2), `is_paid_partnership` — FB Login only, professional accounts | same |
| Trial reels | `trial_params` with graduation strategy | same |
| Video duration/size | ⚠️ (Reels ≤15 min, ≤1 GB commonly documented — re-verify at adapter build) | — |

## Meta — Threads ✅

| Capability | Verified value | Source |
|---|---|---|
| Content | text, image, video, carousel, quotes, reposts | [Create Posts](https://developers.facebook.com/docs/threads/create-posts) |
| Permissions | `threads_basic`, `threads_content_publish` | same |
| App review | Until advanced access approved: posting limited to your own account + app testers | same |
| Fediverse sharing | API posts shared to fediverse for opted-in users (since 2024-08-28) | same |
| Details (500-char text, 20 media, 5-min video, container flow, rate limits) | ⚠️ re-verify at adapter build (page didn't expose numbers) | — |

## LinkedIn ✅

| Capability | Verified value | Source |
|---|---|---|
| Create post | `POST https://api.linkedin.com/rest/posts` (JSON; `author` = member or org URN) | [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) |
| Headers | `LinkedIn-Version: YYYYMM` (current moniker **202609**) + `X-Restli-Protocol-Version: 2.0.0` | same |
| Permissions | Org posting: `w_organization_social` (+ page role ADMINISTRATOR/CONTENT_ADMIN/DSC_POSTER). Member posting: `w_member_social`. Reads: `r_*_social` (member reads restricted) | same |
| Content types (organic) | text, images, **MultiImage**, video, documents, article (no URL scraping — fields set by partner), poll, celebration. **Carousels are sponsored-only** | same |
| Media upload | registerUpload flow per asset type (Images/Videos/Documents APIs) → URN used in post | same |
| Update | Partial update of `commentary` (+CTA fields); `lifecycleState` includes `PUBLISH_REQUESTED`/`PUBLISH_FAILED` async states | same |
| Delete | Supported, idempotent; batch delete NOT supported | same |
| Versioning | Ranged versions; **202510 sunsets 2026-10-15** — pin newest and track migrations | same |
| Commentary limit (3000) | ⚠️ re-verify at adapter build | — |
| Editing published posts | Supported per above (commentary field) | ✅ |

## TikTok ✅ (core), ⚠️ (limits)

| Capability | Verified value | Source |
|---|---|---|
| Direct Post | `POST /v2/post/publish/video/init/` → `FILE_UPLOAD` (chunked PUT) or `PULL_FROM_URL` (verified domains only) | [Direct Post](https://developers.tiktok.com/doc/content-posting-api-get-started) |
| Photo posts | `POST /v2/post/publish/content/init/` with `post_mode=DIRECT_POST`, `media_type=PHOTO`, `photo_images[]` (verified-domain URLs) | same |
| Status | `POST /v2/post/publish/status/fetch/` with `publish_id` | same |
| Creator query | `POST /v2/post/publish/creator_info/query/` — returns `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec` (e.g. 300) | same |
| Privacy | Values like `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY` — **must come from the creator query, never assumed** | same |
| Unaudited apps | Content restricted to **private viewing** until the client passes audit; unaudited flow = effectively upload-as-draft/private | same |
| Scope | `video.publish` required (approve for app); `video.upload` for draft flows | same |
| Webhooks, title limits, AI disclosure fields, size caps | ⚠️ re-verify at adapter build | — |

## YouTube ✅ (upload flow verified 2026-10-02), ⚠️ (quota numbers)

| Capability | Value | Status |
|---|---|---|
| Upload | `videos.insert` with resumable upload (MediaFileUpload resumable=True); body = `snippet` (title, description, tags, categoryId) + `status` (privacyStatus) | ✅ [Uploading a video](https://developers.google.com/youtube/v3/guides/uploading_a_video) |
| Scope | `https://www.googleapis.com/auth/youtube.upload` | ✅ same |
| privacyStatus | `public`, `private`, `unlisted` | ✅ same |
| Resumable retry | Exponential backoff on 500/502/503/504, up to 10 retries | ✅ same |
| Category | `snippet.categoryId` (default 22 = People & Blogs) | ✅ same |
| Title ≤100 chars, selfDeclaredMadeForKids, thumbnails.set, file-size caps | ⚠️ re-verify at adapter build | — |
| Quota | videos.insert ≈1600 units; default 10,000/day (~6 uploads) — ⚠️ re-verify | — |
| API audit | Public auto-publish requires compliance audit; Testing consent mode (≤100 test users) is the immediate path — ⚠️ re-verify current policy | — |

## X ✅ (pricing model verified 2026-10-02 — major change), ⚠️ (scopes/media)

| Capability | Value | Status |
|---|---|---|
| **Pricing model** | **Pay-per-usage — the old Free/Basic/Pro subscription tiers are gone.** Credits purchased upfront, deducted per request. **Post: Create = $0.015/request** ($0.20 with URL attachment); post reads $0.005 (cap 3M/month) | ✅ [Pricing](https://docs.x.com/x-api/getting-started/pricing) |
| No free tier | Only bonus credits on prepaid balance (10–20% back in xAI credits) | ✅ same |
| Business impact | Per-post cost is real money — the product must treat X as a metered destination (usage counter + admin rate-limit panel) | ✅ derived |
| Posting endpoint, OAuth 2.0 PKCE scopes, 280 chars, 4 images/1 video | ⚠️ re-verify at adapter build (docs moved to docs.x.com) | — |

## Pinterest ⚠️

| Capability | Value |
|---|---|
| Create Pin | ⚠️ `POST /v5/pins`; requires `board_id` — board selection is a first-class requirement (reference page is JS-rendered; could not verify — re-verify at adapter build) |
| Media | ⚠️ image/video; upload via media asset flow or hosted URL |
| Auth | ⚠️ OAuth; scopes `pins:read pins:write boards:read` |
| Notes | Verification attempted 2026-10-02 — docs SPA blocked fetching. Re-verify at adapter build |

## Bluesky ⚠️ (docs unreachable 2026-10-02 — TLS/DNS change on docs.bsky.app)

| Capability | Value |
|---|---|
| Auth | **No app review.** App passwords work immediately (in active use by the Phase 2 adapter and verified by a live rejection path); atproto OAuth (DPoP) is the modern path — verify current state at implementation |
| Publish | ⚠️ `com.atproto.repo.createRecord` for `app.bsky.feed.post`; text ≤300 graphemes; facets for links/mentions/tags |
| Media | ⚠️ `uploadBlob` + alt text; image/video caps — verify exact bytes at adapter build |
| Analytics | **Not exposed by the protocol** — UI must show N/A (never zero) |
| Edit | Not supported (delete + repost) |
| Notes | Verification attempted 2026-10-02: docs.bsky.app cert now resolves to bsky.network hosts (infra change); GitHub raw path 404. The Phase 2 adapter's live behavior (createRecord shape, 300-char validation) matched expectations; re-verify remaining numbers when docs are reachable |

## Mastodon ✅

| Capability | Verified value | Source |
|---|---|---|
| Publish | `POST /api/v1/statuses` — `status`, `media_ids[]`, `visibility` (public/unlisted/private/direct), `language`, `sensitive`, `spoiler_text` | [statuses](https://docs.joinmastodon.org/methods/statuses/) |
| **Idempotency** | **`Idempotency-Key` header supported, stored up to 1 h** — use it for duplicate protection | same |
| **Scheduling** | `scheduled_at` (server-side scheduling!); **min 5 minutes ahead** | same |
| Edit / delete | `PUT /api/v1/statuses/:id` (since 3.5.0), `DELETE` (+ media retained ~24 h) | same |
| Scopes | `write:statuses`, `write:media` (granular scopes) | same |
| Quotes | `quoted_status_id` (v4.5.0) | same |
| Instance variability | Character limit (500 default), media caps, rate limits are **instance-configurable** — read from `/api/v2/instance` at connect time; never hardcode | platform trait |
| Auth | Self-serve app registration per instance (`POST /api/v1/apps`); no review |

---

## Immediate testability verdict

| Provider | Can be integration-tested TODAY (no approval)? | Path |
|---|---|---|
| Bluesky | **YES** | app password on a real account |
| Mastodon | **YES** | register an app on any instance (e.g. mastodon.social) in minutes |
| YouTube | **YES (limited)** | Google Cloud project in "Testing" mode; own account as test user (≤100 users) |
| X | **YES (paid per post)** | Pay-per-usage: $0.015 per post create — needs prepaid credits, no free tier |
| Facebook Pages | **NO (limited)** | App creation instant; publish perms need App Review — dev-mode works only for app-role Page testers |
| Instagram | **NO (limited)** | Same Meta review; requires Business account + linked Page; testers-only in dev mode |
| Threads | **NO (limited)** | Same Meta review; own account + testers until approved |
| LinkedIn | **NO (limited)** | Products requestable instantly but `w_member_social` starts restricted; org posting needs approval |
| TikTok | **NO** | Direct Post needs audit; unaudited posts are private-only (usable as private sandbox) |
| Pinterest | **PARTIAL** | App creation self-serve; some features limited pre-approval |

**Recommended adapter build order:** Bluesky → Mastodon → YouTube (test mode) →
Facebook/Instagram/Threads (Meta review in parallel) → LinkedIn → Pinterest →
TikTok (audit in parallel) → X (business decision on API tier cost).
