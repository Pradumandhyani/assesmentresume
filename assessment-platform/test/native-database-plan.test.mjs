import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BlockList, isIP } from 'node:net';
import { nativeDatabasePlan } from '../scripts/railway/native-database-plan.mjs';

test('source switches retain the exact pinned PostgreSQL and Redis base images', () => {
  const plan = nativeDatabasePlan();
  for (const name of ['postgres', 'redis']) {
    const original = readFileSync(
      new URL(`../scripts/railway/${name}/Dockerfile`, import.meta.url),
      'utf8',
    );
    assert.equal(plan[name].source.image, original.match(/^FROM ([^\s]+)$/m)[1]);
    assert.equal(plan[name].source.repo, null);
  }
});

test('PostgreSQL retains its certificate hook inside the stock wrapper and its existing data directory', () => {
  const { postgres } = nativeDatabasePlan();
  const init = Buffer.from(postgres.variables.ASSESSMENT_TLS_INIT_BASE64, 'base64').toString();
  assert.match(init, /preserved CA/);
  assert.match(init, /verify_hostname/);
  assert.match(init, /hostnossl all all/);
  assert.equal(postgres.variables.PGDATA, '/var/lib/postgresql/data/pgdata');
  assert.match(
    postgres.startCommand,
    /\/usr\/bin\/tini -g -- \/usr\/local\/bin\/wrapper.sh postgres/,
  );
  assert.match(postgres.startCommand, /SSL_DIR=/);
  assert.match(postgres.startCommand, /ssl_min_protocol_version=TLSv1.2/);
});

test('the SSH database browser can authenticate on loopback while remote plaintext is rejected', () => {
  const { postgres } = nativeDatabasePlan();
  const init = Buffer.from(postgres.variables.ASSESSMENT_TLS_INIT_BASE64, 'base64').toString();
  const block = init.match(/# assessment TLS-only begin\n([\s\S]*?)# assessment TLS-only end/)[1];
  const rules = block
    .split('\n')
    .filter((line) => line.startsWith('hostnossl '))
    .map((line) => line.trim().split(/\s+/));
  const firstMatch = (address, replication = false) => {
    for (const [, database, , network, method] of rules) {
      if (replication ? database !== 'replication' : database !== 'all') continue;
      const [base, prefix] = network.split('/');
      if (isIP(base) !== isIP(address)) continue;
      const type = isIP(base) === 6 ? 'ipv6' : 'ipv4';
      const range = new BlockList();
      range.addSubnet(base, Number(prefix), type);
      if (range.check(address, type)) return method;
    }
  };
  for (const address of ['127.0.0.1', '::1']) {
    assert.equal(firstMatch(address), 'scram-sha-256');
    assert.equal(firstMatch(address, true), 'reject');
  }
  for (const address of ['127.0.0.2', '10.0.0.5', '192.0.2.1', 'fd00::5', '2001:db8::1']) {
    assert.equal(firstMatch(address), 'reject');
    assert.equal(firstMatch(address, true), 'reject');
  }
  assert.equal(
    rules.some((rule) => rule.at(-1) === 'trust'),
    false,
  );
});

test('Redis retains authenticated AOF persistence and the no-eviction policy', () => {
  const { redis } = nativeDatabasePlan();
  const init = Buffer.from(redis.variables.ASSESSMENT_REDIS_INIT_BASE64, 'base64').toString();
  assert.match(init, /requirepass \$REDISPASSWORD/);
  assert.match(init, /appendonly yes/);
  assert.match(init, /appendfsync everysec/);
  assert.match(init, /maxmemory-policy noeviction/);
  assert.match(init, /dir \/data/);
  assert.doesNotMatch(init, /FLUSHALL|FLUSHDB|rm -rf/);
  assert.equal(redis.variables.REDIS_PASSWORD, '${{REDISPASSWORD}}');
  assert.equal(redis.variables.REDISPORT, '6379');
  assert.equal(redis.variables.REDIS_PUBLIC_URL, undefined);
});
