#!/bin/sh
# Validate a complete, portable snapshot before uploading or stopping services.
set -eu
snapshot="${1:?usage: check-snapshot.sh <backup-directory>}"
for name in db.dump media.tar.gz SHA256SUMS; do
  [ -f "$snapshot/$name" ] && [ ! -L "$snapshot/$name" ] || {
    echo "Backup is incomplete or contains a link: $name" >&2; exit 1;
  }
done
# A valid checksum of an unrelated file must not make a partial set look complete.
awk '
  { sub(/^\*/, "", $2) }
  NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ { bad=1 }
  $2 == "db.dump" { db++ ; next }
  $2 == "media.tar.gz" { media++ ; next }
  { bad=1 }
  END { exit (bad || db != 1 || media != 1 || NR != 2) }
' "$snapshot/SHA256SUMS" || { echo 'Invalid backup manifest' >&2; exit 1; }
(cd "$snapshot" && sha256sum -c SHA256SUMS)
listing=$(mktemp)
trap 'rm -f "$listing"' EXIT
# Check tar's exit code directly; a pipeline can hide truncated archive failures.
tar -tzf "$snapshot/media.tar.gz" > "$listing"
awk '$0 !~ /^storage(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }' "$listing" || {
  echo 'Unsafe media archive path' >&2; exit 1;
}
tar -tvzf "$snapshot/media.tar.gz" > "$listing"
# Uploads are regular files/directories, never symlinks, hardlinks or devices.
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' "$listing" || {
  echo 'Unsafe media archive entry type' >&2; exit 1;
}
