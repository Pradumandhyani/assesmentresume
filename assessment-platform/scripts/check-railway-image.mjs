/** Explicit real Docker/PostgreSQL/TLS smoke gate. Not part of unit tests. */
import assert from 'node:assert/strict';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, run, dockerCommand, stopCommands } from './local/runtime.mjs';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { Pool } = requireBackend('pg');
const runId = randomBytes(12).toString('hex');
const resource = `assessment-railway-tls-smoke-${runId}`;
const label = 'assessment.railway-tls-smoke';
const image = `${resource}:test`;
const volume = `${resource}-data`;
const names = [`${resource}-initial`, `${resource}-renewed`];
const directory = join(root, '.local', 'railway-image-smoke', runId);
const docker = dockerCommand();
const user = 'assessment_smoke_admin';
const password = randomBytes(32).toString('base64url');
const privateDomain = 'assessment-smoke.railway.internal';
const initialDomain = 'assessment-smoke-one.proxy.rlwy.net';
const renewedDomain = 'assessment-smoke-two.proxy.rlwy.net';
const report = {
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  checks: [],
};
let phase = 'preflight';
let cancelled = false;
const cancel = () => {
  cancelled = true;
  void stopCommands();
};
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

const command = (args, options = {}) =>
  run(docker, args, { capture: true, stdoutOnly: true, timeout: 30000, ...options });
const digest = (value) => createHash('sha256').update(value).digest('hex');
function check(name, details = {}) {
  report.checks.push({ name, status: 'PASS', ...details });
  console.log(`PASS ${name}`);
}
function active() {
  if (cancelled) throw new Error('SMOKE_CANCELLED');
}
async function untilReady(probe) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    active();
    try {
      if (await probe()) return;
    } catch {
      // Starting PostgreSQL may not accept connections yet. Never print its
      // raw connection diagnostics while retrying the bounded readiness probe.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('SMOKE_READINESS_TIMEOUT');
}
async function owned(kind, name) {
  if (![image, volume, ...names].includes(name)) return false;
  try {
    const field = kind === 'volume' ? '.Labels' : '.Config.Labels';
    return (
      (await command([kind, 'inspect', '--format', `{{ index ${field} "${label}" }}`, name])) ===
      runId
    );
  } catch {
    return false;
  }
}
async function cleanup() {
  let failed = false;
  for (const name of names) {
    if (await owned('container', name))
      await command(['container', 'rm', '--force', name], { timeout: 60000 }).catch(() => {
        failed = true;
      });
  }
  if (await owned('volume', volume))
    await command(['volume', 'rm', volume]).catch(() => {
      failed = true;
    });
  if (await owned('image', image))
    await command(['image', 'rm', image]).catch(() => {
      failed = true;
    });
  report.cleanup = failed ? 'FAILED' : 'COMPLETE';
  if (failed) {
    report.status = 'FAIL';
    process.exitCode = 1;
  }
}
async function start(name, domain) {
  active();
  const envFile = join(directory, `${domain.split('.')[0]}.env`);
  writeFileSync(
    envFile,
    [
      `POSTGRES_USER=${user}`,
      `POSTGRES_PASSWORD=${password}`,
      'POSTGRES_DB=railway',
      'PGDATA=/var/lib/postgresql/data/pgdata',
      'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      'RAILWAY_VOLUME_MOUNT_PATH=/var/lib/postgresql/data',
      `RAILWAY_PRIVATE_DOMAIN=${privateDomain}`,
      `RAILWAY_TCP_PROXY_DOMAIN=${domain}`,
      '',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  await command([
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    `${label}=${runId}`,
    '--env-file',
    envFile,
    '--mount',
    `type=volume,source=${volume},target=/var/lib/postgresql/data`,
    '--publish',
    '127.0.0.1::5432',
    '--stop-timeout',
    '20',
    image,
  ]);
  await untilReady(async () => {
    await command([
      'exec',
      name,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-p',
      '5432',
      '-U',
      user,
      '-d',
      'railway',
    ]);
    return true;
  });
  const portText = await command(['port', name, '5432/tcp']);
  assert.match(portText, /^127\.0\.0\.1:[1-9]\d{0,4}$/);
  const port = Number(portText.slice(portText.lastIndexOf(':') + 1));
  const ca = await command(['exec', name, 'cat', '/var/lib/postgresql/data/certs/root.crt']);
  const leaf = await command(['exec', name, 'cat', '/var/lib/postgresql/data/certs/server.crt']);
  new X509Certificate(ca);
  const cert = new X509Certificate(leaf);
  assert.ok(cert.checkHost(domain));
  assert.ok(cert.checkHost(privateDomain));
  return { name, domain, port, ca, leaf };
}
function poolFor(connection, ssl = true, servername = connection.domain) {
  return new Pool({
    host: '127.0.0.1',
    port: connection.port,
    database: 'railway',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    ssl: ssl
      ? { ca: connection.ca, rejectUnauthorized: true, servername, minVersion: 'TLSv1.2' }
      : false,
  });
}
async function verified(connection, persistence = false) {
  active();
  const pool = poolFor(connection);
  let client;
  try {
    client = await pool.connect();
    assert.equal(client.connection.stream.encrypted, true);
    assert.equal(client.connection.stream.authorized, true);
    const result = await client.query(
      "SELECT current_setting('server_version_num') AS version, current_database() AS database",
    );
    assert.equal(Math.floor(Number(result.rows[0].version) / 10000), 17);
    assert.equal(result.rows[0].database, 'railway');
    const tls = await client.query(
      'SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()',
    );
    assert.equal(tls.rows[0].ssl, true);
    assert.match(tls.rows[0].version, /^TLSv1\.[23]$/);
    if (persistence) {
      const row = await client.query('SELECT value FROM assessment_smoke_persistence WHERE id=1');
      assert.equal(row.rows[0].value, 'retained');
    } else {
      await client.query(
        'CREATE TABLE assessment_smoke_persistence (id integer PRIMARY KEY, value text NOT NULL)',
      );
      await client.query(
        "INSERT INTO assessment_smoke_persistence (id,value) VALUES (1,'retained')",
      );
    }
    return { postgresVersion: result.rows[0].version, tlsVersion: tls.rows[0].version };
  } finally {
    client?.release();
    await pool.end();
  }
}
async function rejected(connection, ssl, servername, expected) {
  const pool = poolFor(connection, ssl, servername);
  try {
    await assert.rejects(pool.query('SELECT 1'), (error) => error.code === expected);
  } finally {
    await pool.end();
  }
}

mkdirSync(directory, { recursive: true, mode: 0o700 });
try {
  console.log(
    'Building and testing a dedicated disposable Railway TLS image; secrets are not printed.',
  );
  assert.equal(await command(['info', '--format', '{{.OSType}}']), 'linux');
  phase = 'image build';
  await command(
    [
      'build',
      '--label',
      `${label}=${runId}`,
      '--tag',
      image,
      join(root, 'scripts', 'railway', 'postgres'),
    ],
    { timeout: 600000, logFile: join(directory, 'build.log') },
  );
  assert.equal(await owned('image', image), true);
  report.imageDigest = await command(['image', 'inspect', '--format', '{{.Id}}', image]);
  check('Pinned image built and shell syntax/PG17 build checks executed');
  phase = 'dedicated volume';
  await command(['volume', 'create', '--label', `${label}=${runId}`, volume]);
  assert.equal(await owned('volume', volume), true);
  phase = 'first initialization';
  const initial = await start(names[0], initialDomain);
  const versions = await verified(initial);
  check('PostgreSQL 17 accepts actual CA and public-hostname-verified TLS', versions);
  phase = 'plaintext rejection';
  await rejected(initial, false, initialDomain, '28000');
  check('Plaintext TCP authentication rejected by PostgreSQL HBA');
  phase = 'incorrect server identity rejection';
  await rejected(initial, true, 'wrong-host.proxy.rlwy.net', 'ERR_TLS_CERT_ALTNAME_INVALID');
  check('Incorrect TLS server hostname rejected by the client');
  phase = 'restart persistence';
  await command(['restart', '--time', '20', names[0]], { timeout: 60000 });
  await untilReady(async () => {
    await verified(initial, true);
    return true;
  });
  const restartCa = await command([
    'exec',
    names[0],
    'cat',
    '/var/lib/postgresql/data/certs/root.crt',
  ]);
  const restartLeaf = await command([
    'exec',
    names[0],
    'cat',
    '/var/lib/postgresql/data/certs/server.crt',
  ]);
  assert.equal(digest(restartCa), digest(initial.ca));
  assert.equal(digest(restartLeaf), digest(initial.leaf));
  check('Database row, CA and valid leaf preserved across an actual container restart');
  phase = 'public SAN renewal';
  assert.equal(await owned('container', names[0]), true);
  await command(['stop', '--time', '20', names[0]], { timeout: 60000 });
  await command(['container', 'rm', names[0]]);
  const renewed = await start(names[1], renewedDomain);
  await verified(renewed, true);
  assert.equal(digest(renewed.ca), digest(initial.ca));
  assert.notEqual(digest(renewed.leaf), digest(initial.leaf));
  check('Changed public SAN renews only the server leaf and preserves CA and database rows');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failedPhase = phase;
  report.errorCode = /^[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'SMOKE_FAILED';
  process.exitCode = 1;
  // pg/Docker errors can contain connection details. Retain only phase/code.
  console.error(
    `Railway image smoke failed during ${phase}. See the private report/build log; raw errors were suppressed.`,
  );
  for (let index = 0; index < names.length; index++) {
    if (await owned('container', names[index]))
      await command(['logs', names[index]], {
        logFile: join(directory, `postgres-${index}.log`),
      }).catch(() => {});
  }
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  await cleanup();
  report.completedAt = new Date().toISOString();
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    `Smoke ${report.status}; owned-resource cleanup ${report.cleanup}. Private artifacts: .local/railway-image-smoke/${runId}/`,
  );
}
