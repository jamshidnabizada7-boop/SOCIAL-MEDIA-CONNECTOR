# Production verification — 28 October 2026

Aria Hub is live on Oracle at https://app.myariahub.com. Facebook and Instagram have real outgoing acceptance evidence. Threads account sign-in, public third-party approvals and a monitored soft launch remain open. This report does not certify every network for public access.

## Release and automated verification

- Deployed application revision: `df68e34577878b09df0f313562fff5c630054826`, the merge of PR #1 into `master`. Oracle's `REVISION` matches. [Exact revision CI](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40665800444) passed both application and container jobs.
- API, worker, web, PostgreSQL and Caddy are healthy. The named systemd tunnel is active. The independent older `/opt/aria-hub` deployment was preserved.
- 187 application tests, five API-mode browser cases, one separate demo browser case, 25 operations regressions, four Python monitor tests and the 1,000-post queue test passed in CI. Container CI built both images, applied fresh migrations, backed up and restored PostgreSQL/media, and checked paused-worker recovery.
- Typechecks/builds passed; lint has zero errors and 48 existing warnings. Production dependency audit reported zero vulnerabilities.
- Production worker startup and adapter lookup reject simulated publishing. Live billing failures do not substitute demo values; checkout return URLs do not establish payment success. Analytics preserve unavailable measurements.
- HTTPS redirection, HSTS/security headers, private-route authentication, CSRF rejection, unsigned Meta webhook rejection, legal pages and absence of public environment/Git files were verified. Caddy configuration reload is part of deployment verification.
- The stuck mobile navigation overlay was repaired and browser-tested for scrolling, dismissal, route changes and focus restoration.

The automated application/browser tests use isolated data and HTTP fixtures. The following live tests are separate production evidence.

## Live provider acceptance

| Provider | Actual production result | Limit |
| --- | --- | --- |
| Facebook / Aria Hub Page | Composer → API → worker published one clearly labelled temporary post on attempt 1. A real owner comment synchronized into Inbox. A reply sent through the signed-in Inbox UI reached `confirmed` on attempt 1, and Meta readback matched its text. | Verifies this owned Page; it does not establish advanced access for unrelated customers. |
| Instagram / @aria___hub | Composer uploaded a labelled 1080px test JPEG; API/worker published on attempt 1. Live Meta readback matched the media ID, caption and permalink. The actual engagement adapter also sent a test reply on this test media and read its exact text back. | Instagram reply acceptance used the provider adapter directly on a self-authored test comment, not the full incoming-comment Inbox UI flow. |
| Instagram / @little_moments000 | User approved comment-management access. Callback completed and both Instagram accounts store provider-verified `instagram_manage_comments`; both worker syncs are healthy. | No outgoing content was sent from Little Moments. |
| Threads | Existing Aria Hub Social app published successfully; Threads-specific app ID, encrypted secret and exact callback configured. Live connection flow reaches Threads login. | No authenticated Threads profile session is available. No account connection or live delivery is claimed. |
| Older Facebook credential | Meta rejected the token; connection and sync are gated for reauthorization with notification/audit evidence. | Belongs to an older workspace. It was not silently replaced or marked healthy. |

Acceptance references:

- Facebook post: `03c17005-49e4-47bd-a352-90cf40f62436`; provider ID `562210803648746_122203523090789569`.
- Facebook Inbox reply: `122203523090789569_1142670958293051`. Its confirmed receipt remains in production. Later native/API reads show the temporary root post unavailable; this audit did not confirm who removed it.
- Instagram post: `3b70c2f7-ee61-4ad7-9132-28bbfc14abf2`; media `18108527570189125`; [native permalink](https://www.instagram.com/p/DfCi5xslSZ0/).
- Instagram test comment `17883269511534384`, reply `18145366855607511`; native reply text matched.
- Instagram test cleanup: Graph deletion was refused (code 10). Business Suite's exact permanent-deletion dialog is prepared; awaiting the user's confirmation. Published delivery receipts are preserved.
- Screenshots are saved locally under ignored `test-results/`: `live-facebook-published.png`, `live-inbox-reply-confirmed.png`, `live-instagram-published.png`, `instagram-permissions-saved.png` and `live-threads-published.png`.

Threads uses `https://api.myariahub.com/v1/oauth/callback/threads`. Publishing the developer app does not prove that every requested permission has advanced access. Threads/LinkedIn/X/Pinterest/TikTok Inbox integrations are not implemented; TikTok publishing remains disabled. LinkedIn, YouTube, X and Pinterest developer credentials/approvals remain unavailable.

## Email and operator details

The existing Oracle SMTP service is configured with certificate validation and authenticated STARTTLS. One explicitly approved production email from `accounts@myariahub.com` to `info@myariahub.com`, subject “Aria Hub production email verification,” was accepted with SMTP 250 and no rejected recipients. Message ID: `<036b99bf-3bb6-ba93-7f69-56cf574403b2@myariahub.com>`.

The external monitor also successfully submitted its clearly labelled test alert through SMTP. Actual recipient inbox placement and reset/verification/invitation receipt remain unconfirmed; SMTP acceptance alone does not prove them.

Operator display/contact use the existing public ARIA HUB business details: `info@myariahub.com` and Sediqyar Square, opposite Balkh Medical Faculty, Mazar-e-Sharif, Afghanistan. Incorporation and independent legal review were not verified. Stripe is unconfigured; paid checkout stays unavailable.

## Media recovery and offsite backups

Both missing legacy originals were located on the user's Desktop and restored only after exact byte-count and SHA-256 matches with their preserved database records. All three pre-existing media assets now exist; no originals were fabricated or overwritten. A fourth labelled JPEG was uploaded for the Instagram acceptance test.

Nightly Oracle snapshots run at 03:00 UTC (08:00 Asia/Karachi) through an enabled systemd timer. The active hourly Codex automation exports validated snapshots under the host operations lock, encrypts with AES-256-GCM before writing local data, uploads only encrypted archives to private Google Drive, downloads and checks SHA-256, and preserves existing copies and keys. The uploader requires this Windows computer and Codex to be available; it is not an always-on VPS-to-cloud agent.

Verified private Drive copies include:

- `backup-20261028T091131Z`: 153,636 bytes; SHA-256 `71d921a96bd0e83c787cf9e69a065bd2a07a198ff1ce94131344b4c2032dd6f6`. Downloaded from Drive and restored in a network-isolated PostgreSQL 16 container: 41 tables, nine migrations, nine decryptable credential envelopes and all three original media files.
- Fresh post-authorization snapshot `backup-20261028T133636Z`: 194,596 bytes; SHA-256 `a6b4efab0fed2581eca133931ebb39e464dfd55bb0fb89bb4475a5b6124d8a55`. Cloud metadata confirms the private folder and owner-only permission; downloaded bytes match the local encrypted export. The actual downloaded copy also restored successfully into isolated PostgreSQL: 41 tables, nine migrations, nine decryptable credential envelopes and all four media files (three originals plus the labelled acceptance image).

Recovery keys stay separate from cloud archives in the restricted, ignored local recovery directory. Another protected key copy and an always-on cloud uploader remain operational improvements. No production restore was performed.

## Monitoring and disk

- GitHub-hosted public monitor is active on default branch `master`, configured every 15 minutes. [Manual production test run](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40666530803) passed all five real public probes and returned `notificationAccepted: true`. A scheduled invocation had not yet been observed at the final check.
- Oracle's enabled `ariahub-v2-monitor.timer` checks every five minutes. All eight checks passed: containers, tunnel, enabled backup schedule, latest backup result/age, free space and provider/publishing health. Failed-state changes and recovery notify the operator by SMTP.
- State-change notification prevents repeated identical failures from generating repeated emails. The independent public monitor can detect whole-host outages; the local monitor cannot send while the host is down.
- About 3.2 GiB disk headroom remains after removing unused Docker build cache. Data, volumes, backups and rollback images were preserved. Capacity must grow with usage.

## Remaining public launch gates

1. Sign in to the intended Threads profile, approve its connection, and test delivery. The current workspace already has the Free plan's three channels; a fourth channel may require a legitimate plan change.
2. Complete provider business verification/advanced-access review for public customer onboarding. Do not claim unconfigured networks are approved.
3. Confirm email inbox receipt and the account verification/reset/invitation flows with the real mailbox.
4. Observe unattended backup upload and scheduled external monitor runs; keep a separate protected recovery-key copy. For continuous offsite uploads while this computer is off, provision an always-on destination/client.
5. Finish independent security/legal review and a monitored soft launch. Optional Sentry is implemented but no Sentry service is configured.

See [operational procedures](PRODUCTION-OPERATIONS.md), [the readiness checklist](PRODUCTION-READINESS-PLAN.md) and [Inbox coverage](SOCIAL-INBOX.md).
