import { readFileSync } from 'node:fs';

const text = (name) =>
  readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
const image = (dockerfile) => {
  const value = dockerfile.match(/^FROM ([^\s]+)$/m)?.[1];
  if (!value || !/@sha256:[a-f0-9]{64}$/.test(value))
    throw new Error('An immutable source image is required');
  return value;
};

/** Official image sources, retaining the existing TLS and Redis durability configuration. */
export function nativeDatabasePlan() {
  const postgresImage = image(text('postgres/Dockerfile'));
  const redisImage = image(text('redis/Dockerfile'));
  if (!postgresImage.startsWith('ghcr.io/railwayapp-templates/postgres-ssl:17@'))
    throw new Error('The existing PostgreSQL major version must be preserved');
  if (!redisImage.startsWith('redis:7.4.6-alpine@'))
    throw new Error('The existing Redis runtime must be preserved');
  const postgresStartup = [
    'umask 077',
    'printf "%s" "$ASSESSMENT_TLS_INIT_BASE64" | base64 -d > /usr/local/bin/assessment-init-ssl.sh',
    'chmod 700 /usr/local/bin/assessment-init-ssl.sh',
    'cp /usr/local/bin/assessment-init-ssl.sh /docker-entrypoint-initdb.d/init-ssl.sh',
    'test "$(grep -c \'^SSL_DIR=\' /usr/local/bin/wrapper.sh)" -eq 1',
    "if ! grep -qx '/usr/local/bin/assessment-init-ssl.sh' /usr/local/bin/wrapper.sh; then sed -i '/^SSL_DIR=/i\\/usr/local/bin/assessment-init-ssl.sh' /usr/local/bin/wrapper.sh; fi",
    'exec /usr/bin/tini -g -- /usr/local/bin/wrapper.sh postgres -p 5432 -c "listen_addresses=*" -c ssl=on -c ssl_min_protocol_version=TLSv1.2 -c ssl_cert_file=/var/lib/postgresql/data/certs/server.crt -c ssl_key_file=/var/lib/postgresql/data/certs/server.key -c ssl_ca_file=/var/lib/postgresql/data/certs/root.crt',
  ].join('; ');
  const redisStartup = [
    'umask 077',
    'printf "%s" "$ASSESSMENT_REDIS_INIT_BASE64" | base64 -d > /tmp/assessment-redis-start.sh',
    'chmod 700 /tmp/assessment-redis-start.sh',
    'exec /bin/sh /tmp/assessment-redis-start.sh',
  ].join('; ');
  return {
    postgres: {
      source: { image: postgresImage, repo: null },
      startCommand: `/bin/bash -ec ${quote(postgresStartup)}`,
      variables: {
        ASSESSMENT_TLS_INIT_BASE64: Buffer.from(text('postgres/init-ssl.sh')).toString('base64'),
        RAILWAY_RUN_UID: '0',
        PGDATA: '/var/lib/postgresql/data/pgdata',
        PGHOST: '${{RAILWAY_PRIVATE_DOMAIN}}',
        PGPORT: '5432',
        PGUSER: '${{POSTGRES_USER}}',
        PGPASSWORD: '${{POSTGRES_PASSWORD}}',
        PGDATABASE: '${{POSTGRES_DB}}',
        DATABASE_URL:
          'postgresql://${{PGUSER}}:${{PGPASSWORD}}@${{PGHOST}}:${{PGPORT}}/${{PGDATABASE}}?sslmode=require',
        DATABASE_PUBLIC_URL:
          'postgresql://${{PGUSER}}:${{PGPASSWORD}}@${{RAILWAY_TCP_PROXY_DOMAIN}}:${{RAILWAY_TCP_PROXY_PORT}}/${{PGDATABASE}}?sslmode=require',
      },
    },
    redis: {
      source: { image: redisImage, repo: null },
      startCommand: `/bin/sh -ec ${quote(redisStartup)}`,
      variables: {
        ASSESSMENT_REDIS_INIT_BASE64: Buffer.from(text('redis/start.sh')).toString('base64'),
        RAILWAY_RUN_UID: '0',
        REDISHOST: '${{RAILWAY_PRIVATE_DOMAIN}}',
        REDISPORT: '6379',
        REDISUSER: 'default',
        REDIS_PASSWORD: '${{REDISPASSWORD}}',
        REDIS_URL: 'redis://${{REDISUSER}}:${{REDISPASSWORD}}@${{REDISHOST}}:${{REDISPORT}}/0',
      },
    },
  };
}
