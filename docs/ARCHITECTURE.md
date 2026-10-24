# Aria Hub — Architecture

## What this is

A multi-platform social publishing SaaS: **create once, publish everywhere.**
Users connect social accounts once, compose once, and Aria Hub validates,
previews, schedules and delivers to every compatible network independently —
with per-destination status, safe retries and honest failure reporting.

## Current phase

**Phase 0–10 complete: all phases implemented — analytics, billing entitlements, hardening.**

| Piece | Status | Runs on |
|---|---|---|
| `apps/web` — full product UI (Phase: UI-first, done) | ✅ working | Next.js 16 |
| `apps/api` — auth, workspaces, RBAC, audit, OAuth, accounts, posts + media, queue scheduling, admin overview, **analytics (live deliveries/followers + ingestion endpoint) + billing entitlements** | ✅ verified E2E | Fastify 5 |
| `apps/worker` — publish pipeline, queue drivers, **real adapters for all 10 networks**, circuit breaker + Retry-After backoff + connection monitor | ✅ 21/21 tests | Node 24 |
| `packages/db` — 26-table PostgreSQL schema (Drizzle) | ✅ migrated+seeded | PGlite (embedded) |
| `packages/shared-types` — contracts + RBAC matrix + provider registry | ✅ built | — |
| `packages/providers-core` — OAuth (PKCE), credential vault + single-flight refresh, **clients for all 10 networks** (YouTube resumable, LinkedIn registerUpload, X chunked media, Threads/IG containers, Pinterest media, Facebook graph), profile fetchers | ✅ 19/19 tests | — |
| `packages/media-core` — content-sniffing, checksum dedupe, image inspection, local-disk storage (S3 swap-in later) | ✅ 10/10 tests | — |
| `apps/api` webhook gateway — HMAC verification, dedupe, raw persistence, publish-status reconciliation | ✅ 5/5 tests | — |

Everything is local by default per project policy: the database is an embedded
Postgres (PGlite) persisted under `.local/ariahub-pg`, and the queue uses the
in-memory driver. No cloud services are touched. Setting `DATABASE_URL` and
`REDIS_URL` switches to network Postgres and BullMQ without code changes.

## Repository layout

```
apps/
  web/       Next.js 16 UI (mock service layer; API wiring is the next step)
  api/       Fastify 5 HTTP API — auth (bcrypt+sessions), workspaces, brands,
             members, RBAC guards, audit logging, health
  worker/    Publishing engine — queue drivers (memory | BullMQ),
             SocialProviderAdapter contract, mock adapter, idempotent pipeline
packages/
  db/        Drizzle schema (24 tables), migrations, client factory
             (PGlite | node-postgres), AES-256-GCM credential vault, seeds
  shared-types/  Canonical contracts: Post/PublishTarget/SocialAccount…,
             RBAC permission matrix, provider capability registry
docs/
  phase-0/   Verified provider capability matrix, per-provider research,
             developer-app setup guide
```

## Runtime topology

```
apps/web ──HTTP+cookies──▶ apps/api ──SQL──▶ Postgres (PGlite local / network)
                                │
                                └─writes publish_jobs──▶ Postgres
                                                             ▲ sweep
apps/worker ◀──claims due jobs──── publish_jobs ────────────┘
    │
    ├─▶ SocialProviderAdapter (mock now; real per-provider adapters in Phase 5)
    ├─▶ publish_attempts / remote_posts / notifications
    └─▶ queue: memory (local) | BullMQ+Redis (REDIS_URL set)
```

## Publishing engine invariants (enforced + tested)

1. **A target publishes at most once.** `publish_targets.idempotency_key` is
   unique; the pipeline checks target state and `remote_posts` before any
   provider call, and records `skipped_duplicate` attempts as evidence.
2. **Per-destination independence.** Each target is its own job; one failing
   network never rolls back another.
3. **Failures are classified.** Retryable errors back off exponentially with
   jitter up to `max_attempts`, then land in the dead-letter state.
   Non-retryable errors (validation, revoked permissions) fail immediately
   with a translated, user-facing message.
4. **Provider logic lives only in adapters.** The engine speaks the
   `SocialProviderAdapter` contract (validate → upload → create → poll →
   delete) and contains zero provider-specific branches.
5. **Async platforms are reconciled.** TikTok/YouTube-style "accepted, still
   processing" states are polled/reconciled to a terminal state.
6. **Secrets are encrypted at rest** (AES-256-GCM under `ARIA_ENCRYPTION_KEY`),
   stored in `oauth_credentials`, never returned to clients, never logged.
7. **Token refresh is single-flight** via Postgres advisory locks
   (`withRefreshLock`) — no refresh stampedes.

## Local development

```bash
npm install
npm run db:migrate      # applies schema to .local/ariahub-pg
npm run db:seed         # plans, provider registry, feature flags
npm run dev:api         # Fastify on :4100
npm run dev:worker      # publish pipeline worker
npm run dev:web         # Next.js UI on :3000 (still mock-backed)
npm test                # all workspace tests
```

Optional real Postgres/Redis: `docker compose up -d`, then set `DATABASE_URL`
and `REDIS_URL` per `.env.example`.

## Next steps (in order)

1. **Wire the web app to the API** — replace the mock session/accounts services
   with the real endpoints (UI redesign is explicitly out of scope; the
   service-layer swap is designed in). Bluesky connect is fully usable today
   with an app password; Mastodon via instance URL.
2. **Phase 3** — media storage (local disk → S3-compatible), composer backing
   endpoints, scheduled-job dispatch. Unlocks image publishing for
   Bluesky/Mastodon (adapters already reject media with translated errors).
3. **Phase 4-5** — remaining provider adapters (Facebook/Instagram/Threads/
   LinkedIn/Pinterest/TikTok/YouTube/X) after developer apps are registered
   per `docs/phase-0/PROVIDER-SETUP.md`; webhooks + reconciliation.
4. **Phase 6+** — scheduling polish, reliability (circuit breakers),
   analytics, billing, hardening.

## Security notes

- Sessions: opaque 256-bit tokens, sha256-hashed at rest, httpOnly cookies
  (SameSite=Lax), 30-day expiry, opportunistic cleanup.
- Auth routes rate-limited (10/min); global 300/min.
- `app.setErrorHandler` keeps internals out of 500s in production; pino logs
  redact cookies, authorization headers and password fields.
- RBAC is enforced server-side per route from `ROLE_PERMISSIONS`; the UI's
  permission matrix mirrors it for display only.
- Tenant isolation: every workspace query filters by membership resolved in
  the auth guard; non-members receive 404 (no existence leak).
- RLS: with an API-owned schema, tenant isolation lives in the API layer; when
  the database is exposed via PostgREST (Supabase-style), RLS policies become
  mandatory and are tracked as a Phase 2+ task.
