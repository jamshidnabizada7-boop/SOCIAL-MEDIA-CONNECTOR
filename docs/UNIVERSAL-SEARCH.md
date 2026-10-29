# Universal social search

The global desktop search bar, mobile search button, navigation and command palette
open `/search`. Search a name, handle, phrase or topic, then filter loaded results
by People & accounts, Posts, Videos, Topics and platform. Filters do not issue
additional provider calls. Profile and original-content links open the provider.
Adding a supported creator to Feed is an explicit separate action; searching does
not follow, subscribe, publish or send a message.

## Coverage

| Platform | Results inside Aria Hub | Wider search |
| --- | --- | --- |
| Bluesky | Public account and post search, with moderation labels enforced | Native search link |
| Mastodon | Public account/topic search on up to three selected servers; posts depend on server access and an authorized `read:search` token | Native search link |
| YouTube | Public channel and video search when `YOUTUBE_DATA_API_KEY` is configured; only public embeddable videos | Native search link without a key |
| Facebook, Instagram, Threads | Accessible collected content, its creators and healthy connected accounts in the selected workspace | Native search link for wider discovery |
| TikTok, X, LinkedIn, Pinterest | No unrestricted in-app directory/content search is claimed | Native search link |

These distinctions are displayed with results. A provider outage or rate limit
does not turn into demo data or prevent other providers returning their results.
The isolated demo is explicitly labelled and never calls a social API.

## API and privacy

`POST /v1/workspaces/:workspaceId/feed/search/all` takes `{ "query": "NASA" }`.
It requires authenticated workspace membership and a printable query of 2–120
characters. Search uses bounded parallel official HTTPS reads, existing host/DNS
guards, six-second upstream timeouts and response-size limits. Mastodon remote
resolution is disabled. Credentials are sent only to their exact authorized
instance, never returned or retained in result-cache entries.

Collected content is rechecked against the current user's enabled sources,
workspace, healthy account access, expiry, hides, mutes and sensitive-content
preferences. Other users' personal sources and other workspaces are excluded.
The endpoint does not expose an Aria Hub user/email directory or persist queries
as feed subscriptions. Live-only results have a bounded 45-second cache keyed by
user, workspace, query and provider scope. Membership is rechecked before cache
access. Requests are limited to eight per minute; provider Retry-After backoff
also applies across different queries.

Responses contain at most 40 accounts, 48 posts/videos and 15 topics. Counts are
loaded matches, not exhaustive provider totals. There is no scraping, native
like/follow simulation or promise to reproduce private social timelines.

## Verification

Provider fixtures cover official account/post normalization, moderation,
Mastodon privacy and token-origin checks, partial failures, YouTube configuration,
public/embeddable restrictions and encoded native links. API tests cover tenant
and user isolation, revoked membership, invalid inputs, no implicit subscriptions
and provider backoff. Browser tests cover global/mobile entry, people and content,
filters without refetch, native fallbacks, API errors without demo fallback and
320–1280px layouts. Live checks are read-only and record actual provider outcomes.

Official references: [Bluesky actor search](https://docs.bsky.app/docs/api/app-bsky-actor-search-actors),
[Mastodon search](https://docs.joinmastodon.org/methods/search/),
[YouTube search](https://developers.google.com/youtube/v3/docs/search/list).
