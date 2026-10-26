#!/bin/sh
# Configure rclone's `offsite` remote first. Scheduled by the operator (see DEPLOY.md).
# Copy, then expire old remote sets; an empty local folder must never erase all remote backups.
set -eu
remote="${ARIA_BACKUP_REMOTE:-offsite:ariahub-backups}"
source_dir="${ARIA_BACKUP_DIR:-/opt/ariahub-v2/backups}"
keep="${BACKUP_KEEP_DAYS:-14}"
case "$keep" in ''|*[!0-9]*|0) echo 'BACKUP_KEEP_DAYS must be a positive integer' >&2; exit 1;; esac
found=0
recent=0
for snapshot in "$source_dir"/backup-????????T??????Z; do
  [ -d "$snapshot" ] || continue
  [ -f "$snapshot/SHA256SUMS" ] || continue
  sh "$(dirname "$0")/check-snapshot.sh" "$snapshot"
  [ -z "$(find "$snapshot/SHA256SUMS" -mtime "-$keep" -print)" ] || recent=1
  name=$(basename "$snapshot")
  # Publish the manifest last, so interrupted uploads aren't considered complete.
  rclone copy "$snapshot" "$remote/$name" --include db.dump --include media.tar.gz --transfers 2
  rclone copyto "$snapshot/SHA256SUMS" "$remote/$name/SHA256SUMS"
  found=1
done
[ "$found" -eq 1 ] || { echo 'No complete backups; skipping remote retention' >&2; exit 1; }
# Retain complete sets by their manifest age, not individual file mtimes.
# Media/dumps can have old mtimes, and object-level expiry can leave half a set.
# Never prune without a newly created local snapshot inside the retention window.
if [ "$recent" -ne 1 ]; then
  echo 'No recent snapshot; offsite retention skipped.' >&2
  exit 1
fi
expired=$(mktemp)
trap 'rm -f "$expired"' EXIT
rclone lsf "$remote" --recursive --files-only --min-age "${keep}d" --include '/backup-*/SHA256SUMS' > "$expired"
while IFS= read -r manifest; do
  # A single exact generated directory only; never purge a parent or arbitrary prefix.
  if printf '%s\n' "$manifest" | grep -Eq '^backup-[0-9]{8}T[0-9]{6}Z/SHA256SUMS$'; then
    rclone purge "$remote/${manifest%/SHA256SUMS}"
  fi
done < "$expired"
echo "$(date -u +%FT%TZ) offsite copy complete"
