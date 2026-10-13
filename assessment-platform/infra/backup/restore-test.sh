#!/bin/sh
# Deliberately creates a fresh test DB and never drops/replaces an existing one.
set -eu
umask 077
: "${RESTORE_ACK:?Set RESTORE_ACK=DEDICATED_DISPOSABLE_RECOVERY_HOST}"
: "${RESTORE_DATABASE:?Name a new database ending _restore_test}"
: "${BACKUP_FILE:?Set a reviewed backup file}"
: "${PGSERVICE:?Set a private recovery-host libpq service}"
: "${PGPASSFILE:?Set a private .pgpass file}"
test "$RESTORE_ACK" = DEDICATED_DISPOSABLE_RECOVERY_HOST
case "$RESTORE_DATABASE" in
  *_restore_test) ;;
  *) printf 'Refusing non-test database name\n' >&2; exit 1 ;;
esac
case "$RESTORE_DATABASE" in
  *[!a-z0-9_]*) printf 'Invalid database name\n' >&2; exit 1 ;;
esac
test -r "$BACKUP_FILE"
test -r "$BACKUP_FILE.sha256"
(cd "$(dirname -- "$BACKUP_FILE")" && sha256sum --check -- "$(basename -- "$BACKUP_FILE").sha256")
# createdb fails if the named DB already exists; no --clean/drop/create replacement.
createdb "$RESTORE_DATABASE"
pg_restore --dbname="$RESTORE_DATABASE" --no-owner --no-acl --exit-on-error -- "$BACKUP_FILE"
psql --dbname="$RESTORE_DATABASE" --no-psqlrc --set=ON_ERROR_STOP=1 --command='SELECT count(*) AS students FROM students; SELECT count(*) AS attempts FROM assessment_attempts; SELECT count(*) AS results FROM assessment_results;'
printf 'SQL restore completed. Reapply runtime grants, provision historical keys and verify resume/judge/result invariants before cutover.\n'
