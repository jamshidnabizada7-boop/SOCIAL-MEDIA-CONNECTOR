#!/bin/sh
# Host-side deployment. Called from deploy.sh over SSH with committed source.
# Run from the installation root; never run against an unconfigured directory.
set -eu
revision="${1:?usage: apply-release.sh <commit>}"
case "$revision" in ''|*[!0-9a-f]*) echo 'Invalid revision' >&2; exit 1;; esac
[ "${#revision}" -eq 40 ] || [ "${#revision}" -eq 64 ] || { echo 'Invalid revision length' >&2; exit 1; }
[ -f .env ] && [ -f "releases/$revision.tar" ] || { echo 'Missing production .env or release archive' >&2; exit 1; }
# Acquire before extracting: the previous release might not include our lock helper.
exec 9>.aria-operations.lock
flock -n 9 || { echo 'Another deployment, backup or restore is running.' >&2; exit 1; }
tar -xf "releases/$revision.tar"
compose() { docker compose -f deploy/docker-compose.prod.yml --env-file .env "$@"; }
compose config -q
compose build migrate web
compose up -d postgres
compose stop api worker backup
# Deliberately no restart trap: migration failure must leave writers stopped.
compose run --rm --no-deps migrate
# Older images ran as root. Existing named volumes do not inherit ownership
# from the new non-root image, so upgrade the upload directory explicitly.
compose run --rm --no-deps --user root --entrypoint sh api -c 'mkdir -p /data/storage && chown node:node /data && chown -R node:node /data/storage'
# Some existing installations run their named tunnel under systemd.
# In that topology preserve it instead of launching a second tunnel container.
if [ "${ARIA_TUNNEL_MODE:-compose}" = external ]; then
  compose up -d --wait --wait-timeout 150 --remove-orphans
else
  compose --profile tunnel up -d --wait --wait-timeout 150 --remove-orphans
fi
curl --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:18080/health >/dev/null
curl --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:18080/signin >/dev/null
compose exec -T worker node -e "fetch('http://127.0.0.1:4101/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Failed builds/migrations/health checks never replace the last verified revision.
if [ -f REVISION ]; then
  previous=$(cat REVISION)
  [ "$previous" = "$revision" ] || cp REVISION PREVIOUS_REVISION
fi
printf '%s\n' "$revision" > REVISION
echo "Deployed $revision; API, worker and web healthy."
