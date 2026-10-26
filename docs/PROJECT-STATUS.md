# Project handoff — 26 October 2026

**The application is deployed on Oracle at https://app.myariahub.com.
Container, restore, public health and browser checks pass. Email, offsite backup,
monitoring and real-platform acceptance still need external setup.**

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
the first verified release was `b53879a`. Provider apps and the separate ARIA HUB
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
- Upgraded the existing Oracle stack, preserving its domains, systemd tunnel,
  encryption key, two users and connected account. API, worker and web now run
  as non-root with healthy checks; existing account/app credentials decrypt.
- Installed and ran `ariahub-v2-backup.timer`: local snapshots at 03:00 UTC
  (08:00 Asia/Karachi), 14-day retention. Offsite copying is not configured.
- Removed temporary build cache while retaining rollback images and snapshots.
- Corrected public network counts/TikTok advertising and the claim that app
  passwords never reach the service; credentials are stored encrypted.
- Restored an actual production snapshot into a separate PostgreSQL 16 container
  with networking disabled; all 35 tables, two users and the encrypted account
  record were recovered. Added a deployment regression check preventing Docker
  from consuming the SSH script's remaining health/revision commands.

## Verification evidence

| Check | Result |
|---|---|
| Clean `npm ci --no-audit --no-fund` | Passed using the current lockfile |
| `npm run typecheck` | Passed for all six backend packages |
| `npm run lint` | Passed; 48 pre-existing web warnings remain, zero errors |
| `npm test` | 119 tests passed: API 59, worker 29, media 10, provider core 21 |
| `npm run test:ops` | 24 passed: partial-stop recovery, paused worker, invalid manifests/archives, retention, deployment failure/locking, external tunnels, storage upgrades, empty uploads, SSH stdin and rollback revisions |
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
| Live Oracle application | API/worker/web healthy; both public domains return healthy responses; browser sign-in UI, local form validation and same-origin authentication routing pass |
| Existing data/credentials | Two users, two media records, zero posts preserved; one account credential and one provider configuration decrypt successfully |
| Local scheduled backup | systemd timer enabled; first production backup succeeded; next runs at 03:00 UTC daily |
| Actual production snapshot recovery | Passed in a separate network-isolated PostgreSQL 16 container: 35 tables, two users and one encrypted account recovered; test container removed |

The load result measures local PGlite with simulated provider latency; it is not a
production throughput promise. Browser testing exercises real provider adapter
HTTP request code against a local fixture, not a real social platform. SMTP,
Stripe collection, real provider approvals/delivery and remote Sentry notification
delivery have not been verified with external accounts.

## Remaining before a public launch

1. **Configure SMTP and confirm real email delivery.** Configure and test Stripe
   only if launching paid plans; free operation does not require Stripe.
2. **Fill legal operator/contact details and review provider redirect URLs.** The
   existing public domains/tunnel and production encryption key are preserved.
3. **Configure offsite storage and uptime/error/backup alerts.** Local nightly
   backups already run under systemd; rclone and Sentry remain unconfigured.
   Restore a downloaded offsite snapshot into a separate stack and keep the
   encryption key recovery material separately.
4. **Enable only approved/tested networks.** Bluesky and Mastodon need no central
   app approval. Meta/Google/LinkedIn/Pinterest/X need their access/approval/budget
   requirements completed. TikTok remains intentionally disabled.
5. **Re-upload the two older logo assets.** Their database records existed but
   files were already absent from the old container and media volume before this
   upgrade. No replacement files were fabricated; records remain intact. New
   uploads now use the persistent shared `/data/storage` directory.
6. **Run live acceptance tests and a small soft launch.** Verify each enabled
   network with a real test account, confirm public media access/cookies/callbacks,
   finish deployment security review and monitor a few users for 1–2 weeks.

Detailed checklist: [production readiness](PRODUCTION-READINESS-PLAN.md).
Commands and recovery procedures: [deployment runbook](../deploy/DEPLOY.md).
The encryption-key rotation runbook describes the current limitation: there is
no bulk re-encryption CLI; do not replace the key blindly.

## Next local session

Use Node 24 and `npm ci`, then `npm run build:packages`. The next launch work is
SMTP/legal configuration, offsite backup/alerts and real-network acceptance.
For Oracle deploys, preserve the systemd tunnel with `ARIA_TUNNEL_MODE=external`.
The live code revision is recorded in `/opt/ariahub-v2/REVISION`; pre-upgrade
recovery material is in `backups/recovery-before-20261026T133133Z` on that host.
