# Project handoff — 28 October 2026

The full project is in [GitHub master](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR) and live on Oracle at [app.myariahub.com](https://app.myariahub.com). The deployed application revision is `df68e34577878b09df0f313562fff5c630054826`; later documentation and GitHub monitor-schedule changes do not change application code. PR #1 is merged. Production secrets, databases, uploaded media and recovery material remain private runtime state.

## Universal Feed development (not deployed)

The subsequent [Stitch UI implementation, PR #3](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/3)
is on `codex/stitch-redesign`, based on the Feed branch. It implements all eight
shared design screens, updates desktop/mobile navigation and preserves the real
Feed, accounts, publishing and Inbox services. Workspace switching now resolves
requests to the selected membership and recreates page/service state. A native
PostgreSQL fixture is available to browser CI because the local embedded socket
multiplexer can misroute concurrent protocol messages. See the
[screen mapping and verification notes](STITCH-REDESIGN.md). This UI change has
not changed Oracle's application, database or provider settings.

Branch `codex/universal-feed` adds `/feed`, seven categories, a stable mixed-content
API, personal bookmarks/follows/preferences, source controls, official players,
immersive video browsing and labelled isolated demo mode. Migration `0009` adds
eight tables (49 in the new source; production remains at 41). No production
database, OAuth settings or native posts were changed by this feature task.

Real public Bluesky discovery and YouTube URL oEmbed returned HTTP 200 in read-only
probes. mastodon.social rejected unauthenticated public timeline access with 422;
the app reports this and supports authorized instance sources. Other adapters are
fixture-verified capabilities, not new claims of live provider approval. TikTok
connection/publishing remains disabled; X/LinkedIn/Pinterest are link references.

Verification covers user/workspace boundaries, source/credential isolation, mixing,
duplicate native posts, cursor/session limits, saves/follows/hides, rate-limit
backoff, cache expiry and minimal saved-reference retention. Seven API browser
cases and both demo cases passed, including existing publishing and Inbox flows.
The 1,000-post load test recorded zero duplicates, operations tests passed 25/25,
monitor tests passed 4/4, and production dependency audit found zero vulnerabilities.
The complete local suite passed 232 tests, backend/shared/web type checks and
package/API/worker/web builds passed, and lint has zero errors with the same 48
pre-existing warnings. Linux container/migration/backup/restore CI remains a
separate release check; Docker is unavailable on this Windows executor.
See [actual capabilities and setup](UNIVERSAL-FEED.md).

## Deployed release evidence

The [29 October Feed readiness audit](FEED-PRODUCTION-VERIFICATION-2026-10-29.md)
adds real native-player verification, concurrent source-cap enforcement, preference
cleanup on removal, strict Bluesky moderation and a repeatable cached-feed load
check. This candidate still requires separate deployment; production remains on
the earlier revision above. Current test and CI evidence is attached to PR #2.

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
- Exact deployed revision's full application/container CI passed: 187 application tests, five API browser cases, one demo case, 25 operations cases, four monitor tests, load/restore/build/audit checks. Production dependency audit is clear; 48 existing lint warnings remain.

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
