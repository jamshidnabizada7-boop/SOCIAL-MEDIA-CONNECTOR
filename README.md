# Aria Hub — Create once. Publish everywhere.

A social publishing app with a Next.js web UI, Fastify API and Postgres-backed
publishing worker. Connect accounts, upload media, compose per-network variants,
publish now or schedule, and follow each destination independently.

**Current handoff:** Claude committed readiness phases 0–3 and left phase 4 in
progress. The resumed work finishes the local operations tooling and adds
verification. Production deployment and platform approvals still require external
setup. See [the current handoff](docs/PROJECT-STATUS.md) and
[the readiness plan](docs/PRODUCTION-READINESS-PLAN.md).

## Repository

| Path | Purpose |
|---|---|
| `apps/web` | Next.js 16 UI; API mode for real data, mock mode for demos |
| `apps/api` | Fastify 5: sessions, workspaces, permissions, accounts, posts, media, billing, admin |
| `apps/worker` | Durable job claims/leases, real adapters, reconciliation, token refresh, maintenance and alerts |
| `packages/db` | Drizzle schema (35 tables), migrations, seeds and encrypted credential vault |
| `packages/providers-core` | OAuth, provider HTTP clients, token refresh and supported analytics ingestion |
| `packages/media-core` | File inspection and shared local-disk storage |
| `packages/shared-types` | Contracts, provider capabilities, scheduling and telemetry sanitization |

[Architecture](docs/ARCHITECTURE.md) · [Deployment/runbook](deploy/DEPLOY.md)

## Local development

Use Node 24 LTS (Node 22.12+ is also supported) and npm. No cloud account is needed.

```sh
npm ci
npm run build:packages
```

For the API and worker to share the embedded database, start the wire server:

```sh
npm run dev:db
```

In each API/worker terminal set
`DATABASE_URL=postgres://aria:aria@127.0.0.1:5438/ariahub`, then:

```sh
npm run db:migrate
npm run dev:api
npm run dev:worker
```

On PowerShell use `$env:DATABASE_URL='postgres://aria:aria@127.0.0.1:5438/ariahub'`.
Migrations also seed plans, provider capabilities and feature flags. A separate
`npm run db:seed` is available but is not required after migration.

Create `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_API_URL=http://localhost:4100
```

```sh
npm run dev:web
```

Open `http://localhost:3000`. Use the same hostname consistently for cookies and
CORS. The default web mode is a self-contained mock demo; explicitly select API
mode for real accounts and posts. Production serves web and API on one hostname.

Alternatively run `docker compose up -d` for local Postgres 16 and use
`DATABASE_URL=postgresql://aria:aria_local_dev@localhost:5432/ariahub`. Do not run
separate embedded database processes against the same data directory.

Root `.env.example` documents settings; npm/tsx do not automatically load that
file. Export variables in the relevant process or use a shell environment loader.
The Next.js app loads `apps/web/.env.local` itself.

## Verification

```sh
npm run build:packages
npm run lint
npm run typecheck
npm test
npm run test:ops
npx playwright install chromium
npm run test:e2e
npm run test:load
npm audit --omit=dev
npm run build
```

The browser test builds the web app in API mode and starts an isolated API, worker,
database and local Bluesky HTTP fixture. It exercises real application code and
provider adapter requests without posting publicly. It uses ports 3180 and
4180–4183 and writes evidence to `test-results/`. The load test always creates an
isolated database and uses mock adapters for 1,000 due posts; it never uses your
configured `DATABASE_URL` or real provider credentials.

GitHub Actions runs these checks and a separate Docker stack/backup/restore smoke
test. Run that smoke test only in a fresh checkout with Docker installed:
`sh deploy/smoke-test.sh`.

On Debian/Ubuntu with PostgreSQL installed, run
`pg_virtualenv -t sh scripts/postgres-backup-test.sh` for real SQL migration and
database/media recovery verification in an isolated temporary cluster. The script
refuses to run without the temporary-cluster environment.

## Accounts and services

Nine publishing adapters are implemented: Bluesky, Mastodon, Facebook Pages,
Instagram, Threads, LinkedIn, Pinterest, YouTube and X. TikTok connection is
disabled until a real adapter exists. Available content formats vary by adapter;
for example, Bluesky video publishing is currently rejected explicitly.

Bluesky and Mastodon can connect without centralized app approval. Other networks
need configured developer apps, permissions and/or paid access. Code and fixtures
are not proof of a live platform approval or successful production delivery.

Email verification, password reset and invitations use SMTP. Without SMTP,
development logs email links and production does not send mail. Paid billing uses
Stripe when configured; free mode works without it. Engagement ingestion currently
covers Bluesky, Mastodon and YouTube; unavailable metrics remain unavailable.

Grant platform admin access locally with `npm run admin -- grant you@example.com`.
Provider credentials can then be managed through the admin UI. No deployment,
provider application or external account is changed by the verification commands.
