# Universal Feed

Implemented in the existing app at `/feed`, alongside publishing and Social Inbox.
Deployed on Oracle with the Stitch UI at application revision
`d75bbb80cbd83d81de0e9c34ed5b8734a3d1bab0`, including universal search, Bluesky
autoplay and Facebook Page media. Migration `0009` added eight tables;
production has 49. See [live deployment evidence](ORACLE-SEARCH-MEDIA-RELEASE-2026-10-29.md).

## What works

The browser reads a personal, mixed metadata pool from Fastify. A separate bounded
worker retrieves permitted content through official endpoints. Scrolling reads the
database, rather than calling every provider. API failures stay errors; they never
turn into demo content.

Seven categories use the same authorized pool:

| Category | Data |
| --- | --- |
| For You | Aria Hub's weighted mix of enabled public and authorized sources |
| Following / Creators | Creators followed in Aria Hub and explicitly added authorized following timelines |
| Videos | Normalized video content, with immersive vertical browsing or cards |
| Posts | Text, images, carousels and links, excluding videos |
| My Accounts | Accessible publications from healthy connected accounts |
| Saved | Personal Aria Hub bookmarks; expired content becomes a minimal original-link reference |
| Explore | Enabled sources filtered by collected keywords, platform, format or source topic |

The search box searches collected metadata. Add a **Search / topic** source to run
a supported upstream keyword/hashtag search. Topic labels are assigned explicitly
when subscribing to a source, not inferred from inaccessible recommendation data.

Saves, follows, hides, unavailable reports, preferred networks, interests and
"see fewer" signals belong to the signed-in user. They do not perform native
social actions. Likes/comments/shares are display-only metrics when actually
returned; unknown values remain null. Native actions open the original network.

## Actual provider coverage

| Provider | Enabled retrieval | Playback/display | Required access or limits |
| --- | --- | --- | --- |
| Bluesky | Public feed generators, author feeds, search, own posts, authorized following timeline, post URL | Public provider-owned HLS video plays muted in view; official embed fallback; attributed text/images | Public AppView needs no login. Following/own account uses its authorized PDS. Autoplay can be disabled; browser reduced-motion and data-saving settings are respected. |
| Mastodon | Public/local timeline, hashtag, author, own statuses, authorized home timeline, status URL | Public images/text; video opens on original instance | Only public statuses. Many instances require authorization even for public timelines. mastodon.social returned HTTP 422 without login in the live probe; the app reports this limitation. |
| YouTube | Public recent/search/channel results via Data API; authorized channel content; public URL oEmbed | Official privacy-enhanced YouTube player | Discovery needs server-side `YOUTUBE_DATA_API_KEY`; account reads need YouTube authorization. A read-only public URL oEmbed probe returned HTTP 200 video metadata without a key. Only public embeddable videos enter discovery. No claim that duration identifies Shorts. |
| TikTok | Authorized creator Video List adapter; public video URL oEmbed | Official TikTok Embed Player `/player/v1/{id}` | Video List needs approved Display API/Login Kit and `video.list`. Existing connection/publishing remains disabled pending its real approved connection flow. Public URL support does not provide TikTok For You. |
| Instagram | Authorized professional-account media; validated post URL reference | Attributed image/thumbnail or original link; video opens on Instagram | Existing Facebook Login integration and appropriate reviewed permissions. Arbitrary consumer feeds, hashtag/business discovery and arbitrary embeds are not enabled. |
| Facebook | Authorized Page `published_posts`, photo/album/video attachment metadata; validated post and Reel references | Photo/album images and previews; native provider-owned MP4 video with official player/original-link fallback | Page token and `pages_read_engagement`. Content is labelled as coming from connected Pages. Personal Home feeds and unrestricted other-user timelines are unavailable. |
| Threads | Authorized profile posts; validated post URL reference | Attributed metadata/preview and original link | `threads_basic` and legitimate connected profile. Configured app credentials alone do not constitute an account connection. |
| X | Validated public post link references | Original link, clearly preview-only | No metered timeline API is enabled and no paid X discovery calls are made. |
| LinkedIn | Validated public post link references | Original link, clearly preview-only | No general home feed API; reviewed organization/member retrieval is not enabled. |
| Pinterest | Validated public Pin link references | Original link, clearly preview-only | Board/Pin API discovery is not enabled without reviewed access and visibility verification. |

Ten providers have capability entries; this is not a claim that all ten expose
general discovery APIs. Link references contain no invented caption, author,
date or engagement. Missing publication dates remain null (for example oEmbed).

Instagram hashtag/business discovery was investigated against Meta's published
Facebook Login documentation and official API collection. Meta documentation
requests returned 429 during this run, so current review eligibility could not be
independently confirmed. These endpoints remain gated rather than assuming access.
Future enablement requires checking the selected login product, professional
account eligibility, Instagram Public Content Access/App Review and actual granted
permissions in a separately authorized configuration task.

## Local setup

Follow README local development instructions, build shared packages and apply
migrations only to the intended local database. Run API, web and worker together.
Use explicit `NEXT_PUBLIC_DATA_MODE=api` for real persisted data.

Optional API/worker environment:

```dotenv
# Server-side only, never NEXT_PUBLIC. Restrict to the intended YouTube API/project.
YOUTUBE_DATA_API_KEY=
# false skips the default personal Bluesky/Mastodon public subscriptions.
ARIA_FEED_DEFAULTS=true
```

Sources & preferences shows connection health, source errors, permitted source
types, account selection and platform requirements. Public discovery does not
require connecting a publishing account. Account sources still require a healthy
connection and active membership of its workspace. OAuth credentials are resolved
through the existing encrypted vault/single-flight refresh helper.

Default discovery subscriptions and own-account subscriptions can be paused.
Optional sources can be removed after the UI explains that their local cached
posts, bookmarks and associated creator follow will also be removed. No original
platform content is deleted. Sources are limited to 30 per user. Following an
accessible Bluesky/Mastodon/YouTube creator adds a creator subscription when its
provider-native ID is available; other follows filter already accessible content.

## Mixer, pagination and synchronization

- Deduplicate by provider/native post ID before mixing. Recency, preferred network
  and source topic increase weights; reduced sources and recently returned items
  lower weights. A seeded weighted shuffle interleaves providers and creators
  whenever alternatives exist. A single available provider remains valid.
  Bookmarks and hidden signals apply across copies of the same native post from
  different sources; Saved displays one reference and unsave removes all personal
  copies of that bookmark.
- Persist at most 600 ordered IDs in a 30-minute browsing session. Cursors bind to
  user, workspace and filters; availability/access/hides are checked again for
  every page. Changing filters starts a new session. Keep the 20 most recent
  sessions per user/workspace; normal concurrent requests can briefly exceed this
  until subsequent cleanup. Expired sessions are removed by maintenance.
- Each feed cycle claims at most four sources, every 15 seconds, with atomic
  conditional three-minute leases. Upserts preserve item IDs and avoid duplicates.
  Feed work runs independently of publishing and Inbox queues.
- Refresh bounded recent source windows (up to 50 items per read cycle; individual
  endpoints may return fewer), every 15 minutes or hourly for YouTube. This is a
  recent cached feed, not an unbounded historical provider archive. Pagination
  loads additional cached items; upstream windows refresh in the background.
- Metadata expires after two hours. Unsaved expired rows are removed after seven
  days. Saved expired items retain their original-link reference but no cached
  caption/image/player is returned; daily maintenance also strips that metadata
  from storage (within the next maintenance cycle). There is no downloaded video storage.
- Respect Retry-After/backoff. Pausing/resuming never resets retry deadlines;
  manual refresh only expedites a healthy idle source last synced at least five
  minutes ago. HTTP 401/403/404/410 expires affected cache. Other failures cannot
  keep stale metadata visible indefinitely. Deletions not individually notified by
  an upstream API are bounded by this cache expiry, not detected instantaneously.
- Source failures expose sanitized explanations, never provider response payloads,
  tokens or server keys. No paid API is automatically enabled.

## API and data ownership

Routes use `/v1/workspaces/:workspaceId/feed` with the existing active-membership
guard. Public subscriptions are personal; connected-account subscriptions also
carry a composite account/workspace foreign key. Every item/source operation
checks personal ownership and the current workspace/account authorization.

```text
GET    /                         # filters, stable cursor
GET    /videos, /discover, /search, /saved
GET    /sources
POST   /sources
PATCH  /sources/:sourceId         # enabled only
DELETE /sources/:sourceId         # owned optional sources only
POST   /sync
GET    /preferences
PUT    /preferences
DELETE /preferences              # preferences + hidden/reported signals
POST   /saved                    # itemId
DELETE /saved/:itemId
POST   /hide                     # itemId, optional report
GET    /following
POST   /following                # itemId, derive authorized creator
DELETE /following/:itemId
```

Authenticated `/v1/me/feed/preferences` GET/PUT aliases address the same personal
preferences. Reset leaves bookmarks and follows intact; unsave/unfollow controls
manage them independently. Account deletion cascades personal feed data. Workspace
deletion cascades its account sources; it does not erase unrelated personal public
subscriptions. Workspace exports do not disclose teammates' personal feed records.

Tables: `feed_sources`, `feed_items`, `feed_preferences`, `feed_follows`,
`feed_saved`, `feed_interactions`, `feed_sync_state`, `feed_sessions`.
Migration is additive and forward-only. It was applied on Oracle under the
operations lock after a quiesced pre-upgrade backup.

## Media and privacy

HTTPS URL validation rejects credentials, custom ports, private-address shapes,
wrong host suffixes and unsupported post paths. Instance requests additionally use
the existing DNS/public-host guard. Redirects are rejected and metadata responses
are streamed with a 2 MB limit and timeout. Raw provider HTML and iframe markup
are discarded; captions render as text.

Only exact official YouTube, TikTok and Bluesky player origins/paths are enabled.
External players default to click-to-load. An explicit preference can allow the
active video to load; inactive/offscreen players unmount. Native player controls
provide supported play/pause/mute/fullscreen behavior. Autoplay is not required.
Providers may still block playback; original links remain available. No HLS/MP4
stream extraction, media proxy or rehosting is used. Images load directly from
permitted external references and degrade to a placeholder on failure.

The immersive view supports native touch scrolling/snap, next/previous buttons,
keyboard arrows and browser fullscreen when supported. It does not promise a
uniform cross-provider playback-control API. Tab navigation supports arrows and
Home/End. Existing desktop/mobile navigation is retained.

Demo mode is explicit, with a page banner and per-card Sample labels. Its 70
samples, bookmarks and preferences stay in user/workspace-scoped localStorage;
it never contacts provider APIs or loads real players. API mode has no demo fallback.

## Verification

The follow-up [production-readiness audit](FEED-PRODUCTION-VERIFICATION-2026-10-29.md)
records real YouTube/Bluesky playback, feed-specific load results and additional
source/moderation hardening. Bluesky's official embed contains the complete post;
long captions can require scrolling within that embed to reach its video controls.
The UI explains this. Restrictive global moderation labels and age-restricted
Bluesky labels are excluded from these public display paths, including when
"Include content marked sensitive" is enabled. Public link-only references do not
offer a creator follow without verified creator metadata.

The automated story covers browser → authenticated API → isolated database →
worker → local official-response fixtures → normalized response → mixed feed.
Automated tests do not publish real social posts or call paid provider APIs.

| Boundary | Evidence |
| --- | --- |
| UI → API | Desktop and mobile Playwright cases use authenticated API mode; no page errors or demo fallback |
| API → data | Fresh forward migrations, persisted bookmarks/follows, ownership and revoked-access tests |
| Worker → providers | Bounded local response fixtures through the real read adapters; independent Bluesky/YouTube public HTTP 200 probes |
| Normalized response → UI | Mixed provider cards, filter results, duplicate-free continuation and saved state after reload |
| Players | Exact official URL and one-player teardown tested with fixture iframe content; real playback remains a separate release check |

Initial acceptance (`7313891`): 232 application tests, seven API browser cases, two demo browser
cases, 25 operations tests and four monitor tests passed. Package/API/worker/web
builds and type checks passed; lint has zero errors and 48 existing warnings.
The 1,000-post isolated load test found zero duplicates; production dependency audit
found zero vulnerabilities. Docker is unavailable locally, so Linux container,
migration and backup/restore checks run in GitHub Actions before release acceptance.

- Provider/mixer tests cover normalization, official player paths, unknown metrics,
  scopes, credential origin isolation, public visibility, response limits, unsafe
  URLs, deterministic mixing and deduplication.
- API/worker tests apply fresh migrations and cover user/workspace isolation,
  stable cursors, revoked membership/connections, source controls, preferences,
  saving/following/hiding, expired metadata, leases, Retry-After and retention.
- Service tests verify demo persistence/isolation and that API failure never
  substitutes invented content.
- Desktop/mobile browser tests verify mixed content, stable scrolling, persisted
  bookmarks/follows, mobile drawer dismissal, official player URL/single-player
  cleanup, keyboard browsing, failure states and labelled demo behavior.
- Existing publishing, billing and Inbox regressions remain in the test suite.
  Publishing uses a local Bluesky fixture and checks exactly one delivery.

See the current change's verification results in [project status](PROJECT-STATUS.md).
Screenshot evidence is generated in `.local/feed-evidence/` and uploaded by CI
alongside normal browser traces. Fixture player HTML proves lifecycle/URL wiring,
not real provider playback or account approval. The independent public Bluesky
probe confirmed real retrieval; Mastodon confirmed the authorization failure path.

For release acceptance, an authorized operator must configure only approved
sources, verify native playback in the intended browser with legitimate accounts,
check quotas, apply the reviewed migration and deploy the reviewed build. This
task did not change production OAuth settings, create native posts or deploy.

## Official references

- [Bluesky public AppView](https://public.api.bsky.app/) and
  [official embed implementation](https://embed.bsky.app/static/embed.js)
- [Mastodon timelines](https://docs.joinmastodon.org/methods/timelines/) and
  [account statuses](https://docs.joinmastodon.org/methods/accounts/#statuses)
- [YouTube search](https://developers.google.com/youtube/data/reference/rest/v3/search/list),
  [video details](https://developers.google.com/youtube/data/reference/rest/v3/videos/list),
  [player API](https://developers.google.com/youtube/iframe_api_reference)
- [TikTok Display API](https://developers.tiktok.com/doc/display-api-get-started/),
  [Video List](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/),
  [Embed Player](https://developers.tiktok.com/doc/embed-player/)
- [Meta Instagram API collection](https://www.postman.com/meta/instagram/overview),
  [Instagram hashtag search](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search/),
  [business discovery](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/)
