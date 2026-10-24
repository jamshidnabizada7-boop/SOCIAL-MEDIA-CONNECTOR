# Aria Hub — Create once. Publish everywhere.

A multi-platform social publishing SaaS: connect your social accounts once,
compose once, and publish or schedule everywhere with per-network previews,
compatibility checks and honest per-destination delivery status.

## Monorepo layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 16 product UI (currently driven by the mock service layer) |
| `apps/api` | Fastify 5 API — auth, workspaces, brands, members, RBAC, audit |
| `apps/worker` | Publishing engine — queue drivers, provider adapter contract |
| `packages/db` | Drizzle schema (24 tables) + migrations + credential vault |
| `packages/shared-types` | Canonical data contracts, RBAC matrix, provider registry |
| `docs/` | Architecture, Phase 0 provider research & setup guides |

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full picture.

## Quick start (fully local — no cloud services)

```bash
npm install
npm run db:migrate      # create schema in the embedded local Postgres (.local/)
npm run db:seed         # plans, provider capability registry, feature flags

npm run dev:api         # Fastify API    → http://127.0.0.1:4100  (GET /health)
npm run dev:worker      # publish pipeline worker
npm run dev:web         # product UI     → http://localhost:3000
```

`npm test` runs every workspace's tests (API unit tests + the publishing
pipeline suite, including the idempotency invariant).

### Real-backend mode (UI wired to the API)

By default the UI runs on its mock service layer. To drive it from the real
API, start Postgres (either mode above), the API and the worker, then create
`apps/web/.env.local`:

```
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_API_URL=http://localhost:4100
```

Sign-up/sign-in then hit `/v1/auth/*`, the accounts screen connects real
providers (Bluesky app password works today), the composer uploads real media
and publishes through the worker, and the Content screen serves real files.
Analytics/admin/billing remain mock-backed.

### Optional: real Postgres + Redis

```bash
docker compose up -d
# then in .env:
# DATABASE_URL=postgresql://aria:aria_local_dev@localhost:5432/ariahub
# REDIS_URL=
```

## Status

- ✅ UI-first phase complete (all screens, mock service layer)
- ✅ Phase 0 — provider research & capability matrix (`docs/phase-0/`)
- ✅ Phase 1 — SaaS foundation (monorepo, database, auth, RBAC, audit, worker)
- ✅ Phase 2 — OAuth framework, credential vault, single-flight refresh, real
  Bluesky + Mastodon adapters
- ✅ Web→API wiring — real auth/accounts/posts/notifications in the UI
- ✅ Phase 3 — media storage live: multipart upload, checksum dedupe, inspection, raw serving; image publishing through Bluesky/Mastodon adapters
- ✅ Phase 4 — publishing hardening: circuit breaker, Retry-After backoff, webhook gateway, connection monitor, admin provider-health API
- ✅ Phase 5 — real adapters for all 10 networks. Live today: Bluesky, Mastodon (self-serve) + Facebook Pages (with app). Code-complete pending developer apps/review: Instagram, Threads, LinkedIn, Pinterest, YouTube (testing-mode), X (metered spend — X_POSTING_ENABLED)
- ✅ Phase 6 — queue slots API + Add-to-queue scheduling (next open window per network), admin panel wired to real provider health/jobs/DLQ/webhooks/flags/audit
- ✅ Phase 8 — analytics API: live deliveries/followers from the engine, N/A engagement until ingestion; admin ingest endpoint
- ✅ Phase 9 — billing entitlements from the DB (plan change, usage meters); team management API-backed; Stripe payment collection is the production-phase integration
- ✅ Phase 10 — security headers, deep health check with DB ping, request-size caps, redacted logging, 80+ tests
- ⏭ Next: Phase 3 (media storage → unlocks image publishing), remaining
  provider adapters as developer apps get approved

Per project policy, no external/cloud service is used or modified — the stack
runs locally until explicitly changed.
