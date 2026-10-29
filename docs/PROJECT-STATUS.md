# Project handoff — 29 October 2026

Universal search, feed media and profile-picture fixes are deployed at application revision
`a6ad9b4716b7fa48a761eb4176a5d6ad0f034ddd` on `codex/universal-search`, in
[PR #4](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/4).
Live account search, Bluesky/Facebook muted video autoplay and Facebook photos were verified.
The current release passed 258 application tests and 18 browser cases. All 72
active cached Facebook account posts have profile photos, and three real Page
images returned valid image data. See the
[profile-photo release report](ORACLE-PROFILE-PHOTOS-2026-10-29.md) and earlier
[production search/media report](ORACLE-SEARCH-MEDIA-RELEASE-2026-10-29.md).
Provider feed restrictions remain explicit in the product and coverage guide.

The full project is in [GitHub](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR) and live on Oracle at [app.myariahub.com](https://app.myariahub.com). The previous Stitch release was `1d017e373c143256f728d82ea07f61ba6f9857fc`, including Universal Feed and all eight Stitch screens. PR #1 is merged; PR #3 is ready for review and depends on PR #2. PR #4 builds on PR #3. Production secrets, databases, uploaded media and recovery material remain private runtime state. See the [Stitch deployment evidence](ORACLE-STITCH-DEPLOYMENT-2026-10-29.md) and the newer search/media report above.

## Universal Feed and Stitch UI (deployed)

The subsequent [Stitch UI implementation, PR #3](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/3)
is on `codex/stitch-redesign`, based on the Feed branch. It implements all eight
shared design screens, updates desktop/mobile navigation and preserves the real
Feed, accounts, publishing and Inbox services. Workspace switching now resolves
requests to the selected membership and recreates page/service state. A native
PostgreSQL fixture is available to browser CI because the local embedded socket
multiplexer can misroute concurrent protocol messages. See the
[screen mapping and verification notes](STITCH-REDESIGN.md). This UI and the
additive Feed migration are deployed on Oracle. The separate older Aria Hub
application and its services were preserved.

Branch `codex/universal-feed` adds `/feed`, seven categories, a stable mixed-content
API, personal bookmarks/follows/preferences, source controls, official players,
immersive video browsing and labelled isolated demo mode. Migration `0009` adds
eight tables; production now has 49. Existing records and media checksums were
preserved through the upgrade. The signed-in founder's existing Facebook
authorization was renewed after deployment, and its three authorized Pages
passed credential checks. Inbox synchronized real provider interactions.

Real public Bluesky discovery and YouTube URL oEmbed returned HTTP 200 in read-only
probes. mastodon.social rejected unauthenticated public timeline access with 422;
the app reports this and supports authorized instance sources. Other adapters are
fixture-verified capabilities, not new claims of live provider approval. TikTok
connection/publishing remains disabled; X/LinkedIn/Pinterest are link references.

Verification covers user/workspace boundaries, source/credential isolation, mixing,
duplicate native posts, cursor/session limits, saves/follows/hides, rate-limit
backoff, cache expiry and minimal saved-reference retention. The deployed
candidate passed 240 application tests, nine API browser cases, five demo browser
cases, 29 operations cases and four monitor cases. Publishing/feed load checks,
type checks, builds, audit and Linux container/migration/backup/restore CI passed.
Lint has zero errors and 46 existing warnings. ARM64 runtime images were built
on GitHub and their source, revision labels and checksums verified on Oracle.
See [actual capabilities and setup](UNIVERSAL-FEED.md).

## Deployed release evidence

The [29 October Feed readiness audit](FEED-PRODUCTION-VERIFICATION-2026-10-29.md)
adds real native-player verification, concurrent source-cap enforcement, preference
cleanup on removal, strict Bluesky moderation and a repeatable cached-feed load
check. Its pre-deployment disk blocker was resolved through the authorized
SehatAI cleanup and a build outside Oracle. Current deployment and live browser
evidence is recorded in the [Stitch deployment report](ORACLE-STITCH-DEPLOYMENT-2026-10-29.md).

- API/worker/web/PostgreSQL/Caddy healthy; named tunnel and nightly backup timer active.
- Unified Social Inbox deployed; mobile navigation scroll/dismiss/focus fix passes browser checks.
- Facebook published through composer/worker and replied through the live Inbox on the first attempt; Meta confirmed the reply text.
- Instagram publishing on @aria___hub passed on the first attempt. A real adapter comment/reply readback also passed. Both connected Instagram accounts now have verified comment-management grants and healthy synchronization.
- Deleted only the temporary Instagram acceptance post after explicit approval. Meta UI and authenticated readback confirm removal; delivery receipts and the cleanup audit remain preserved.
- Threads developer app published, credentials encrypted on Oracle and callback saved. Account login/connection and live delivery remain incomplete.
- Existing SMTP configured; approved test email and external monitor test alert accepted. Inbox receipt is unconfirmed.
- Both missing media originals recovered by exact stored checksums. Encrypted private Drive backups downloaded, hash-verified and restored into isolated PostgreSQL.
- Hourly encrypted Drive uploader automation active; requires the Windows computer and Codex. Oracle's nightly snapshot continues independently.
- GitHub public monitor configured every 15 minutes; manual public probes and alert passed. Oracle component/backup monitor enabled every five minutes with all checks passing.
- The prior release passed its full application/container CI with 187 application tests. The deployed Feed/Stitch release's larger verification suite is listed above.

The dated [production verification report](PRODUCTION-VERIFICATION-2026-10-28.md) records IDs, checksums, limitations and remaining public launch gates. [Operations](PRODUCTION-OPERATIONS.md) records backup and alert procedures.

## Where Claude stopped

| Commit | Completed work |
| --- | --- |
| `ac93788` | Hygiene, lint/typecheck scripts and dependencies |
| `57427eb` | Tenant isolation, auth/invites, webhook/security hardening |
| `342985e` | Durable publishing queue, leases, reconciliation, media/variants and refresh |
| `32a4e4a` | Auth/settings/team, Stripe integration, analytics, maintenance and legal pages |

Claude left unfinished Docker/Compose, manifests, lockfile and deployment/backup work. The continuation completed and validated those changes, deployed them with authorization, then added connection repair, real Meta protocol fixes, Unified Inbox, mobile navigation repair and production hardening. Original work and history were preserved.

Important hardening includes shared Postgres rate limits, private-address/SSRF protections, one-shot migrations, non-root containers, shared media storage, deployment/backup locking, corruption/unsafe-archive rejection, verified rollback revisions, real API defaults, no production simulated publishing, accurate billing/analytics failure states, and explicit Caddy reload/HTTPS enforcement.

## Remaining work

- Threads needs the intended profile's legitimate sign-in. Do not request its password in chat or bypass authentication. Connecting a fourth channel must honor the existing plan limit.
- Public Meta/other-platform approvals and independent legal/security review remain external gates. Unconfigured providers and unsupported Inbox integrations are not launch-ready.
- Confirm actual mailbox receipt and real account-email flows. Stripe stays disabled unless legitimately configured for paid plans.
- Verify unattended cloud-copy and scheduled public-monitor runs; retain another protected recovery-key copy. The current uploader cannot run while this computer/Codex is unavailable.
- Grow Oracle disk capacity before sustained usage and conduct a monitored soft launch.

## Continuing development

Use Node 24, `npm ci` and `npm run build:packages`. Follow AGENTS.md and bundled Next.js documentation before web changes. Run appropriate checks in isolated databases; never migrate local test fixtures against production.

For authorized Oracle deployment, preserve the external systemd tunnel with `ARIA_TUNNEL_MODE=external`. Only work under `/opt/ariahub-v2`; the independent older installation is separate. Read the actual deployed revision from `/opt/ariahub-v2/REVISION`. Recovery requires the matching encrypted archive and separately protected key. A restored worker stays paused until external deliveries after the snapshot have been reconciled.
