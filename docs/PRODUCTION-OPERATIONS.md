# Production monitoring and offsite recovery

## External uptime and email alerts

`.github/workflows/production-health.yml` runs on GitHub-hosted runners every 15 minutes after it is present on the repository's default branch (`master`). It checks both public database-health routes, sign-in HTML and security headers, HTTP-to-HTTPS redirection, and unauthenticated API rejection. This does not depend on the Oracle server or the Windows computer running its own monitor.

The repository Actions secret `ARIA_MONITOR_SMTP_URL` contains the existing Oracle SMTP connection. The workflow can only read repository contents and Actions history. It emails `info@myariahub.com` from `accounts@myariahub.com` on a new failed state and on recovery. Repeated failures are deduplicated against the preceding completed monitor run. A manual `test_alert=true` dispatch sends one clearly labelled test notification. SMTP errors fail the monitor run rather than reporting successful notification.

Run the probes without sending email:

```sh
python scripts/production_monitor.py --check-only
python -m unittest discover -s scripts -p '*_test.py'
```

Public uptime checks do not establish that every provider is approved or that every private account works. Provider deliveries and Inbox replies have separate acceptance evidence in the dated verification report.

On Oracle, `ariahub-v2-monitor.timer` checks every five minutes: runtime containers, tunnel, enabled backup timer, last backup result, snapshot age (36-hour ceiling), disk headroom (2 GiB minimum), provider circuits and publishing failure rate. It sends an SMTP notification to the same operator address when the set of failed checks changes and when it recovers. Its persistent state contains only failure codes and a timestamp. The GitHub monitor covers whole-host outages that this local monitor cannot report while the VPS is down.

## Encrypted offsite backup uploader

The existing Oracle systemd timer creates a quiesced local PostgreSQL/media snapshot at 03:00 UTC (08:00 Asia/Karachi). The Codex heartbeat **Aria Hub encrypted offsite backups** checks hourly for a newer completed snapshot and uploads its encrypted export to the private Google Drive folder **Aria Hub encrypted production backups**. It preserves existing copies and recovery keys, avoids duplicate filenames and verifies a downloaded copy by SHA-256. Failures, stale snapshots and recovery are reported; routine successful checks stay quiet.

The uploader currently requires the Windows computer and Codex to be available. It is independent of the VPS's disk, but is not an always-on VPS-to-cloud storage agent. The nightly local backup timer itself continues without this computer.

Create or validate the latest encrypted export manually:

```sh
node scripts/offsite-export.mjs
```

The exporter holds Oracle's operations lock while validating and archiving a snapshot and `.env`. It encrypts the streamed archive with AES-256-GCM before writing local content, refuses snapshots older than 36 hours and authenticates the completed bundle before reporting success. Outputs and keys remain under ignored `.local/recovery/`; do not commit them.

Only upload `.ariabak` files. The matching `.key` file is required for recovery and must stay separate from the cloud archive. Keep another protected copy of recovery keys. The Windows recovery folder's ACL is restricted to the current user. Never upload raw database dumps, decrypted environment files, recovery keys or signed download URLs to the public repository.

## Recovery validation

Download the exact encrypted Drive file, compare its SHA-256 with the export record, authenticate/decrypt the bundle and validate both snapshot manifest hashes. Restore the database into a throwaway PostgreSQL container with networking disabled; confirm table/migration counts and decryption of recovered credential envelopes. Verify media checksums too. Delete only that temporary container after verification.

Use `deploy/check-snapshot.sh` and the restore section in `deploy/DEPLOY.md` for a service recovery. A production restore pauses publishing until post-snapshot external deliveries have been reconciled; restoring a database cannot remove posts or replies already sent to a social network.
