# Production readiness — current checklist

Updated 28 October 2026. Checked items below have the specific evidence in the [verification report](PRODUCTION-VERIFICATION-2026-10-28.md); they do not imply blanket social-platform approval.

## Deployed application

- [x] Full project/history published to GitHub master; PR #1 merged.
- [x] Deploy `df68e345` to Oracle; exact revision application/container CI passes.
- [x] Healthy non-root API/worker/web, PostgreSQL and Caddy; existing domains/tunnel preserved.
- [x] Workspace isolation, membership/role checks, auth rate limits, CSRF/SSRF protections, signed webhooks and encrypted credentials.
- [x] Durable publishing claims, retries/reconciliation, uncertain-outcome guards, media/variants and token refresh.
- [x] Production rejects simulated publishing; billing/analytics failures do not substitute demo success.
- [x] Unified Inbox and mobile navigation scrolling, dismissal, routing and focus restoration.
- [x] Public HTTPS/HSTS/security/authentication checks and legal pages.
- [x] 187 application tests, six browser cases, 25 operations cases, four monitor tests, 1,000-post test, container backup/restore and builds pass.
- [x] Production dependency audit reports zero vulnerabilities; lint has zero errors.
- [ ] Independent deployment security review; resolve existing lint warnings as maintenance.

## Real accounts and outgoing acceptance

- [x] Aria Hub Facebook publishing: real composer → worker → Meta receipt, attempt 1.
- [x] Facebook incoming comment → live Inbox → confirmed outgoing reply, attempt 1; native text matched.
- [x] Both connected Instagram accounts receive verified comment-management permission and healthy sync.
- [x] @aria___hub Instagram publishing through composer/worker, attempt 1; native ID/caption/permalink matched.
- [x] Instagram adapter sends and reads back a real reply to a self-authored test comment.
- [x] Invalid older Facebook token is gated for reauthorization with audit/notification evidence.
- [x] Threads developer app published; encrypted credentials and exact callback configured.
- [ ] Sign in and connect intended Threads profile; honor channel quota and verify real delivery.
- [ ] Reconnect the older workspace's Facebook credential if that workspace will be used.
- [ ] Verify full incoming Instagram comment → Inbox UI → outgoing worker reply flow; Little Moments outgoing acceptance remains untested.
- [ ] Clean up Instagram acceptance post after permanent-deletion confirmation.

## Provider public access

- [ ] Meta business verification/advanced access and required review evidence for public customers.
- [ ] Google OAuth/YouTube access and actual developer credentials.
- [ ] LinkedIn organization-posting approval and credentials.
- [ ] Pinterest access/credentials.
- [ ] X access and an explicitly authorized API budget.
- [x] TikTok remains disabled; no fake publishing fallback.
- [x] Unsupported Threads/LinkedIn/TikTok/X/Pinterest Inbox capabilities are clearly gated.

Owned-account acceptance does not establish access for unrelated customers. Bluesky/Mastodon support needs a legitimate connected account and live acceptance before claiming production coverage.

## Email, policy and billing

- [x] Existing Oracle SMTP configured and TLS/authentication verified.
- [x] Approved production test email accepted with SMTP 250; monitor test email accepted.
- [ ] Confirm recipient inbox placement and verification/reset/invitation flows.
- [x] Existing public ARIA HUB operator/contact/address configured.
- [ ] Independent legal review and verification of legal entity details.
- [x] Paid checkout stays unavailable while Stripe is unconfigured.
- [ ] Configure and test Stripe only if launching paid plans.

## Backup and monitoring

- [x] Nightly quiesced/checksummed local snapshots, enabled at 03:00 UTC (08:00 Asia/Karachi).
- [x] Corruption/unsafe archive rejection, shared operations lock, safe retention and paused-worker restoration.
- [x] Recover both missing legacy originals by exact size/SHA-256; preserve existing files.
- [x] AES-256-GCM streamed export under the host lock; no plaintext dumps/credentials uploaded.
- [x] Private Drive cloud upload, authenticated download and checksum comparison.
- [x] Restore actual downloaded cloud snapshot into network-isolated PostgreSQL: 41 tables, nine migrations, credential decryption and original media checksums.
- [x] Active hourly Codex uploader automation; Windows computer/Codex availability requirement documented.
- [ ] Observe unattended upload of a newly created scheduled snapshot and keep another protected recovery-key copy.
- [ ] Provision an always-on cloud uploader if backups must upload while this computer is off.
- [x] Active GitHub external public monitor configuration; manual probes/SMTP alert pass.
- [ ] Observe scheduled GitHub invocation; configured schedules are not a timing guarantee.
- [x] Enabled five-minute Oracle component/backup/disk/provider monitor; all eight checks pass.
- [x] State-change failure/recovery emails with repeated-failure suppression.
- [ ] Optional Sentry service setup; independent review of operational alert receipt.
- [ ] Expand Oracle disk capacity for sustained growth.

## Launch

- [ ] Resolve the external gates relevant to the intended launch networks.
- [ ] Conduct a monitored soft launch with a few users for 1–2 weeks.

[Project handoff](PROJECT-STATUS.md) · [Operations](PRODUCTION-OPERATIONS.md) · [Inbox coverage](SOCIAL-INBOX.md)
