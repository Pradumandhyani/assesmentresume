import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const targetName = 'assessment_dev';
const proxyHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.proxy\.rlwy\.net$/i;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const profileKeys = ['projectId', 'environmentId', 'serviceId'];
class RailwaySetupError extends Error {}
const safeError = (message) => new RailwaySetupError(message);

function parseConnection(value, source = false) {
  let url;
  try {
    if (typeof value !== 'string' || value.length > 16384) throw new Error();
    url = new URL(value);
    const allowed = new Set(['schema', 'sslmode', 'sslrootcert']);
    if (
      !['postgresql:', ...(source ? ['postgres:'] : [])].includes(url.protocol) ||
      !proxyHost.test(url.hostname) ||
      !url.port ||
      Number(url.port) < 1 ||
      Number(url.port) > 65535 ||
      !url.username ||
      !url.password ||
      url.hash ||
      !(source ? ['/railway', '/assessment_dev'] : ['/assessment_dev']).includes(url.pathname)
    )
      throw new Error();
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
    }
    if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')
      throw new Error();
    if (
      url.searchParams.has('sslmode') &&
      !['require', 'verify-full'].includes(url.searchParams.get('sslmode'))
    )
      throw new Error();
    if (url.searchParams.has('sslrootcert') && !isAbsolute(url.searchParams.get('sslrootcert')))
      throw new Error();
    if (!source && url.searchParams.get('sslmode') !== 'verify-full') throw new Error();
  } catch {
    throw safeError('A verified Railway public PostgreSQL proxy URL is required.');
  }
  return url;
}

/** Pure validation; never connects or reads certificates. Custom/private hosts are refused. */
export function assertRailwayDatabaseUrl(value) {
  parseConnection(value);
}

function identity(options) {
  const ids = Object.fromEntries(profileKeys.map((key) => [key, options[key]]));
  if (profileKeys.some((key) => !uuid.test(ids[key] ?? '')))
    throw safeError('The authorized Railway project, environment and service IDs are required.');
  return ids;
}

/** Endpoint and cloud identity binding, deliberately excluding credentials for rotation. */
export function railwayEndpointFingerprint(databaseUrl, options) {
  const ids = identity(options);
  const url = parseConnection(databaseUrl);
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...ids,
        host: url.hostname.toLowerCase(),
        port: url.port,
        database: targetName,
      }),
    )
    .digest('hex');
}

function certificate(file) {
  try {
    const path = resolve(file);
    if (!isAbsolute(file) || !statSync(path).isFile() || statSync(path).size > 1048576)
      throw new Error();
    const pem = readFileSync(path, 'utf8');
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!blocks?.length || /PRIVATE KEY/.test(pem)) throw new Error();
    for (const block of blocks) new X509Certificate(block);
    return { path, pem };
  } catch {
    throw safeError('The Railway CA file must contain valid public PEM certificates.');
  }
}

function poolFactory(config) {
  const { Pool } = backendRequire('pg');
  return new Pool(config);
}

/**
 * Initialize only the constant development database on an explicitly authorized
 * new Railway service. Existing targets require its previously saved private
 * profile. No migrations, account changes, resets or cloud calls occur here.
 * The second argument is a unit-test transport seam, never an application option.
 */
export async function prepareDevelopmentDatabase(options, dependencies = {}) {
  const ids = identity(options);
  const source = parseConnection(options.connectionString, true);
  source.protocol = 'postgresql:';
  source.pathname = `/${targetName}`;
  source.searchParams.set('schema', 'public');
  source.searchParams.set('sslmode', 'verify-full');
  let ca;
  const caFile = options.tlsCACertificateFile || source.searchParams.get('sslrootcert');
  if (caFile) {
    ca = certificate(caFile);
    source.searchParams.set('sslrootcert', ca.path);
  }
  const databaseUrl = source.toString();
  const endpointFingerprint = railwayEndpointFingerprint(databaseUrl, ids);
  const profile = {
    version: 1,
    provider: 'railway',
    purpose: 'development',
    ...ids,
    databaseUrl,
    endpointFingerprint,
  };
  if (options.trustedProfile) {
    const previous = options.trustedProfile;
    if (
      previous.version !== 1 ||
      previous.provider !== 'railway' ||
      previous.purpose !== 'development' ||
      profileKeys.some((key) => previous[key] !== ids[key]) ||
      previous.endpointFingerprint !== endpointFingerprint ||
      railwayEndpointFingerprint(previous.databaseUrl, previous) !== endpointFingerprint
    )
      throw safeError('The saved development profile does not match this Railway service.');
  }
  // Remove URL SSL parameters so pg cannot overwrite the explicit verified TLS
  // configuration. The returned runtime URL retains verify-full and the CA path.
  const management = new URL(databaseUrl);
  management.pathname = '/railway';
  for (const key of ['schema', 'sslmode', 'sslrootcert']) management.searchParams.delete(key);
  const poolConfig = {
    connectionString: management.toString(),
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000,
    query_timeout: 15000,
    ssl: {
      rejectUnauthorized: true,
      servername: management.hostname,
      minVersion: 'TLSv1.2',
      ...(ca ? { ca: ca.pem } : {}),
    },
  };
  let pool;
  let client;
  let created = false;
  let result;
  let failure;
  try {
    pool = (dependencies.poolFactory ?? poolFactory)(poolConfig);
    client = await pool.connect();
    if (!client.connection?.stream?.encrypted || client.connection.stream.authorized !== true)
      throw safeError('Railway database TLS identity verification is required.');
    const version = await client.query('SHOW server_version_num');
    if (Math.floor(Number(version.rows[0]?.server_version_num) / 10000) !== 17)
      throw safeError('The authorized development service must run PostgreSQL 17.');
    const existing = await client.query(
      "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', 'railway')",
    );
    if (existing.rows.some((row) => row.datname !== targetName))
      throw safeError('This Railway service contains other databases; no changes were made.');
    const targetExists = existing.rows.some((row) => row.datname === targetName);
    if (targetExists && !options.trustedProfile)
      throw safeError('An existing development database requires its trusted private profile.');
    const objects = await client.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1",
    );
    if (objects.rows.length)
      throw safeError('The Railway default database is not empty; no changes were made.');
    if (!targetExists) {
      if (options.trustedProfile)
        throw safeError('The previously configured development database is missing; restore it.');
      // Constant SQL only. CREATE DATABASE cannot run in a transaction. A racing
      // initializer fails safely; it cannot adopt an untrusted pre-existing DB.
      await client.query('CREATE DATABASE assessment_dev');
      created = true;
    }
    result = {
      databaseUrl,
      fingerprint: endpointFingerprint,
      endpointFingerprint,
      profile,
      created,
    };
  } catch (error) {
    // Driver errors may include secret-bearing connection details. Never expose
    // them through command output or attach their cause to the safe exception.
    failure =
      error instanceof RailwaySetupError
        ? error
        : safeError(
            'Railway database preparation failed. Check verified TLS, the preserved CA, connectivity and database permissions; no existing data was reset.',
          );
  } finally {
    try {
      client?.release();
    } catch {
      // Cleanup errors cannot expose raw driver diagnostics or credentials.
    }
    try {
      await pool?.end();
    } catch {
      failure ??= safeError(
        'Railway database connection cleanup failed. Check private diagnostics.',
      );
    }
  }
  if (failure) throw failure;
  return result;
}
