#!/bin/sh
# LOCAL/CI ONLY. Builds a throwaway stack, restores a backup, verifies DB + media.
# Runs in a fresh checkout so no existing .env, backup or volume is touched.
set -eu
[ ! -f .env ] || { echo 'Run in a fresh checkout without .env' >&2; exit 1; }
test_project="ariahub-smoke-$$"
export COMPOSE_PROJECT_NAME="$test_project"
export ARIA_APP_IMAGE="$test_project-app:latest"
# Ephemeral loopback ports and a separate image tag allow checks on a live host.
export ARIA_API_BIND_PORT=0 ARIA_WEB_BIND_PORT=0 ARIA_GATEWAY_BIND_PORT=0
export POSTGRES_USER=aria POSTGRES_DB=ariahub POSTGRES_PASSWORD=local-smoke-password
export ARIA_ENCRYPTION_KEY=abababababababababababababababababababababababababababababababab
export APP_BASE_URL=http://localhost:18080 WEB_ORIGIN=http://localhost:18080
export LEGAL_ENTITY='Smoke test' CONTACT_EMAIL=smoke@example.test
touch .env
compose() { docker compose -p "$test_project" -f deploy/docker-compose.prod.yml --env-file .env "$@"; }
cleanup() { compose down -v --remove-orphans; rm -f .env; }
trap cleanup EXIT
compose config -q
compose build migrate web
compose up -d --wait --wait-timeout 120 postgres api worker web caddy
gateway=$(compose port caddy 8080)
curl --retry 10 --retry-delay 2 --retry-connrefused --max-time 5 -fsS "http://$gateway/health"
compose exec -T worker node -e "fetch('http://127.0.0.1:4101/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
curl --max-time 10 -fsS "http://$gateway/signin" >/dev/null
# Exercise Alpine tar's no-upload fallback with real pg_dump as well.
compose run --rm --no-deps -e ARIA_MEDIA_DIR=/empty-media -e ARIA_BACKUP_DIR=/tmp/empty-backups backup
compose exec -T api sh -c 'printf smoke-media > /data/storage/restore-smoke.txt'
compose exec -T postgres psql -U aria -d ariahub -c "CREATE TABLE restore_smoke (value text); INSERT INTO restore_smoke VALUES ('backup-survived');"
compose run --rm --no-deps --entrypoint sh backup /backup.sh
snapshot=$(find backups -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | sort | tail -n 1)
compose exec -T postgres psql -U aria -d ariahub -c 'DROP TABLE restore_smoke;'
compose exec -T api rm /data/storage/restore-smoke.txt
# Backup sets are root-owned mode 0700/0600 by design, matching production.
# Preserve the throwaway project/env when running the host restore as root.
if [ "$(id -u)" -eq 0 ]; then
  sh deploy/restore.sh "$snapshot"
else
  sudo -E sh deploy/restore.sh "$snapshot"
fi
if compose ps --status running --services | grep -qx worker; then
  echo 'Restore unexpectedly resumed the worker' >&2
  exit 1
fi
value=$(compose exec -T postgres psql -U aria -d ariahub -tAc 'SELECT value FROM restore_smoke')
[ "$value" = backup-survived ]
media=$(compose exec -T api cat /data/storage/restore-smoke.txt)
[ "$media" = smoke-media ]
echo 'Container stack and database/media restore verified.'
