#!/bin/sh
# Debian/Ubuntu: pg_virtualenv -t sh scripts/postgres-backup-test.sh
# Requires a temporary cluster created by pg_virtualenv, never a configured DB.
set -eu
case "${PG_CLUSTER_CONF_ROOT:-}" in
  /tmp/*/postgresql) ;;
  *) echo 'Run with pg_virtualenv -t sh scripts/postgres-backup-test.sh' >&2; exit 1;;
esac
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
export ARIA_BACKUP_DIR="$scratch/backups" ARIA_MEDIA_DIR="$scratch/media"
export PGDATABASE="aria_backup_source_$$"
restored="aria_backup_restored_$$"
createdb "$PGDATABASE"
createdb "$restored"
# Apply every SQL migration against real PostgreSQL (no embedded DB or stubs).
for migration in "$root"/packages/db/drizzle/[0-9]*.sql; do
  psql -X -v ON_ERROR_STOP=1 --single-transaction -q -f "$migration"
done
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO users (email, name, notification_prefs)
VALUES ('restore@example.test', 'Restore verification', '{"publish_failed":true}');
INSERT INTO sessions (user_id, token_hash, expires_at)
SELECT id, 'fixture-digest-not-a-live-token', '2030-01-01T00:00:00Z' FROM users;
INSERT INTO rate_limit_buckets (key, hits, expires_at)
VALUES ('fixture-budget', 7, '2030-01-01T00:00:00Z');
SQL
mkdir -p "$ARIA_MEDIA_DIR/storage/nested"
printf 'original uploaded media\n' > "$ARIA_MEDIA_DIR/storage/nested/image.txt"
sh "$root/deploy/backup.sh"
snapshot=$(find "$ARIA_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'backup-*')
# Copy to a separate directory to simulate restoring a downloaded snapshot.
mkdir "$scratch/downloaded"
cp -R "$snapshot" "$scratch/downloaded/"
downloaded="$scratch/downloaded/$(basename "$snapshot")"
sh "$root/deploy/check-snapshot.sh" "$downloaded"
pg_restore --list "$downloaded/db.dump" > /dev/null
psql -X -v ON_ERROR_STOP=1 -q -c "DELETE FROM users; UPDATE rate_limit_buckets SET hits=99;"
printf 'changed after snapshot\n' > "$ARIA_MEDIA_DIR/storage/nested/image.txt"
# Same restore flags as restore.sh; restore twice to cover replacing existing data.
for pass in 1 2; do
  pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner -d "$restored" "$downloaded/db.dump"
  [ "$(psql -X -d "$restored" -tAc "SELECT name FROM users WHERE email='restore@example.test'")" = 'Restore verification' ]
  [ "$(psql -X -d "$restored" -tAc "SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id")" = 1 ]
  [ "$(psql -X -d "$restored" -tAc "SELECT hits FROM rate_limit_buckets WHERE key='fixture-budget'")" = 7 ]
done
mkdir "$scratch/restored-media"
tar -xzf "$downloaded/media.tar.gz" -C "$scratch/restored-media" --no-same-owner
[ "$(cat "$scratch/restored-media/storage/nested/image.txt")" = 'original uploaded media' ]
tables=$(psql -X -d "$restored" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
version=$(psql -X -tAc 'SHOW server_version')
printf 'PASS: PostgreSQL %s; %s application tables; schema/data/relationships/media restored twice from a copied snapshot.\n' "$version" "$tables"
