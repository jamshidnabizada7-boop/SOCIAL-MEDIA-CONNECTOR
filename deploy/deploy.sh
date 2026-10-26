#!/bin/sh
# Ships committed HEAD. Run only when a production deployment is explicitly requested.
set -eu
host="${DEPLOY_HOST:-ariahub-oracle}"
remote_dir="${DEPLOY_DIR:-/opt/ariahub-v2}"
tunnel_mode="${ARIA_TUNNEL_MODE:-compose}"
case "$tunnel_mode" in compose|external) ;; *) echo 'ARIA_TUNNEL_MODE must be compose or external' >&2; exit 1;; esac
# These values are passed to a remote shell. Restrict them instead of interpolating shell syntax.
case "$host" in ''|-*|*[!a-zA-Z0-9_@.-]*) echo 'Unsafe DEPLOY_HOST' >&2; exit 1;; esac
case "$remote_dir" in /opt/*) ;; *) echo 'DEPLOY_DIR must be below /opt' >&2; exit 1;; esac
case "$remote_dir" in *[!a-zA-Z0-9_./-]*|*/../*|*/..|*/) echo 'Unsafe DEPLOY_DIR' >&2; exit 1;; esac
revision=$(git rev-parse HEAD)
[ -z "$(git status --porcelain)" ] || { echo 'Commit or stash changes before deploying.' >&2; exit 1; }
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
git archive --format=tar --output="$archive" HEAD
# Upload first, then lock the host for extraction/build/migration/health verification.
ssh "$host" "mkdir -p '$remote_dir/releases'"
scp -C "$archive" "$host:$remote_dir/releases/$revision.tar"
ssh "$host" "cd '$remote_dir' && sudo env ARIA_TUNNEL_MODE='$tunnel_mode' sh -s -- '$revision'" < deploy/apply-release.sh
