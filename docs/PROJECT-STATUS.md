# Project handoff — 26 October 2026

**The main application is implemented. Local verification passes; production
launch is still waiting on deployment validation and external setup.**

## Where Claude stopped

Git history shows completed readiness phases 0–3:

| Commit | Completed work |
|---|---|
| `ac93788` | Hygiene, lint/typecheck scripts and dependencies |
| `57427eb` | Tenant isolation, auth/invites, webhook/security hardening |
| `342985e` | Durable publishing queue, leases, reconciliation, media/variants and refresh |
| `32a4e4a` | Product features: auth/settings/team, Stripe, analytics, maintenance and legal pages |

Claude left uncommitted phase-4 changes to Docker/Compose, manifests, the lockfile,
and backup/deploy scripts. Those changes were continued in place. No original
work was discarded. The first continuation was local only. The user then
explicitly authorized validation and deployment to the existing Oracle VPS;
that continuation is now in progress. Provider apps and the separate ARIA HUB
installation are outside this deployment.

## Completed in this continuation

- Finished local deployment tooling: multi-stage non-root images, standalone web,
  shared media, one-shot migrations, a named-tunnel option, and healthchecks.
- Implemented checksummed paired database/media backups, a host wrapper that
  quiesces writers, safe offsite copy/retention, restore preflight, and deployment
  health checks. Restore intentionally leaves the worker stopped until deliveries
  after the snapshot have been reconciled to avoid accidental republication.
- Wired optional Sentry for API, worker, browser and Next.js server. Disabled
  automatic personal/request data collection and added event sanitization.
- Added operational alerts for open provider circuits and elevated publish failure
  rates, with repeated-alert suppression and regression tests.
- Replaced in-memory API rate-limit counters with atomic shared Postgres buckets;
  added migration `0006_known_karma.sql` and expiry cleanup.
- Fixed `/health` returning success when its database check failed.
- Fixed the local PGlite wire server's single-connection default, which let the
  worker occupy the only connection and prevent the API from working.
- Fixed scheduling to use the selected time zone, reject nonexistent/ambiguous
  daylight-saving times, and match the API's minimum one-minute lead time.
- Fixed post detail caching that hid live publishing changes, preserved detail
  history during list polling, and returned author names/error/permalink fields
  instead of showing demo author data or losing delivery details.
- Closed private IPv4-mapped IPv6 URL-filter bypasses and bounded DNS lookup time.
- Updated vulnerable dependencies: Next.js/ESLint config 16.4.3, Drizzle ORM 0.45.4,
  Nodemailer 10.2.1, Vitest 5.0.5, and Sentry 11.9.0. Production dependencies now
  have zero audit findings. Kept compatible runtime/start and package build order.
- Added GitHub Actions, Playwright browser verification, 1,000-post load checks,
  backup failure tests, a Docker stack/restore smoke script, and current docs.
- Continued recovery verification in the installed Ubuntu environment: all seven
  SQL migrations applied to real PostgreSQL 18.6, and all 35 application tables,
  sample records/relationships and media restored twice from a copied snapshot.
- Fixed backup recovery to preserve deliberately stopped services and recover
  from a partially failed shutdown. Deployment, backup and restore now share a
  host lock. Invalid manifests, corrupt archives and unsafe archive paths/types
  fail validation before downtime or offsite copy.
- Changed offsite retention to remove whole expired sets by manifest age, with a
  recent validated snapshot required before pruning. Fixed Docker smoke restore
  permissions for root-owned backups. Deployment waits for web/API/worker health
  and only then updates verified rollback revisions.
- Fixed Alpine/BusyBox tar's empty-upload backup case and verified it in the
  production recovery snapshot. Preserved pre-upgrade source, environment,
  database/media snapshots and old image tags on Oracle before replacement.

## Verification evidence

| Check | Result |
|---|---|
| Clean `npm ci --no-audit --no-fund` | Passed using the current lockfile |
| `npm run typecheck` | Passed for all six backend packages |
| `npm run lint` | Passed; 48 pre-existing web warnings remain, zero errors |
| `npm test` | 119 tests passed: API 59, worker 29, media 10, provider core 21 |
| `npm run test:ops` | 23 passed: partial-stop recovery, paused worker, invalid manifests/archives, retention, deployment failure/locking, external tunnels, storage upgrades, empty uploads and rollback revisions |
| `npm run test:e2e` | Passed on a standalone production web build: real API/worker + local Bluesky HTTP fixture |
| Browser story | Signup → connect → upload image → schedule → publish → live status → reload without duplication |
| `npm run test:load` | 1,000 due posts, 2 workers × 4 jobs, 32.15 seconds, zero duplicate claims/provider calls; 10 replays made no new calls |
| Backend production builds | Passed |
| Web production build | Passed on Next.js 16.4.3; also built by the browser harness |
| `npm audit --omit=dev` | Zero vulnerabilities |
| Full dependency audit | Four moderate development-tool findings remain under Drizzle Kit's legacy esbuild loader; production audit is clear |
| Linux ARM64 native lock entries | Present for Next SWC, lightningcss, Tailwind oxide and esbuild |
| Compose and GitHub Actions YAML | Parsed locally |
| Real PostgreSQL backup/recovery | Passed on PostgreSQL 18.6 in a temporary Ubuntu cluster: seven migrations, 35 tables, relationships, records and media, two restores from a copied snapshot |
| Oracle ARM64 Docker / PostgreSQL 16 stack | Passed in an isolated stack: both images built, migrations/health checks passed, database/media backup restored, worker stayed paused, test volumes removed |

The load result measures local PGlite with simulated provider latency; it is not a
production throughput promise. Browser testing exercises real provider adapter
HTTP request code against a local fixture, not a real social platform. SMTP,
Stripe collection, real provider approvals/delivery and remote Sentry notification
delivery have not been verified with external accounts.

## Remaining before a public launch

1. **Deploy the validated release and confirm public health.** Oracle ARM64
   container/restore validation has passed; preserve the existing named tunnel,
   encryption key, database and accounts during the authorized upgrade.
2. **Configure the permanent domain and named tunnel.** Set the single public
   origin, production encryption key/database secret, legal operator details and
   provider redirect URLs. This continuation did not deploy or change the
   existing Oracle/Vercel installations.
3. **Configure SMTP and confirm real email delivery.** Configure and test Stripe
   only if launching paid plans; free operation does not require Stripe.
4. **Configure offsite storage, nightly backup cron, uptime/error/backup alerts.**
   Restore a downloaded offsite snapshot into a separate stack and keep the
   encryption key recovery material separately.
5. **Enable only approved/tested networks.** Bluesky and Mastodon need no central
   app approval. Meta/Google/LinkedIn/Pinterest/X need their access/approval/budget
   requirements completed. TikTok remains intentionally disabled.
6. **Run live acceptance tests and a small soft launch.** Verify each enabled
   network with a real test account, confirm public media access/cookies/callbacks,
   finish deployment security review and monitor a few users for 1–2 weeks.

Detailed checklist: [production readiness](PRODUCTION-READINESS-PLAN.md).
Commands and recovery procedures: [deployment runbook](../deploy/DEPLOY.md).
The encryption-key rotation runbook describes the current limitation: there is
no bulk re-encryption CLI; do not replace the key blindly.

## Next local session

Use Node 24 and `npm ci`, then `npm run build:packages`. The fastest continuation
is to run the new CI/container job on a Docker-capable machine and address any
image/runtime issues it finds. Read this handoff before using older architecture
or status notes; the old table counts, mock-backend claims and quick-tunnel
instructions were stale and have been replaced.
