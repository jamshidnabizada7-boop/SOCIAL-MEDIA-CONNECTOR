#!/bin/sh
# Sourced by host operations. Keep fd 9 open until the caller exits.
# All callers run from the repository root so they share the same lock.
exec 9>.aria-operations.lock
flock -n 9 || { echo 'Another deployment, backup or restore is running; no services changed.' >&2; exit 1; }
