#!/bin/sh
# Run on the host, nightly. Briefly stop writers so DB/media form a matched set.
set -eu
compose() { docker compose -f deploy/docker-compose.prod.yml --env-file .env "$@"; }
# Serialize backups and restores, including scheduled/manual invocations.
. "$(dirname "$0")/operations-lock.sh"
running=$(compose ps --status running --services)
writers=
for service in $running; do
  case "$service" in api|worker) writers="$writers $service";; esac
done
restart_writers() {
  status=$?
  trap - EXIT
  # Preserve an intentional pause (especially the worker after a restore).
  if [ -n "$writers" ]; then
    compose up -d --no-deps $writers || status=1
  fi
  exit "$status"
}
# Install recovery before stop: it can fail after stopping just one service.
trap restart_writers EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
[ -z "$writers" ] || compose stop $writers
compose run --rm --no-deps backup
