#!/bin/sh
set -eu
case "${REDISPASSWORD:-}" in
  ''|*[!a-f0-9]*) echo 'A generated hexadecimal Redis credential is required.' >&2; exit 1;;
esac
[ "${#REDISPASSWORD}" -ge 64 ] || exit 1
umask 077
config=$(mktemp /tmp/assessment-redis.XXXXXX)
printf '%s\n' 'bind 0.0.0.0 ::' 'port 6379' 'protected-mode yes' \
  "requirepass $REDISPASSWORD" 'dir /data' 'appendonly yes' 'appendfsync everysec' \
  'maxmemory 64mb' 'maxmemory-policy noeviction' > "$config"
chown redis:redis "$config"
unset REDISPASSWORD
exec /usr/local/bin/docker-entrypoint.sh redis-server "$config"
