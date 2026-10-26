#!/bin/sh
# DESTRUCTIVE. Operator-run only: replaces this stack's database and uploads.
# Usage: sh deploy/restore.sh backups/backup-YYYYmmddTHHMMSSZ
set -eu
snapshot="${1:?usage: restore.sh <complete-backup-directory>}"
. "$(dirname "$0")/operations-lock.sh"
sh "$(dirname "$0")/check-snapshot.sh" "$snapshot"
compose() { docker compose -f deploy/docker-compose.prod.yml --env-file .env "$@"; }
# pg_restore validates the dump before downtime. Pipefail isn't portable sh;
# input redirection ensures the restore command's status is the one checked.
compose exec -T postgres pg_restore --list < "$snapshot/db.dump" >/dev/null
compose stop api worker backup
echo 'Restoring database; on failure services stay stopped for inspection.'
compose exec -T postgres sh -c 'pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$snapshot/db.dump"
compose run --rm -T --no-deps --entrypoint sh api -c '
  set -eu
  stage=/data/restore-media-$$
  mkdir "$stage"
  tar -xzf - -C "$stage" --no-same-owner
  mkdir -p "$stage/storage"
  rm -rf /data/storage
  mv "$stage/storage" /data/storage
  rmdir "$stage"
' < "$snapshot/media.tar.gz"
compose run --rm --no-deps migrate
compose up -d --no-deps api
echo 'Restore complete. Worker stays stopped: reconcile posts published since the snapshot before resuming it.'
