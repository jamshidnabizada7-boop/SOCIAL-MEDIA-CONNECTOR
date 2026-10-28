# Production verification — 28 October 2026

Aria Hub is live on Oracle. This audit verifies specific boundaries; it does not certify every social network for public launch. Platform approvals and real outgoing delivery acceptance remain open.

## Changes made during this audit

- Production web builds default to the real, same-origin API when public settings are omitted. The offline demo requires explicit selection.
- Production workers reject simulated publishing at startup and adapter lookup, before accepting jobs.
- Billing API failures display an error with a working retry. Demo subscriptions, usage and invoices cannot substitute for live data. The checkout return URL does not establish that a payment succeeded.
- Live invoices without a downloadable receipt no longer show a fake download action.
- Analytics retain missing engagement/comparison values. The publishing-volume card uses the delivery-count comparison rather than the impressions comparison.
- API/proxy failures return a readable error instead of exposing a JSON parse failure or development-server instructions.
- Confirmation-email resend returns an error when the mail transport fails. Configured support replies use `MAIL_REPLY_TO`.
- The privacy page describes the Inbox data collected and its configured retention limits.
- Public gateway checks found HTTP pages served without redirect and no web-page HSTS. Caddy now redirects Cloudflare's HTTP visitors to HTTPS and supplies HSTS for web/API/assets. Deployment explicitly reloads bind-mounted Caddy configuration; a failed reload cannot advance the verified revision.

## Executed local checks

| Check | Evidence |
| --- | --- |
| Application tests | 187 passing cases across API, worker, web, providers and media. The full suite ran before the final resend fix; the complete 24-case security file was rerun after that fix. |
| Browser, API mode | Five passing cases: billing outage/retry without demo values, mobile drawer scrolling/dismissal/focus, Inbox sync/reply using HTTP fixtures, Inbox API failure, and publishing using an HTTP fixture. |
| Browser, demo mode | One passing case; separate persisted demo interactions and no API requests. |
| Operations | 25 passing deployment/backup/restore regressions, including gateway reload failure. |
| Production dependencies | `npm audit --omit=dev`: zero reported vulnerabilities. |
| Compile/lint | Backend typecheck and API/worker builds passed; browser harness built standalone Next.js successfully. Lint has zero errors and 48 existing warnings. |

These browser/provider checks use isolated databases and fixture HTTP servers. They do not send real social posts or replies.

## Live environment and recovery

- API, worker, web and PostgreSQL containers are healthy. Caddy, the existing named tunnel and nightly local backup timer are running. The independent older Aria Hub deployment was preserved.
- One Facebook Page has provider-verified Inbox grants and healthy live read synchronization. A direct authenticated read matched its identity and returned ten owned posts. Both Instagram identities also matched a live authenticated read; both require `instagram_manage_comments` before comment synchronization/reply can work.
- The older Facebook token was rejected by Meta with HTTP 401 / code 190 / subcode 460 while its stored connection still said healthy. Rechecked the unchanged encrypted credential under a database lock, changed the connection to `needs_reauth`, and recorded an in-app notification and audit event. No credential or permission was replaced.
- No live publishing deliveries or outgoing Inbox replies were present during this audit. No acceptance post or reply was sent.
- Found the existing Aria Hub Oracle SMTP configuration under `/etc/aria-hub/account-email.env`. Verified certificate validation, STARTTLS, SMTP authentication and NOOP; then configured this application using that service. Nodemailer's `verify()` also succeeded inside the production API container. No acceptance email was sent; inbox receipt/deliverability is unverified.
- Sender: `accounts@myariahub.com`; support reply/contact: `info@myariahub.com`. The contact is also published on the [existing Aria Hub press page](https://www.myariahub.com/en/press).
- Set the operator display to ARIA HUB and its [published office address](https://www.myariahub.com/en/contact), Sediqyar Square, opposite Balkh Medical Faculty, Mazar-e-Sharif, Afghanistan. These are existing public business details; incorporation status and independent legal review were not verified.
- Created quiesced snapshot `backup-20261028T074054Z`. Copied the database/media snapshot and production environment into an AES-256-GCM encrypted bundle on the user's Windows computer, outside the VPS and outside Git. The folder ACL grants access only to the current Windows user. The recovery key is stored separately beside the encrypted file and needs another protected copy.
- Read the encrypted bundle back from disk, authenticated/decrypted it, verified both snapshot SHA-256 hashes, and restored the downloaded dump into a throwaway PostgreSQL 16 container with networking disabled. Verified 41 application tables, 9 migrations, 4 users and 8 decryptable credential envelopes. Removed the temporary container afterward; production data was not restored.
- Private copy and instructions: `.local/recovery/RECOVERY.md`. Do not commit recovery material or environment files to the public repository.
- Disk has about 3.3 GB free (93% used) before this release build. Additional capacity is needed for sustained growth; only unused build cache has been cleared.

## Remaining launch gates

1. Complete live outgoing acceptance for every enabled publishing/reply provider using approved accounts and explicitly chosen content. Existing fixture coverage is not live delivery evidence.
2. Reconnect the older Facebook account; grant Instagram comment access; finish any required Meta review/business verification and other providers' app approvals. Threads/LinkedIn/X/Pinterest/TikTok Inbox support is not implemented; TikTok publishing remains disabled.
3. Confirm actual verification/reset/invitation email receipt. SMTP connection/authentication alone is not deliverability proof.
4. Configure automated offsite backup storage and prove the scheduled copy. The encrypted Windows copy is a manual off-server recovery point, not an automated offsite service. No configured rclone remote or OCI CLI account was found.
5. Configure external uptime/error notifications and backup failure/freshness alerts. Sentry is not configured. A same-host healthy container cannot establish external availability.
6. Complete independent deployment security/legal review, repair the two previously missing legacy media files, and conduct a monitored soft launch. Stripe is unconfigured and paid checkout stays unavailable.

See [the readiness checklist](PRODUCTION-READINESS-PLAN.md) and [Inbox coverage](SOCIAL-INBOX.md) for platform-specific limits.
