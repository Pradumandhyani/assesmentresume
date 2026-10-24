import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import {
  assertRailwayDatabaseUrl,
  railwayEndpointFingerprint,
  prepareDevelopmentDatabase,
} from '../scripts/railway/database.mjs';

const ids = {
  projectId: '10000000-0000-4000-8000-000000000001',
  environmentId: '10000000-0000-4000-8000-000000000002',
  serviceId: '10000000-0000-4000-8000-000000000003',
};
const source = 'postgresql://postgres:synthetic-secret@shuttle.proxy.rlwy.net:15140/railway';
const target = source.replace('/railway', '/assessment_dev') + '?schema=public&sslmode=verify-full';
const options = (updates = {}) => ({ connectionString: source, ...ids, ...updates });
const saved = (databaseUrl = target) => ({
  version: 1,
  provider: 'railway',
  purpose: 'development',
  ...ids,
  databaseUrl,
  endpointFingerprint: railwayEndpointFingerprint(databaseUrl, ids),
});

// Explicit unit transport double: these tests never connect to Railway or prove
// certificate acceptance. Actual TLS/database setup is verified by bootstrap.
function transport({
  databases = [],
  objects = [],
  version = '170005',
  encrypted = true,
  authorized = true,
  failure,
  endFailure,
} = {}) {
  const calls = [];
  const state = { released: false, ended: false, config: null };
  const client = {
    connection: { stream: { encrypted, authorized } },
    async query(sql) {
      calls.push(sql);
      if (failure) throw new Error(failure);
      if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: version }] };
      if (sql.startsWith('SELECT datname'))
        return { rows: databases.map((datname) => ({ datname })) };
      if (sql.startsWith('SELECT c.relname'))
        return { rows: objects.map((relname) => ({ relname })) };
      if (sql === 'CREATE DATABASE assessment_dev') return { rows: [] };
      throw new Error('Unexpected unit-test query');
    },
    release() {
      state.released = true;
    },
  };
  const dependencies = {
    poolFactory(config) {
      state.config = config;
      return {
        async connect() {
          return client;
        },
        async end() {
          state.ended = true;
          if (endFailure) throw new Error(endFailure);
        },
      };
    },
  };
  return { calls, state, dependencies };
}

test('initializes only the constant development DB on an empty verified PG17 service', async () => {
  const fake = transport();
  const result = await prepareDevelopmentDatabase(options(), fake.dependencies);
  assert.equal(result.created, true);
  assert.equal(result.databaseUrl, target);
  assert.deepEqual(result.profile, saved());
  assert.equal(result.fingerprint, result.endpointFingerprint);
  assert.deepEqual(
    fake.calls.filter((sql) => sql.startsWith('CREATE')),
    ['CREATE DATABASE assessment_dev'],
  );
  assert.equal(
    fake.calls.some((sql) => /DROP|DELETE|TRUNCATE|ALTER/i.test(sql)),
    false,
  );
  assert.equal(fake.state.config.ssl.rejectUnauthorized, true);
  assert.equal(fake.state.config.ssl.servername, 'shuttle.proxy.rlwy.net');
  assert.equal(fake.state.config.ssl.minVersion, 'TLSv1.2');
  assert.equal(new URL(fake.state.config.connectionString).pathname, '/railway');
  assert.equal(new URL(fake.state.config.connectionString).searchParams.has('sslmode'), false);
  assert.equal(fake.state.config.max, 1);
  assert.equal(fake.state.released, true);
  assert.equal(fake.state.ended, true);
});

test('reuses an existing target only with its exact trusted private cloud profile', async () => {
  const fake = transport({ databases: ['assessment_dev'] });
  const result = await prepareDevelopmentDatabase(
    options({ connectionString: target, trustedProfile: saved() }),
    fake.dependencies,
  );
  assert.equal(result.created, false);
  assert.equal(
    fake.calls.some((sql) => sql.startsWith('CREATE')),
    false,
  );
});

test('fingerprint binds cloud identity, host, port and database while permitting password rotation', async () => {
  const rotated = target.replace('synthetic-secret', 'different-synthetic-secret');
  assert.equal(railwayEndpointFingerprint(rotated, ids), saved().endpointFingerprint);
  assert.notEqual(
    railwayEndpointFingerprint(target.replace(':15140', ':15141'), ids),
    saved().endpointFingerprint,
  );
  assert.notEqual(
    railwayEndpointFingerprint(target, {
      ...ids,
      serviceId: '10000000-0000-4000-8000-000000000004',
    }),
    saved().endpointFingerprint,
  );
  assert.equal(
    saved().endpointFingerprint,
    createHash('sha256')
      .update(
        JSON.stringify({
          ...ids,
          host: 'shuttle.proxy.rlwy.net',
          port: '15140',
          database: 'assessment_dev',
        }),
      )
      .digest('hex'),
  );
  const fake = transport({ databases: ['assessment_dev'] });
  const result = await prepareDevelopmentDatabase(
    options({ connectionString: rotated, trustedProfile: saved() }),
    fake.dependencies,
  );
  assert.equal(result.profile.databaseUrl, rotated);
});

test('accepts a source require mode only after upgrading returned and actual connections to verification', async () => {
  const fake = transport();
  const result = await prepareDevelopmentDatabase(
    options({ connectionString: source + '?sslmode=require' }),
    fake.dependencies,
  );
  assert.equal(new URL(result.databaseUrl).searchParams.get('sslmode'), 'verify-full');
  assert.equal(fake.state.config.ssl.rejectUnauthorized, true);
});

test('URL validation is pure and rejects private, custom, spoofed and non-development targets', () => {
  assert.doesNotThrow(() => assertRailwayDatabaseUrl(target));
  for (const value of [
    target.replace('shuttle.proxy.rlwy.net', 'postgres.railway.internal'),
    target.replace('shuttle.proxy.rlwy.net', 'shuttle.proxy.rlwy.net.attacker.invalid'),
    target.replace('shuttle.proxy.rlwy.net', 'attacker.invalid'),
    target.replace('shuttle.proxy.rlwy.net', '127.0.0.1'),
    target.replace('shuttle.proxy.rlwy.net', 'nested.shuttle.proxy.rlwy.net'),
    target.replace(':15140', ''),
    target.replace('assessment_dev', 'railway'),
    target.replace('assessment_dev', 'production'),
    target.replace('assessment_dev', '%61ssessment_dev'),
    target.replace('postgresql:', 'https:'),
    target.replace('sslmode=verify-full', 'sslmode=disable'),
    target.replace('sslmode=verify-full', 'sslmode=require'),
    target + '&host=attacker.invalid',
    target + '&sslmode=disable',
    target + '&uselibpqcompat=true',
    target + '&sslrootcert=relative.pem',
    target + '#unexpected',
  ])
    assert.throws(() => assertRailwayDatabaseUrl(value), /verified Railway public/);
});

test('rejects invalid IDs and mismatched trust before opening a connection', async () => {
  for (const update of [
    { projectId: 'unbound-project' },
    { trustedProfile: { ...saved(), serviceId: '10000000-0000-4000-8000-000000000004' } },
    { trustedProfile: { ...saved(), provider: 'docker' } },
    { trustedProfile: { ...saved(), purpose: 'production' } },
    { trustedProfile: { ...saved(), endpointFingerprint: '0'.repeat(64) } },
    { trustedProfile: { ...saved(), databaseUrl: target.replace(':15140', ':15141') } },
  ]) {
    const fake = transport();
    await assert.rejects(prepareDevelopmentDatabase(options(update), fake.dependencies));
    assert.equal(fake.state.config, null);
  }
});

test('does not adopt an untrusted existing target or initialize around unrelated databases', async () => {
  for (const databases of [['assessment_dev'], ['production'], ['assessment_dev', 'other']]) {
    const fake = transport({ databases });
    await assert.rejects(
      prepareDevelopmentDatabase(options(), fake.dependencies),
      /existing development|other databases/,
    );
    assert.equal(
      fake.calls.some((sql) => sql.startsWith('CREATE')),
      false,
    );
    assert.equal(fake.state.ended, true);
  }
});

test('does not recreate a missing previously trusted database', async () => {
  const fake = transport();
  await assert.rejects(
    prepareDevelopmentDatabase(options({ trustedProfile: saved() }), fake.dependencies),
    /missing; restore/,
  );
  assert.equal(
    fake.calls.some((sql) => sql.startsWith('CREATE')),
    false,
  );
});

test('refuses user tables or views in the default Railway DB without changing data', async () => {
  for (const trustedProfile of [undefined, saved()]) {
    const fake = transport({
      databases: trustedProfile ? ['assessment_dev'] : [],
      objects: ['users'],
    });
    await assert.rejects(
      prepareDevelopmentDatabase(options({ trustedProfile }), fake.dependencies),
      /default database is not empty/,
    );
    assert.equal(
      fake.calls.some((sql) => sql.startsWith('CREATE')),
      false,
    );
  }
});

test('refuses the wrong PostgreSQL version, plaintext or unverified TLS', async () => {
  for (const settings of [{ version: '180001' }, { encrypted: false }, { authorized: false }]) {
    const fake = transport(settings);
    await assert.rejects(
      prepareDevelopmentDatabase(options(), fake.dependencies),
      /PostgreSQL 17|TLS identity/,
    );
    assert.equal(
      fake.calls.some((sql) => sql.startsWith('CREATE')),
      false,
    );
    assert.equal(fake.state.released, true);
    assert.equal(fake.state.ended, true);
  }
});

test('redacts driver failures, preserves them over cleanup failures and omits error causes', async () => {
  const fake = transport({
    failure: `Connection rejected ${source}`,
    endFailure: `Cleanup rejected ${source}`,
  });
  await assert.rejects(prepareDevelopmentDatabase(options(), fake.dependencies), (error) => {
    assert.match(error.message, /preparation failed/);
    assert.equal(error.message.includes('synthetic-secret'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(fake.state.ended, true);
});

test('loads an explicit valid public CA and persists verify-full trust for runtime clients', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-railway-ca-'));
  try {
    const file = join(directory, 'ca.pem');
    writeFileSync(file, rootCertificates[0], { mode: 0o600 });
    const fake = transport();
    const result = await prepareDevelopmentDatabase(
      options({ tlsCACertificateFile: file }),
      fake.dependencies,
    );
    assert.equal(new URL(result.databaseUrl).searchParams.get('sslrootcert'), resolve(file));
    assert.equal(fake.state.config.ssl.ca, rootCertificates[0]);
    assert.equal(fake.state.config.ssl.rejectUnauthorized, true);
    writeFileSync(file, 'not-a-certificate');
    const second = transport();
    await assert.rejects(
      prepareDevelopmentDatabase(options({ tlsCACertificateFile: file }), second.dependencies),
      /public PEM/,
    );
    assert.equal(second.state.config, null);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('assessment-railway-ca-'));
    rmSync(directory, { recursive: true });
  }
});

test('the narrow PostgreSQL image pins the reviewed base, retains upstream guards and enforces verified TLS', () => {
  const dockerfile = readFileSync(
    new URL('../scripts/railway/postgres/Dockerfile', import.meta.url),
    'utf8',
  );
  const hook = readFileSync(
    new URL('../scripts/railway/postgres/init-ssl.sh', import.meta.url),
    'utf8',
  );
  const ignore = readFileSync(
    new URL('../scripts/railway/postgres/.dockerignore', import.meta.url),
    'utf8',
  );
  assert.match(
    dockerfile,
    /FROM ghcr\.io\/railwayapp-templates\/postgres-ssl:17@sha256:[a-f0-9]{64}/,
  );
  assert.match(dockerfile, /grep -c '\^SSL_DIR='/);
  assert.match(dockerfile, /bash -n \/usr\/local\/bin\/assessment-init-ssl\.sh/);
  assert.doesNotMatch(dockerfile, /^ENTRYPOINT/m);
  assert.match(dockerfile, /"ssl=on"/);
  assert.match(dockerfile, /"ssl_min_protocol_version=TLSv1\.2"/);
  assert.deepEqual(ignore.trim().split(/\r?\n/), ['*', '!Dockerfile', '!init-ssl.sh']);
  assert.equal(hook.includes('\r'), false);
  assert.match(
    hook,
    /subjectAltName=DNS:localhost,DNS:\$\{RAILWAY_PRIVATE_DOMAIN\},DNS:\$\{RAILWAY_TCP_PROXY_DOMAIN\}/,
  );
  assert.match(hook, /CA expiry requires a planned trust rotation/);
  assert.match(hook, /basicConstraints=critical,CA:FALSE/);
  assert.match(hook, /-purpose sslserver -verify_hostname/);
  for (const database of ['all', 'replication'])
    for (const address of ['0.0.0.0/0', '::/0'])
      assert.ok(hook.includes(`hostnossl ${database} all ${address} reject`));
  assert.doesNotMatch(hook, /DROP DATABASE|TRUNCATE|ALTER USER|ALTER ROLE|psql|rm -rf/);
});
