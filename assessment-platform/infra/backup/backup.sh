#!/bin/sh
# Run on a trusted backup host, never the sandbox host. Provision PGSERVICE and
# PGPASSFILE privately; credentials are not supplied as CLI arguments or printed.
set -eu
umask 077
: "${PGSERVICE:?Set a private libpq service name}"
: "${PGPASSFILE:?Set a private .pgpass file}"
: "${BACKUP_DIRECTORY:?Set an existing encrypted backup mount}"
test -d "$BACKUP_DIRECTORY"
test -r "$PGPASSFILE"
command -v pg_dump >/dev/null
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIRECTORY/assessment-$stamp.dump"
test ! -e "$target"
pg_dump --format=custom --no-owner --no-acl --file="$target"
(cd "$BACKUP_DIRECTORY" && sha256sum "assessment-$stamp.dump") > "$target.sha256"
printf 'Backup created; verify remote retention, encryption, WAL continuity and restore independently.\n'
