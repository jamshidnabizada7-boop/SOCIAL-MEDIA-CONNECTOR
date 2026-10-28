# Production readiness — current checklist

Updated 2026-10-28 after the Oracle production audit. See [PROJECT-STATUS.md](PROJECT-STATUS.md)
for the handoff and verification evidence. Checked boxes mean implemented and
locally checked, not approved by a social platform or deployed to production.

## Production audit — 28 October

- [x] Deploy hardening release `a63e4ef` and verify its exact revision's application/container CI checks.
- [x] Block simulated publishing in production and remove live billing/demo fallbacks and false payment confirmation.
- [x] Verify public HTTPS redirect, HSTS, private-route authentication, CSRF rejection, unsigned-webhook rejection and legal-page content in Chromium without page runtime errors.
- [x] Verify three live Meta account identities and real Facebook reads; correct the fourth, invalid token to require reconnection. Import two real Facebook interactions.
- [x] Configure the existing Oracle SMTP sender and validate TLS/authentication from the production API container; fill operator/contact display from existing public business details.
- [x] Recover a downloaded, encrypted off-server snapshot in isolated PostgreSQL: 41 tables, 9 migrations, 4 users and 8 decryptable credential envelopes.
- [ ] Confirm actual email receipt, real outgoing social acceptance, automated offsite backups and external alerting before public launch.

The full evidence, remaining gaps and precise verification limits are in
[PRODUCTION-VERIFICATION-2026-10-28.md](PRODUCTION-VERIFICATION-2026-10-28.md).

## Social Inbox source update — 28 October

- [x] Workspace-scoped Inbox UI/API, independent handling states, team assignments, bulk actions and user category preferences.
- [x] Durable sync/reply work in the existing worker, five real provider integrations and signed Meta webhook wakeups; bounded history and unsupported capabilities documented.
- [x] Fix the stuck mobile navigation overlay, scrolling and keyboard dismissal/focus behavior.
- [x] Validate fresh Inbox migrations and backup/restore through the isolated PostgreSQL container CI checks.
- [x] Deploy Inbox release `60aaa87` to Oracle on explicit instruction, after a verified backup; check public pages/assets, credentials and service health.
- [x] Verify existing Facebook grants and live read synchronization for one Page without sending any replies.
- [ ] Complete remaining live provider acceptance: Instagram comment permission, older Facebook reconnection and other networks' required grants/app approvals.

See [SOCIAL-INBOX.md](SOCIAL-INBOX.md) for exact coverage and executed checks.

## Recovery point

Claude's last completed commit was `32a4e4a` (Phase 3: product completeness).
Earlier commits cover hygiene (`ac93788`), security (`57427eb`) and publishing
correctness (`342985e`). The working tree contained unfinished Docker, lockfile,
backup and deployment changes for phase 4. Those changes were continued in place.

## Phase 0 — Hygiene

- [x] Version control, secret/data exclusions, backend/web lint and typecheck commands.
- [x] Dependency declarations and build order; runtime commands support raw TS packages.
- [x] Reproducible lockfile with required Linux ARM64 native packages present.
- [x] Root environment template is included in version control instead of ignored.

## Phase 1 — Security foundations

- [x] Workspace-scoped post/target/account/queue queries and cross-tenant route tests.
- [x] Active membership, token-based invite acceptance, password reset/verification, login lockout.
- [x] Webhook signatures over raw payloads and Meta verification handshake.
- [x] HTTPS/private-instance checks, including mapped IPv6 private-address regression tests and DNS timeout.
- [x] Strong production encryption key validation, security headers, explicit trusted proxies and CSRF origin checks.
- [x] Postgres-backed atomic rate budgets shared across processes and restarts; cleanup and tests.
- [x] Redacted logging and privacy-filtered optional error reporting.
- [ ] Independent final security review of the actual public deployment and provider callbacks.

## Phase 2 — Publishing correctness

- [x] Conditional job claims, leases/heartbeats, stale recovery, persisted delays and duplicate guards.
- [x] Async provider IDs stored immediately; authenticated reconciliation with backoff and terminal outcomes.
- [x] Meta container ID/status response mapping, carousel creation/readiness, and real permalink handling verified with 17 HTTP fixture regressions.
- [x] Durable Postgres queue; removed the nonfunctional BullMQ path.
- [x] TikTok disabled; unsupported real adapters do not fall back to fake success.
- [x] Media, variants and AI disclosure passed from composer through API to worker.
- [x] Signed public media URLs and shared API/worker storage.
- [x] Transactional post/target/job changes and single-flight token refresh.
- [x] Pipeline/client tests and 1,000-post concurrent queue verification.
- [ ] Live delivery tests for every platform to be enabled at launch (requires real approved accounts).

## Phase 3 — Product completeness

- [x] SMTP-backed reset, verification, invitations and failure/reconnect alerts.
- [x] Plan reference data seeded on migration and platform-admin CLI.
- [x] Stripe checkout, portal, signed billing webhook and server plan limits; free operation without Stripe.
- [x] Analytics from real deliveries and available engagement ingestion (Bluesky/Mastodon/YouTube).
- [x] Profile/settings/team/account/workspace lifecycle flows, legal page implementations.
- [x] README/architecture/environment docs updated to the actual implementation.
- [x] Selected time zone honored by scheduling, DST ambiguity/gap checks, live post-status rendering and real author names.
- [x] Configure real SMTP and verify TLS/authentication using the existing Aria Hub Oracle service.
- [ ] Test actual mail receipt; configure/test Stripe if selling paid plans.
- [x] Fill operator/contact display using existing published Aria Hub business details.
- [ ] Independently review policies and legal identity for the intended business/platform registrations.

## Phase 4 — Infrastructure and operations

- [x] Same-origin Caddy routing and optional named-tunnel service prepared.
- [x] Multi-stage images, non-root runtimes, production backend dependencies, standalone web and healthchecks.
- [x] One-shot migration service before API/worker and deployment script with health verification.
- [x] Quiesced database/media backups, strict snapshot validation and whole-set retention; paused workers stay paused, partial-stop failures recover.
- [x] Offsite copy tool that cannot erase all remote copies when the local folder is empty.
- [x] Restore validates before downtime and leaves workers stopped for post-backup delivery reconciliation.
- [x] Structured worker logs, optional Sentry across API/worker/web, circuit/failure-rate alerts.
- [x] GitHub Actions for lint, types, tests, browser flow, load test, production audit and container smoke test.
- [x] Runbook covers deployment, rollback, restore, tunnel restart and key-rotation limitations.
- [x] Run the Docker build/stack/real pg_dump+pg_restore smoke test on Oracle in an isolated stack; worker remains paused after restore.
- [x] Build/test on the actual Oracle ARM64 target architecture.
- [x] Preserve and verify Oracle's permanent domains, systemd tunnel and production encryption/database secrets.
- [x] Enable nightly local backups under systemd at 03:00 UTC; first run succeeded.
- [x] Configure SMTP/operator details and restore a downloaded encrypted off-server copy in a separate stack.
- [ ] Configure and verify automated rclone/offsite storage; the Windows recovery copy is manual.
- [ ] Configure external uptime monitoring, Sentry notification rules and backup freshness/failure notifications.
- [x] Deploy to `/opt/ariahub-v2` on Oracle and confirm API/worker/web health; preserve the separate `/opt/aria-hub` services.

## Phase 5 — External platform access

- [ ] Meta App Review/business verification, allowed scopes, deletion callback and screencast; review Graph API version before enabling.
- [ ] Google OAuth consent verification and YouTube quota/access as needed.
- [ ] LinkedIn Community Management organization-posting access.
- [ ] Pinterest standard access.
- [ ] X paid API access/budget before enabling posting.
- [ ] TikTok remains disabled; implementing/auditing an adapter is future work if TikTok is needed.
- [ ] Publish reviewed privacy/terms/deletion pages on the final public domain.

Start with Bluesky/Mastodon, which do not need a central app review. Do not treat
implemented HTTP clients as evidence of approval for other users.

## Phase 6 — Verification and launch

- [x] Workspace tests, tenant-isolation checks and production dependency audit.
- [x] Scheduling conversion tests include browser-zone independence and DST edge cases.
- [x] Backup-script failure/corruption tests and Compose/workflow YAML parsing.
- [x] Real PostgreSQL 18.6 schema/data/relationship/media restore from a copied snapshot in a temporary Ubuntu cluster; 35 application tables restored twice.
- [x] Deployment/backup/restore locking, failure recovery, rollback revision and external-tunnel regression checks.
- [x] Load test: 1,000 due posts, two workers, four concurrent jobs each; no duplicate claims/provider calls; completed-job replay checked.
- [x] Browser flow on the standalone production web server: signup, fixture account connect, image upload, schedule, worker delivery, live status and reload without a duplicate.
- [x] Public Oracle browser sign-in/form validation/API routing and preserved credential decryption checks.
- [ ] Re-upload two legacy logo files already missing before deployment; their metadata was preserved.
- [x] Restore an actual production snapshot into isolated PostgreSQL 16 with networking disabled; 35 tables, two users and the encrypted account recovered.
- [ ] Live provider-account smoke tests.
- [ ] Soft launch with a few users and monitor for 1–2 weeks before public launch.

Local automated tests use isolated databases and fixtures; they neither publish
real social posts nor establish live production readiness. The remaining launch
items depend on the deployment environment, credentials and platform approvals.
