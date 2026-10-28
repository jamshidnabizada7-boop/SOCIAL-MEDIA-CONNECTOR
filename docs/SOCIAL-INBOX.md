# Social Inbox implementation and verification

This branch adds `/inbox` alongside the existing operational `/notifications`.
Initial implementation verification used isolated local databases, synthetic
tokens, injected HTTP responses and the local Bluesky fixture. The user then
explicitly requested an Oracle deployment, recorded below. No live provider apps
were changed and no real posts, replies, mail or billing actions were sent.

## User flows and permissions

Desktop uses view/filter, interaction-list and conversation panes. Mobile starts
with a compact filter disclosure and switches between the list and conversation.
Search, category/provider/account/date filtering, pagination, per-account unread
counts, priority badges, stored thread context, native links and account sync
health are available. Users can read/unread; managers can assign, resolve/reopen
and archive/unarchive, including bulk operations on up to 100 items. Assignments
must belong to an active user in the same workspace. Handling actions record
actor IDs in the existing audit log without copying message text into it.

| Role | View/read | Reply | Assign/resolve/archive/manual sync |
|---|---|---|---|
| Owner, admin, manager | Yes | Yes | Yes |
| Editor | Yes | Yes | No |
| Approver, viewer | Yes | No | No |

Read, replied, resolved, archived and assigned are independent states. Opening a
conversation does not silently mark it read. Reply confirmation does not resolve
or mark it read. Preferences are per workspace/user: enabled categories filter
that user's list; priority categories receive badges. Neither preference stops
team ingestion. Summary counts describe the workspace, including hidden categories.

Demo mode has a separate versioned localStorage namespace per workspace. Demo
replies stay in the browser. API mode uses only authenticated backend responses;
errors never substitute demo events. Existing publishing and system alerts remain
on their original services/routes.

The mobile shell fix honors the drawer's open state, removes the overlay when
closed, restores scrolling and focus, traps keyboard focus, handles Escape and
backdrop dismissal, and closes on navigation or desktop resize.

## Provider capability matrix

"Implemented/tested" below means protocol fixtures and application tests, **not
live provider acceptance**. All five implemented providers await live verification.
No personal-profile notification scraping is used. An existing publishing grant
does not establish inbox permission.

| Provider | Implemented/tested ingestion | Direct reply | Constraints and remaining steps |
|---|---|---|---|
| Bluesky | Mentions, replies, quote mentions, likes, reposts, follows and other notification activity | Mentions/replies with URI/CID root and parent references | Existing app-password session; initial latest 50 notifications, subsequent cursor catch-up. Chat/DM API is **not implemented**. Native links for replyable posts. |
| Mastodon | Mentions, replies, **private mentions**, favourites, boosts, follows and other notification activity | Public/private/unlisted/direct status replies with original recipients | `read:notifications`, `read:statuses`, `write:statuses` (broad `read`/`write` also accepted). Current connector already requests broad read. Initial latest 40 notifications. This does **not** implement a full Conversations/DM-history import. Instance limits can differ from the conservative 500-character cap. |
| YouTube | Comments and embedded replies on owned-channel threads | Replies to the top-level comment | `youtube.readonly` for reading; `youtube.force-ssl` or `youtube` for replying. Explicit optional reauthorization. Google OAuth verification/quota apply. Initial latest 50 threads, incremental top-level cursor catch-up, recent-window rechecks for embedded replies; replies added to old threads outside the window may be missed. Thread refresh fetches up to 100 replies. No private-message integration. |
| Facebook | Comments and replies on recent owned **Page** posts | Page comment replies to original thread | `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`; Page moderation tasks and Meta review may apply. Traverses 10 published posts, at most 5 × 50 comments per post and 25 embedded replies per comment. Messenger, reactions and personal-profile notifications are **not implemented**. |
| Instagram | Comments and replies on recent professional-account media | Replies to original comment thread | Existing Facebook Login flow; `instagram_basic`, `pages_read_engagement`, `instagram_manage_comments`, with `pages_show_list` in the existing connection flow. Linked professional account and Meta review apply. Traverses 10 media, at most 5 × 50 comments and 25 embedded replies per comment. DMs and mentions are **not implemented**. Consumer accounts are unsupported by this Facebook Login API. |
| Threads | **Not implemented** | Disabled | Publishing credentials do not enable inbox support. Use native Threads. |
| LinkedIn | **Not implemented** | Disabled | Community-management access/approval needs separate implementation and verification. Use native LinkedIn. |
| X | **Not implemented** | Disabled | No new metered requests are made. A budgeted API tier, scopes and implementation are required. |
| Pinterest | **Not implemented** | Disabled | No claim of comment/DM API availability. Use native Pinterest. |
| TikTok | **Not implemented** | Disabled | No claim of owned-content interaction access. Requires verified API access and implementation. |

Meta/YouTube show an explicit "Review inbox permissions" action. It adds the fixed
inbox scope set only when `access=inbox` is selected. Normal publishing connects
keep their original requested scopes. Granted scope responses are stored, and
Meta additionally checks `/me/permissions` with the user grant before selecting
Page tokens. If that optional verification fails, scopes remain empty and inbox
access stays disabled; publishing connection remains usable. Reauthorization
updates existing account scopes instead of duplicating the account. Actual API
rejections remain visible in sync health/delivery status; granted scopes alone
do not prove app review or Page-task acceptance.

Primary protocol references checked during implementation:

- [Bluesky notifications](https://docs.bsky.app/docs/api/app-bsky-notification-list-notifications), [reply references](https://docs.bsky.app/docs/tutorials/creating-a-post).
- [Mastodon notifications](https://docs.joinmastodon.org/methods/notifications/), [status replies and idempotency](https://docs.joinmastodon.org/methods/statuses/).
- [YouTube comment threads](https://developers.google.com/youtube/v3/docs/commentThreads/list), [comment replies](https://developers.google.com/youtube/v3/docs/comments/insert).
- Meta's official generated SDK: [Page published posts](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py), [comments](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/comment.py), [Instagram media](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igmedia.py), [Instagram comment replies](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igcomment.py).
- [Meta's official Instagram permission/limitations collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-894be833-d0b6-4877-859e-c61ae6474d64), [Meta webhook verification example](https://github.com/fbsamples/original-coast-clothing/blob/main/app.js).

Meta's developer reference pages returned HTTP 429 during research; the official
SDK and Meta-maintained collection supplied the wire/schema references. This is
another reason live acceptance remains a separate requirement.

## Storage and migrations

`0007_complex_slayback.sql` adds six normalized tables; no existing notifications
or publishing tables are repurposed:

- `social_inbox_items`: workspace/account/event identity, source context, minimal
  reply references, sender/text/timestamps and independent handling states.
- `social_inbox_messages`: bounded stored thread context and outgoing messages;
  composite item/workspace foreign key and unique external message identity.
- `social_reply_actions`: durable outgoing ledger, initiating member, UUID request
  key, payload, queued/sending/confirmed/failed/unknown outcome, retry time and lease.
- `social_sync_state`: account cursor, health, cooldown, retry and worker lease.
- `social_inbox_preferences`: workspace/user category settings.
- `social_inbox_webhooks`: provider/body digest, timestamp and matched-account count.
  **Raw webhook bodies are discarded.**

`0008_rare_dragon_lord.sql` adds the account/workspace composite uniqueness and
foreign key for inbox ownership. The referenced uniqueness is created before the
foreign key. Account deletion cascades inbox content/actions/context. Fresh
migrations and composite cross-workspace rejection are tested against PGlite.
There are now 41 application tables. The production application of these migrations
is recorded in the deployment section below.

## Backend endpoints

All inbox application routes start with `/v1/workspaces/:workspaceId/inbox` and
use the existing session and workspace permission hooks. Non-members get 404;
insufficient roles get 403. IDs are validated and queries are workspace-scoped.

| Method / suffix | Function |
|---|---|
| GET `/` | Paginated view/type/account/provider/search/date filters; stable activity/id ordering; max 100/page |
| GET `/counts` | Workspace counts and unread per provider/account |
| GET `/accounts` | Actual granted scopes, capabilities and stored sync health |
| GET `/members` | Active workspace assignment candidates |
| GET, PATCH `/preferences` | Current user's inbox categories/priority settings |
| POST `/bulk` | Atomic handling/assignment for up to 100 IDs; rejects mixed-workspace selections |
| POST `/sync` | Durable account wakeup; 30-second manual cooldown |
| GET `/:itemId` | Stored conversation, delivery ledger and handling history |
| POST `/:itemId/refresh` | Queue bounded provider thread refresh; no provider call during GET |
| POST `/:itemId/reply` | Validate capability/role/length/context, persist UUID-idempotent reply and return 202 |
| GET, POST `/v1/webhooks/inbox/:provider` (outside workspace prefix) | Meta subscription verification and signed durable wakeup |

Reply submission is limited to 20 requests/minute in addition to existing API
limits. A duplicate request key returns the existing action; a conflicting
payload is rejected. Queued/sending/unknown outcomes block another reply on the
same item. Known failed deliveries can be retried explicitly as a new tracked
action; unknown outcomes cannot be blindly retried from the app.

## Worker, consistency and failures

The existing worker runs a bounded Inbox cycle every five seconds independently
of publishing claims. PostgreSQL rows remain the source of truth. Conditional
claims and ten-minute leases prevent two workers from delivering the same action.
Normal polling waits two minutes after a completed cycle; provider continuations
resume after five seconds. Meta traverses one owned content object/page per step.
Large bounded histories can therefore take several minutes, and this is not
advertised as universal real-time delivery.

Events and cursor advancement commit in one transaction. Upserts deduplicate by
account/external ID, preserve read/resolve/assignment state, and refresh edited
text when the source is revisited. Sync errors preserve the cursor. Rate limits
honor bounded `Retry-After`; other failures back off exponentially up to an hour.
Expired authorization and permission errors surface as blocked health. Source
404/410 and Bluesky tombstones during thread refresh disable further replies.
Deletion cannot be inferred merely because an event is absent from a bounded
provider page. Old/unvisited edits and removals may therefore remain visible until
refresh or retention. Arbitrary provider pagination URLs are never followed.

Before delivery, the worker rechecks active membership/role, workspace lifecycle,
account ownership/connection, capability and item availability. A provider message
ID is required to mark a reply confirmed. Transport/malformed/5xx outcomes on
non-idempotent providers become **unknown**, preventing blind retries. Bluesky
uses a deterministic record key; Mastodon reuses the action's Idempotency-Key only
within a conservative 50-minute window (provider cache up to an hour). Expired
leases outside those safeguards become unknown. Explicit 429 rejections can be
retried safely. Automatic attempts are bounded to five. Failed and unknown
outcomes retain safe, actionable messages without logging provider bodies/tokens.

Daily existing maintenance purges normalized Inbox content older than
`INBOX_RETENTION_DAYS` (90 default; clamped 7–365), with message/action cascades.
Webhook digests retain seven days. Provider raw payloads are not retained.

## Meta webhook setup (future deployment)

1. Keep using the existing encrypted Meta app credentials in Admin (or existing
   environment fallback). These app secrets verify `X-Hub-Signature-256` over
   **exact request bytes**, with constant-time comparison; alternate signature
   schemes are not accepted on these routes. Bodies are limited to 1 MiB.
2. Configure a new random `INBOX_WEBHOOK_VERIFY_TOKEN` in the API environment.
3. For Page/Instagram subscriptions use the respective public endpoint
   `/v1/webhooks/inbox/facebook` or `/v1/webhooks/inbox/instagram`, verify it, then
   subscribe approved comment/feed fields and authorized account assets in Meta.
4. Reauthorize only the required connected accounts using "Review inbox permissions".
5. Validate delivery with an owned test account before any public-user rollout.

Verified payloads are deduplicated and enqueue **matching provider/account IDs**
in a transaction before acknowledgment. The worker then fetches owned content;
webhook text/object URLs are never trusted as normalized events. Webhooks wake
the bounded recent-content traversal, so an old post outside that window is not
guaranteed coverage. Signed Meta acceptance and duplicate delivery are fixture
tested; no live subscriptions were changed. Other providers use the implemented
polling adapters; no universal HMAC verification is claimed.

## Verification and deployment readiness

Changed files are grouped by purpose:

- Shared contract/permissions: `packages/shared-types/src/inbox.ts` and `src/index.ts`.
- Schema: `packages/db/src/schema/inbox.ts`, `accounts.ts`, `index.ts`, migrations
  `0007_complex_slayback.sql`, `0008_rare_dragon_lord.sql` and their Drizzle metadata.
- Provider contract/registry, normalization and five adapters:
  `packages/providers-core/src/engagement/{contract,capabilities,index,util,bluesky,mastodon,youtube,meta}.ts`;
  exports and optional inbox scopes in `src/index.ts` and `src/oauth.ts`.
- API: `apps/api/src/modules/inbox/{routes,webhooks}.ts`, route registration and
  validation handling in `src/server.ts`, scope verification/reauthorization in
  `src/modules/oauth/routes.ts`.
- Worker: `apps/worker/src/inbox.ts`, timer/maintenance/shutdown wiring in `src/index.ts`.
- Web: `apps/web/src/app/(app)/inbox/page.tsx`, `src/lib/services/inbox.ts`,
  `src/components/shell/app-shell.tsx` and `src/components/shell/nav-config.ts`.
- Verification: API Inbox/permission tests and bounded Vitest configuration;
  provider engagement tests; web service-mode tests/config/script; `e2e/inbox.spec.ts`
  and local Inbox HTTP fixtures in `scripts/e2e-server.mts`; separate demo-mode
  browser configuration/test and CI command. Lockfile changes add
  the web test dependency and hoist existing test packages; runtime libraries are unchanged.
- Documentation: this report, README, architecture, project handoff, readiness
  checklist, and optional Inbox keys in `.env.example`.

See the final verification record below for executed commands and results. Test
coverage includes provider wire formats, root/parent and private-recipient
semantics, scope gating, Meta signatures/deduplication, schema/tenant isolation,
bulk atomicity, role enforcement before delivery, state independence, sync cursor
failure preservation, reply idempotency/uncertainty, worker recovery, retention,
demo persistence, API failure behavior and mobile/browser publishing regression.

For development follow the root README, migrate **only a local/isolated database**
and run the existing API/worker/web. `npm run test:e2e` starts its own local
Postgres wire server, API, worker and Bluesky HTTP fixture and builds the web in
API mode. Other tests inject local fixtures. Screenshots/traces go to ignored
`test-results/`; logs and isolated data remain ignored.

Executed on 28 October 2026, final source checks:

| Command | Actual result |
|---|---|
| `npm run db:generate` | Generated migrations 0007 and 0008; applied through fresh isolated migration tests and the browser harness. Fixed generated FK ordering before successful checks. |
| `npm run build:packages` | Passed for all four shared packages. |
| `npm run lint` | Passed with 0 errors and 48 existing warnings; no new Inbox warnings. |
| `npm run typecheck` | Passed for all configured backend/shared workspaces; Next build also passed web TypeScript validation. |
| `npm test` | **181 passed**: API 85 (19 new Inbox tests), worker 46, provider clients 36 (15 new engagement tests), media 10, web service modes 4. |
| `npm run test:e2e` | **4 passed**: mobile navigation/focus/scroll/dismissal, real adapter → Inbox → one confirmed reply/reload, API outage without demo fallback, and existing scheduled image publishing. |
| `npm run test:e2e:demo` | **1 passed**: mobile demo Inbox, persistent local reply, search, and zero API/provider requests. |
| `npm run test:ops` | **24 passed** using local shell/service fixtures. |
| `npm run build` | Passed: packages, API, worker and optimized Next.js build including `/inbox`. |
| `git diff --check` and staged runtime/credential-signature checks | Passed. No production credentials, media, databases or test artifacts staged. |

Local screenshots inspected include desktop Inbox, the mobile Inbox, and a mobile
demo conversation with a confirmed local reply. CI now includes the separate demo
browser check. The subsequent container CI and production checks are recorded below.

Before production rollout: review the code/migrations, back up and validate the
new migrations in an isolated PostgreSQL staging stack, grant/test required
provider scopes and review approvals, configure/verify Meta subscriptions if
desired, and conduct live owned-account acceptance without assuming every
provider feature is available. Five providers have code integrations, not blanket
production approval. The remaining five inbox integrations are explicitly not
implemented. Production deployment was subsequently requested and performed as follows.

## Current live acceptance — 28 October 2026

Application revision `df68e345` supersedes the initial deployment below. Its exact
revision passed full application/container CI and is live on Oracle. A real Aria
Hub Facebook post was published by the worker on its first attempt. An actual
owner comment synchronized into Inbox; the signed-in Inbox UI sent one reply,
confirmed on attempt 1 with matching native Meta readback. This is live evidence,
separate from the HTTP fixtures above.

Both Instagram accounts now have provider-verified `instagram_manage_comments`
after the user's approved authorization flow, and their worker syncs are healthy.
Publishing to @aria___hub passed on attempt 1; the actual engagement adapter sent
and read back a reply to a self-authored comment on that test media. The full
incoming Instagram comment → Inbox UI → worker reply path and Little Moments
outgoing acceptance remain untested. Threads' developer app is published and
configured, but its account login is incomplete and Threads Inbox is unsupported.

The [dated production verification report](PRODUCTION-VERIFICATION-2026-10-28.md)
contains receipt IDs, backup/monitoring evidence and remaining public approval
gates. The following section preserves the earlier rollout record.

## Initial Oracle deployment — 28 October 2026

On the user's explicit "MAKE IT LIVE ON ORACLE" instruction, deployed
`60aaa87fe70175a3f77e377aeefdd0050343b336` to `/opt/ariahub-v2` using the committed
deployment script with the existing external systemd tunnel. Exact source is
tagged `oracle-inbox-60aaa87`; documentation commits may be newer than that release.

- Both application and isolated container/migration/backup-restore CI checks
  passed for this exact revision.
- Kept previous application/web image tags `pre-inbox-b831ae2`, release source
  archives and `PREVIOUS_REVISION=b831ae23c4d448f5434e77616c1e644fcecc198e`.
- Took quiesced backup `backup-20261028T055847Z`; both database and media manifest
  checksums passed before migration. Existing writers were restarted after backup.
- Built production ARM64 images, applied migrations 0007/0008 and completed the
  deployment health checks. Database now has 41 public application tables and nine
  recorded migrations. API, worker, web and PostgreSQL are healthy; the existing
  tunnel and backup timer remain active. The separate older installation was not changed.
- Public `/inbox` and both public API health URLs return HTTP 200; health confirms
  PostgreSQL connectivity. All 15 referenced Inbox script assets loaded, including
  the Inbox and corrected mobile-navigation bundles. Unauthenticated Inbox API
  access correctly returns 401.
- All four existing account credentials and the stored Meta app secret still
  decrypt. Secrets were not rotated or emitted in verification output.
- Existing Meta grants were checked server-side against Meta token metadata and
  the configured app identity. Only provider-verified existing scopes were cached
  in the account/vault records, with an audit event; no new permissions were requested.
  One Facebook Page has all required grants and its worker sync is healthy. The
  current bounded window returned no Inbox items. One older Facebook token could
  not be verified (Meta HTTP 400/code 100) and remains gated for reconnection.
  Both Instagram connections lack `instagram_manage_comments`; use the live
  "Review inbox permissions" flow after the required Meta permission is available.
- No live reply was submitted; the production outgoing Inbox ledger is empty.
  Reply dispatch and mobile interactions retain the local/browser fixture evidence
  above. Browser-control tooling was unavailable for signed-in live UI automation,
  so public page/assets, connected-account storage and health were checked directly.
- Cleared unused build cache before/after building, preserving data volumes,
  backups and rollback images. Approximately 3.3 GiB remained free afterwards.

Live page: [app.myariahub.com/inbox](https://app.myariahub.com/inbox).
