#!/bin/sh
# Consistent file set published by an atomic directory rename. Database custom
# dump + media archive + checksums; an interrupted run is never a usable backup.
set -eu
umask 077
root="${ARIA_BACKUP_DIR:-/backups}"
media_root="${ARIA_MEDIA_DIR:-/data}"
keep="${BACKUP_KEEP_DAYS:-14}"
case "$root" in /*) ;; *) echo 'Backup directory must be absolute' >&2; exit 1;; esac
case "$keep" in ''|*[!0-9]*|0) echo 'BACKUP_KEEP_DAYS must be a positive integer' >&2; exit 1;; esac
stamp="backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$root"
[ ! -e "$root/$stamp" ] || { echo 'Backup already exists for this second' >&2; exit 1; }
staging="$root/.$stamp.partial"
mkdir "$staging"
trap 'rm -f "$staging/db.dump" "$staging/media.tar.gz" "$staging/SHA256SUMS"; rmdir "$staging/empty/storage" "$staging/empty" "$staging" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
pg_dump --format=custom --no-owner --file="$staging/db.dump"
# Always include an archive, even on a fresh install with no uploads.
if [ -d "$media_root/storage" ]; then
  tar -czf "$staging/media.tar.gz" -C "$media_root" storage
else
  # BusyBox tar (postgres:alpine) rejects a completely empty archive.
  mkdir -p "$staging/empty/storage"
  tar -czf "$staging/media.tar.gz" -C "$staging/empty" storage
  rmdir "$staging/empty/storage" "$staging/empty"
fi
(cd "$staging" && sha256sum db.dump media.tar.gz > SHA256SUMS)
mv "$staging" "$root/$stamp"
# Exact generated names only; never remove unrelated files or partial runs.
find "$root" -mindepth 1 -maxdepth 1 -type d -name 'backup-????????T??????Z' -mtime "+$keep" -exec rm -r -- {} \;
echo "$(date -u +%FT%TZ) backup complete: $stamp"
