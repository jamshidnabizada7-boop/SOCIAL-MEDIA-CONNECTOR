# Aria Hub production runbook

The target stack is one public hostname routed through a **named Cloudflare
Tunnel → Caddy → web/API**, with Postgres 16 and a publishing worker on the VPS.
The Social Media Connector is deployed at `/opt/ariahub-v2` on Oracle. The older
`/opt/aria-hub` installation and existing Vercel project are independent and were
not changed. Oracle's named tunnel runs under `ariahub-v2-tunnel.service` and
routes both `app.myariahub.com` and `api.myariahub.com` to Caddy on port 18080.

## Prerequisites and first installation

Use a Linux host with Docker Engine + Compose v2. Keep inbound database/app ports
closed; all published ports bind to loopback. Reserve 13000, 14100 and 18080 for
this stack. The compose project name is `ariahub-v2`; keep it stable to reuse the
same database/media volumes.

1. Copy the reviewed repository into `/opt/ariahub-v2`.
2. Copy `deploy/env.production.example` to `/opt/ariahub-v2/.env` and protect it
   with `chmod 600 .env`. Generate a hex database password and a 32-byte encryption
   key. Back up the encryption key separately from the server.
3. Set `APP_BASE_URL` and `WEB_ORIGIN` to the same permanent HTTPS hostname.
4. Create a named tunnel in Cloudflare Zero Trust. Set its public hostname to
   `app.<your-domain>` and service to `http://caddy:8080`. Put its token in
   `CLOUDFLARE_TUNNEL_TOKEN`. Do not put a Cloudflare Access login in front of the
   entire public hostname: provider callbacks, signed media URLs and legal pages
   must be reachable externally.
5. Configure SMTP and legal operator/contact details. Stripe, Sentry and approved
   provider apps are optional; leave them empty when launching free with only
   supported self-serve networks.
6. Register `{APP_BASE_URL}/v1/oauth/callback/{provider}` in each provider app.
   Meta webhooks use `/v1/webhooks/{provider}` and a configured verify token/app
   secret. Stripe webhooks use `/v1/billing/webhook` with the events in `.env.example`.

```sh
cd /opt/ariahub-v2
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env build migrate web
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env --profile tunnel up -d
curl -fsS http://127.0.0.1:18080/health
```

The one-shot `migrate` service runs migrations and reference seeds before API and
worker startup. No manual SQL or separate seed is necessary. Verify that the
`migrate` container exited with code 0 and API, worker and web become healthy.
An empty tunnel token is allowed when validating Compose without that profile;
starting the `tunnel` profile requires a real token.

After creating your user, grant platform admin access with:

```sh
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env exec api \
  node --import tsx packages/db/src/admin.ts grant you@example.com
```

Then configure provider credentials in the admin UI. Keep TikTok disabled until a
real adapter is implemented and verified. Other networks require their own app
approvals and live acceptance tests before you promise support to users.

## Deploy and check health

From a clean, committed local checkout in Git Bash/WSL/macOS/Linux:

```sh
DEPLOY_HOST=ariahub-oracle sh deploy/deploy.sh
```

For an existing installation whose named tunnel is managed by systemd, use
`ARIA_TUNNEL_MODE=external DEPLOY_HOST=ariahub-oracle sh deploy/deploy.sh`.
This preserves the existing tunnel instead of starting a second container.

For a host with limited build space, the `Oracle ARM64 release images` Actions
workflow builds production runtime images on a native ARM runner and exports a
checksummed artifact for its exact commit. Its web build uses the repository's
`ARIA_LEGAL_ENTITY`, `ARIA_CONTACT_EMAIL`, `ARIA_LEGAL_UPDATED` and optional
`ARIA_PUBLIC_SENTRY_DSN` public build variables. Keep these consistent with the
existing production web build; no runtime credentials belong in this artifact.
Verify the downloaded artifact's manifest and commit, load its images, preserve
the current runtime image tags for rollback, and tag the loaded images with the
names expected by Compose. Then deploy that same clean committed checkout with
`ARIA_USE_PREBUILT=1 ARIA_TUNNEL_MODE=external DEPLOY_HOST=ariahub-oracle sh deploy/deploy.sh`.
This skips host compilation only after checking both images' revision labels and
architecture. It still takes the deployment lock, runs migrations and waits for
service health. Take a quiesced backup before the upgrade as usual.

The script archives committed HEAD, stores its source archive under `releases/`,
builds images, stops writers, runs migrations, starts services, and checks API and
worker and web health. It holds `.aria-operations.lock` through deployment so
scheduled backups/restores cannot race the migration. `REVISION` and
`PREVIOUS_REVISION` advance only after health checks pass. Set `DEPLOY_HOST` and
`DEPLOY_DIR` for a different host/install.
It requires SSH and passwordless Docker/sudo access already configured. It does
not configure accounts, DNS or credentials for you. A failed migration leaves
writers stopped so the database can be inspected before any further changes.

Before a production upgrade, take a quiesced backup using the next section.
Review migrations for backward compatibility; a source rollback does not undo a
database migration. Do not use `docker compose down -v` on production.

```sh
cd /opt/ariahub-v2
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env ps -a
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env logs --tail 100 migrate api worker web
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T worker \
  node -e "fetch('http://127.0.0.1:4101/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

API `/health` returns 503 when its database ping fails. Worker 4101 is a local
liveness endpoint; it is not routed publicly. Caddy forwards Cloudflare's
`Cf-Connecting-Ip` as one normalized hop; the API defaults to `TRUST_PROXY=1` in
this stack. Keep Caddy and API ports private. If changing ingress topology,
review trusted hops and origin/cookie settings together.

## Backup, off-site copy and retention

```sh
cd /opt/ariahub-v2
sudo sh deploy/backup-stack.sh
```

The host wrapper stops running API/worker services briefly, waits for shutdown,
takes a matched Postgres/media backup, then restarts those services even if the
backup or shutdown command fails. A deliberately paused worker stays paused.
A shared lock prevents overlapping deployments/backups/restores. Expect a short maintenance window while
the snapshot runs. Running `backup.sh` directly against live writers does not
provide the same database/media consistency.

Each completed set is `backups/backup-YYYYmmddTHHMMSSZ/` containing `db.dump`,
`media.tar.gz`, and `SHA256SUMS`. Incomplete sets stay hidden and are never copied
off-site. Local sets older than `BACKUP_KEEP_DAYS` (default 14) expire only after a
successful backup. Store encryption-key recovery material separately.

Configure `rclone` on the VPS with a remote such as `offsite` (R2, Oracle Object
Storage, S3, B2). Use a dedicated bucket/prefix and protect its credentials. Then:

```sh
sudo ARIA_BACKUP_REMOTE=offsite:ariahub-backups sh deploy/backup-offsite.sh
```

This copies validated sets, publishes each manifest last, then removes whole
remote snapshot directories whose manifests are older than 14 days. It refuses
retention without a recent validated local snapshot, preserving recovery copies
when the backup job has stopped producing fresh sets. Directory names are checked
before removal. See rclone's [listing](https://rclone.org/commands/rclone_lsf/) and
[purge semantics](https://rclone.org/commands/rclone_purge/). Set `BACKUP_KEEP_DAYS` in the host environment too if changing
retention (the offsite script does not source `.env`).

On the existing Oracle host, the supplied systemd timer is installed and enabled.
It takes local snapshots daily at 03:00 UTC (08:00 Asia/Karachi), catches missed
runs after reboot, and records failures in the service journal:

```sh
sudo install -m 644 deploy/ariahub-v2-backup.service deploy/ariahub-v2-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ariahub-v2-backup.timer
sudo systemctl start ariahub-v2-backup.service
sudo systemctl show ariahub-v2-backup.service -p Result -p ExecMainStatus
sudo journalctl -u ariahub-v2-backup.service --no-pager -n 30
```

This timer currently performs local backups only. Once offsite credentials are
configured and a manual copy succeeds, add an offsite-copy service or an
`ExecStartPost` override. Configure external failure/freshness notifications.

On another host using cron instead, use this entry after successful backup/offsite
verification. Use only one scheduler:

```cron
0 3 * * * cd /opt/ariahub-v2 && sh deploy/backup-stack.sh >> /var/log/ariahub-backup.log 2>&1 && sh deploy/backup-offsite.sh >> /var/log/ariahub-backup.log 2>&1
```

The cron alternative runs at 03:00 in that host's time zone. Rclone credentials
and remote alerting remain operator setup steps.

## Restore

**This replaces this stack's database and uploaded media.** Verify the intended
host, compose project, snapshot and encryption key first. Download a complete
off-site set into `backups/` if needed, then:

```sh
cd /opt/ariahub-v2
sudo sh deploy/restore.sh backups/backup-YYYYmmddTHHMMSSZ
```

The exact two-file manifest, checksums, archive validity/paths/types and dump
header are checked before stopping writers. Links and special files are refused.
Database restore is transactional and stops on errors. API/worker remain stopped
if restoration fails. On success, migrations run and the API restarts; the worker stays stopped. Verify
`/health`, a stored media file and account decryption. Restoring
an old backup can reintroduce jobs whose social posts were already published
after that backup. Reconcile those provider accounts and outstanding scheduled
jobs before resuming the worker explicitly:

```sh
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --no-deps worker
```

Then verify a test delivery.

Before launch, perform a restore into a **separate** stack using a downloaded
off-site snapshot. A real PostgreSQL 18.6 round trip passed in a temporary local
Ubuntu cluster using `pg_virtualenv -t sh scripts/postgres-backup-test.sh`: all
35 application tables and sample relationships/data/media restored twice from a
copied snapshot. This does not replace validation of the production PostgreSQL 16
container stack or downloading from the configured cloud backup service.
The fresh-checkout CI command
`sh deploy/smoke-test.sh` builds images and checks database/media restoration in a
throwaway stack with separate image tags, volumes and ephemeral loopback ports.
It refuses an existing `.env` and uses root for reading the protected backup set.

## Rollback

Stop writers and identify the previous compatible source revision. Deploy keeps
`REVISION`, `PREVIOUS_REVISION` and source archives. For a code-only rollback:

```sh
cd /opt/ariahub-v2
previous=$(cat PREVIOUS_REVISION)
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env stop api worker
# Inspect the value and archive before extraction.
tar -tf "releases/$previous.tar" | head
tar -xf "releases/$previous.tar"
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env build migrate web
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env --profile tunnel up -d
```

Only use this when current migrations are compatible with the previous code.
Otherwise follow the restore procedure using the pre-upgrade snapshot. Do not
change the encryption key as part of rollback. Verify health and delivery after
any rollback; source extraction may leave files deleted by another revision, so
review the built image contents when rolling between structural changes.

## Encryption-key rotation

The current application does not have a bulk re-encryption command. Do not simply
replace `ARIA_ENCRYPTION_KEY`: stored tokens/provider secrets would become
unreadable and existing signed media links would stop working. A safe rotation
requires a tested re-encryption migration that reads each encrypted column with
the old key and writes with the new key while writers are stopped, plus an
old-key/snapshot recovery plan. Treat that as separate maintenance work. An
emergency reset is possible by reconnecting every social account and re-entering
every provider credential after switching the key; it loses existing credentials.

## Tunnel restart and monitoring

On the existing Oracle installation, use
`sudo systemctl restart ariahub-v2-tunnel.service` and
`sudo journalctl -u ariahub-v2-tunnel.service --no-pager -n 30`.
For installations using the Compose tunnel profile instead:

```sh
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env --profile tunnel restart cloudflared
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env --profile tunnel logs --tail 100 cloudflared
```

Named tunnels keep the same hostname on restart. A quick tunnel does not; if
still using one, OAuth callback registrations and public URLs must be updated
after each URL change. The supplied production topology expects a named tunnel.

Set `SENTRY_DSN` for API, worker and Next.js server errors and
`NEXT_PUBLIC_SENTRY_DSN` for browser errors (rebuild web after changing the latter).
`SENTRY_RELEASE` associates reports with a commit. Automatic request/body, user,
cookie, header and query collection are disabled and events are sanitized.

Worker logs/Sentry report open provider circuits and >=20% terminal publish
failures in a 15-minute window with >=10 outcomes. Repeated alerts have a
15-minute cooldown per worker; Sentry fingerprints group them across replicas.
Configure Sentry issue notifications for these messages and an external uptime
check of `https://app.<domain>/health`. Test notification delivery before launch.
