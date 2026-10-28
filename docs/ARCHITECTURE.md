# Aria Hub architecture

The product has a Next.js web app, Fastify HTTP API, and publishing worker. The
current source has 41 Drizzle tables and nine real publishing adapters.
TikTok is disabled. Production uses Node 24/22, Postgres 16, shared media storage,
Caddy and an optional named Cloudflare Tunnel.

## Data path

```text
Browser ── session cookie ──> Caddy
                              ├─ /v1/*, /health ──> API ──> Postgres
                              └─ other paths ─────> Next.js

API ── durable publish_jobs rows ──> worker claims + leases
                                     ├─ provider adapter ──> provider API
                                     ├─ attempts, targets, remote posts, notifications
                                     └─ reconciliation, refresh, metrics and maintenance
API + worker ──> shared /data/storage volume
```

The web app defaults to mock mode for the demo. In API mode all main product
screens use backend services, including billing, analytics, team and admin. Demo
records are not production state. Some dormant compatibility methods remain in
the workspace service; billing screens use the dedicated billing API service.

## Persistence and ownership

`packages/db` exposes a database handle over `pg` or embedded PGlite. Local API and
worker processes share PGlite through `npm run dev:db`, whose socket multiplexer
allows their connection pools. Production always sets `DATABASE_URL`.

`@aria/db` and `@aria/shared-types` export compiled `dist` files; build them before
running other packages. Provider and media packages export TypeScript source, so
API/worker runtime commands use `node --import tsx`. The root build orders package
builds before consumers.

Migrations apply before API/worker startup through a one-shot Compose service.
Reference seeds are idempotent and run after migrations. Runtime images use
non-root users; the web runtime uses Next.js standalone output.

## Publishing behavior

- The API scopes resource queries to the authenticated workspace, validates media
  ownership and plan limits, and writes post/target/job changes transactionally.
- Workers claim due jobs with conditional updates. Leases and heartbeats support
  crash recovery and multiple workers. There is no Redis/BullMQ or in-memory
  dispatch queue: Postgres rows are the source of truth.
- A target with a recorded remote post is never created again. Async provider IDs
  are recorded immediately and reconciled with decrypted credentials and backoff.
- Ambiguous mid-request failures on providers without idempotent creation require
  human review instead of risking a duplicate. This is not a guarantee that an
  external platform supports exactly-once delivery.
- Provider failures retry with backoff and circuit breakers; terminal outcomes and
  reconnect requirements are visible per destination.
- Text/media variants and signed, expiring public media URLs support platform
  requirements. Instagram/Threads need publicly reachable HTTPS media URLs.

## Social Inbox

`/inbox` uses normalized workspace-scoped items/messages, per-user category
preferences, a durable reply ledger and leased account sync state. The existing
worker runs bounded Inbox cycles independently of publishing jobs. Five adapters
cover supported Bluesky/Mastodon activity and YouTube/Facebook/Instagram comments;
exact scope/history/reply limits are in [the Inbox report](SOCIAL-INBOX.md).
Signed Meta webhooks durably wake account polling after signature verification
and deduplication; raw payloads are discarded. API/browser reads use stored data.
Replies require a provider confirmation ID; ambiguous delivery becomes unknown
and cannot be blindly retried. Operational notifications remain on their existing
service. Release `60aaa87` is deployed on Oracle. One Facebook Page has passed
live read/sync verification; other provider acceptance requirements remain in the report.

## Security and operations

Session tokens are opaque and hashed in storage; cookies are httpOnly,
SameSite=Lax and secure in production. Same-origin production routing avoids
cross-site cookie restrictions. Workspace membership/roles and active status are
checked server-side. Origin checks, signed raw webhooks, private-instance URL
checks, login lockout and security headers provide additional controls.

OAuth/provider credentials use AES-256-GCM with `ARIA_ENCRYPTION_KEY`, required in
production. Keep this key separately backed up. Changing it without re-encrypting
stored credentials makes connected accounts unreadable.

Rate-limit buckets use atomic Postgres upserts, hashed keys and per-route budgets.
Counters survive API restarts and are shared by replicas. Daily maintenance purges
expired buckets and tokens and data for workspaces deleted more than 30 days ago.

API `/health` returns 503 on database failure. Worker health is loopback-only on
4101 and detects a stalled claim loop. Structured logs include service/job context.
Optional Sentry captures API, worker, browser and Next.js server errors with
request data, user data, breadcrumbs and extra payloads removed. Operational
alerts cover open provider circuits and terminal publish failure rates of at
least 20% across at least 10 outcomes in 15 minutes, with a 15-minute cooldown.

Backup scripts publish paired database/media snapshots with checksums. Offsite
copy and retention require configured rclone credentials and an operator-managed
schedule. Container smoke verification includes a database/media restore into a
throwaway stack. See [the runbook](../deploy/DEPLOY.md) for exact procedures and
[the handoff](PROJECT-STATUS.md) for evidence and remaining external work.
