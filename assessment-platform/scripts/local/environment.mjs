import { randomBytes, createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { parseEnv } from 'node:util';
import net from 'node:net';
import { assertRailwayDatabaseUrl, railwayEndpointFingerprint } from '../railway/database.mjs';

export const readJson = (file, fallback = null) => {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      'A private local JSON file is invalid. Restore its valid configuration; its contents were not logged.',
    );
  }
};
export const readEnv = (file) => (existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {});
export function writePrivate(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
const secret = () => randomBytes(32).toString('base64url');
const placeholder = (value) =>
  !value || /replace[-_ ]|your[-_ ]|changeme|example\.invalid/i.test(value);

/** Keep comments and unrelated values; back up every existing environment file before editing. */
export function updateEnvironment(root, name, updates) {
  const file = join(root, name);
  const existing = existsSync(file);
  let text = existing ? readFileSync(file, 'utf8') : '';
  const before = text;
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment setting name.');
    if (/[\r\n]/.test(value)) throw new Error(`Multiline setting is unsupported: ${key}`);
    // Single quotes preserve literal backslashes in existing passwords and Windows paths.
    const quoted = !String(value).includes("'")
      ? `'${value}'`
      : !String(value).includes('`')
        ? '`' + value + '`'
        : !String(value).includes('"') && !/\\[nr]/.test(value)
          ? `"${value}"`
          : null;
    if (quoted === null)
      throw new Error(`Cannot safely serialize ${key}; the existing file was preserved.`);
    const line = `${key}=${quoted}`;
    const pattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=`);
    let replaced = false;
    const lines = text.split(/\r?\n/).flatMap((existingLine) => {
      const match = existingLine.match(pattern);
      if (!match) return [existingLine];
      const existingValue = existingLine.slice(match[0].length).trimStart();
      if (
        ["'", '"', '`'].includes(existingValue[0]) &&
        !existingValue.slice(1).includes(existingValue[0])
      )
        throw new Error(`Cannot safely update multiline ${key}; the existing file was preserved.`);
      if (replaced) return [];
      replaced = true;
      return [line];
    });
    text = replaced ? lines.join('\n') : `${text.trimEnd()}\n${line}\n`;
  }
  if (text === before) return;
  if (existing) {
    const backup = join(
      root,
      '.local/backups',
      `${name.replaceAll(/[\\/]/g, '_')}.${Date.now()}.${randomBytes(3).toString('hex')}.bak`,
    );
    mkdirSync(resolve(backup, '..'), { recursive: true, mode: 0o700 });
    copyFileSync(file, backup);
  }
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, text.trimStart(), { mode: 0o600 });
}

export function assertLocalDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A valid local PostgreSQL URL is required.');
  }
  if (
    url.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/(^|[_-])(dev|test)([_-]|$)/i.test(url.pathname.slice(1))
  ) {
    throw new Error(
      'Local startup only permits loopback PostgreSQL URLs and a dev/test database. No remote database was accessed.',
    );
  }
}

/** A remote target is permitted only through the explicitly provisioned private profile. */
export function assertConfiguredDatabase(profile, value) {
  if (!profile || profile.provider === 'docker') return assertLocalDatabase(value);
  if (
    profile.version !== 1 ||
    profile.provider !== 'railway' ||
    profile.purpose !== 'development' ||
    !['projectId', 'environmentId', 'serviceId'].every(
      (name) => typeof profile[name] === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(profile[name]),
    ) ||
    typeof profile.databaseUrl !== 'string' ||
    value !== profile.databaseUrl
  )
    throw new Error('Railway startup requires the matching private development database profile.');
  assertRailwayDatabaseUrl(value);
  if (profile.endpointFingerprint !== railwayEndpointFingerprint(value, profile))
    throw new Error('Railway development database endpoint does not match its approved profile.');
}

export const localInfrastructureServices = (config) =>
  config?.databaseProvider === 'railway' ? ['redis'] : ['postgres', 'redis'];

async function availablePort(preferred) {
  return new Promise((done, reject) => {
    const server = net.createServer();
    server.once('error', (error) => (error.code === 'EADDRINUSE' ? done(null) : reject(error)));
    server.listen(preferred, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => done(port));
    });
  });
}

export async function configureEnvironment(root, { railway = false } = {}) {
  root = resolve(root);
  mkdirSync(join(root, '.local'), { recursive: true, mode: 0o700 });
  const configFile = join(root, '.local/config.json');
  const previousConfig = readJson(configFile);
  const suffix = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 8);
  const config = previousConfig ?? { version: 1, project: `assessment-local-${suffix}` };
  const provider = railway ? 'railway' : (config.databaseProvider ?? 'docker');
  if (!['docker', 'railway'].includes(provider))
    throw new Error('Unknown configured database provider.');
  const databaseProfile =
    provider === 'railway' ? readJson(join(root, '.local/railway.json')) : { provider: 'docker' };
  if (provider === 'railway' && !databaseProfile)
    throw new Error(
      'Railway development database is not provisioned. Complete the explicit Railway setup first; no database settings were changed.',
    );
  if (provider === 'railway')
    assertConfiguredDatabase(databaseProfile, databaseProfile.databaseUrl);
  const infrastructure = readEnv(join(root, '.env'));
  const backend = readEnv(join(root, 'backend/.env'));
  const validName = (value) => /^[a-z][a-z0-9_]{0,50}$/.test(value ?? '');
  const dbName =
    validName(infrastructure.POSTGRES_DB) &&
    /(^|_)(dev|test)(_|$)/i.test(infrastructure.POSTGRES_DB)
      ? infrastructure.POSTGRES_DB
      : 'assessment_dev';
  const dbUser = validName(infrastructure.POSTGRES_USER)
    ? infrastructure.POSTGRES_USER
    : 'assessment_dev';
  // A remote backend setting must not cause live credentials to be reused locally.
  let remote = false;
  if (provider === 'docker' && backend.DATABASE_URL && !placeholder(backend.DATABASE_URL)) {
    try {
      assertLocalDatabase(backend.DATABASE_URL);
    } catch {
      remote = true;
    }
  }
  const dbPassword =
    !remote && !placeholder(infrastructure.POSTGRES_PASSWORD)
      ? infrastructure.POSTGRES_PASSWORD
      : secret();
  const choosePort = async (name, preferred) => {
    if (infrastructure[name]) {
      const port = Number(infrastructure[name]);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`Invalid ${name} in .env`);
      return port;
    }
    return (await availablePort(preferred)) ?? (await availablePort(0));
  };
  const postgresPort = await choosePort('POSTGRES_PORT', 5432);
  const redisPort = await choosePort('REDIS_PORT', 6379);
  const databaseUrl =
    provider === 'railway'
      ? databaseProfile.databaseUrl
      : `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@127.0.0.1:${postgresPort}/${dbName}?schema=public`;
  assertConfiguredDatabase(databaseProfile, databaseUrl);
  const credentialsFile = join(root, '.local/credentials.json');
  const credentials = readJson(credentialsFile) ?? {
    notice:
      'Private local development credentials. Existing accounts are never reset. provisioned=false until database provisioning succeeds.',
    provisioned: false,
    student: {
      identifier: backend.DEV_STUDENT_ID || `LOCAL-${suffix.toUpperCase()}`,
      name: backend.DEV_STUDENT_NAME || 'Local Student',
      password: (!remote && backend.DEV_STUDENT_PASSWORD) || secret(),
    },
    admin: {
      identifier: backend.DEV_ADMIN_EMAIL || `admin-${suffix}@localhost.test`,
      name: backend.DEV_ADMIN_NAME || 'Local Administrator',
      password: (!remote && backend.DEV_ADMIN_PASSWORD) || secret(),
    },
  };
  if (
    provider !== (previousConfig?.databaseProvider ?? 'docker') ||
    (provider === 'railway' &&
      previousConfig?.databaseFingerprint !== databaseProfile.endpointFingerprint)
  ) {
    credentials.provisioned = false;
    for (const role of ['student', 'admin']) credentials[role].verified = false;
  }
  for (const role of ['student', 'admin']) {
    if (!credentials[role]?.identifier || credentials[role].password?.length < 12)
      throw new Error(
        `Existing local ${role} credentials are incomplete or too short; no account was changed.`,
      );
  }
  writePrivate(credentialsFile, credentials);

  const defaultKeyring = join(root, 'backend/sandbox/secrets/keyring.local.json');
  if (previousConfig?.keyring && !existsSync(previousConfig.keyring))
    throw new Error(
      'The previously configured testcase keyring is missing. Restore it from backup; keys will not be regenerated.',
    );
  const keyringPath = config.keyring || defaultKeyring;
  if (!existsSync(keyringPath)) {
    if (backend.QUESTION_KEYRING_FILE && !placeholder(backend.PUBLIC_TESTCASE_KMS_KEY_ID))
      throw new Error(
        'Existing encryption configuration has no original full keyring. Restore it before setup; no replacement keys were generated.',
      );
    // Same format and IDs as sandbox:dev-keys. Exclusive creation never rotates old keys.
    mkdirSync(resolve(keyringPath, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(
      keyringPath,
      `${JSON.stringify(
        {
          keys: ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'].map((dataClass) => ({
            id: `development-${dataClass.toLowerCase()}-v1`,
            dataClass,
            base64: randomBytes(32).toString('base64'),
          })),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  }
  const keyring = readJson(keyringPath);
  for (const kind of ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS']) {
    if (
      !keyring?.keys?.some(
        (key) => key.dataClass === kind && /^[A-Za-z0-9+/]{43}=$/.test(key.base64),
      )
    )
      throw new Error('Existing testcase keyring is invalid or incomplete; it was preserved.');
  }
  // Only authoring keys enter the combined local API; diagnostics remain with the judge.
  const questionKeyring =
    backend.QUESTION_KEYRING_FILE ||
    join(root, 'backend/sandbox/secrets/question-keyring.local.json');
  if (!existsSync(questionKeyring)) {
    if (backend.QUESTION_KEYRING_FILE)
      throw new Error(
        'Configured question keyring is missing. Restore the original; it was not replaced.',
      );
    writePrivate(questionKeyring, {
      keys: keyring.keys.filter((key) => ['PUBLIC', 'HIDDEN'].includes(key.dataClass)),
    });
  }
  const catalog =
    backend.SANDBOX_TOOLCHAIN_CATALOG ||
    join(root, 'backend/sandbox/toolchains/catalog.local.json');
  const settings = {
    ...readEnv(join(root, 'backend/.env.example')),
    ...backend,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '4000',
    DATABASE_URL: databaseUrl,
    ADMIN_DATABASE_URL: databaseUrl,
    REDIS_QUEUE_URL: `redis://127.0.0.1:${redisPort}/0`,
    REDIS_SESSION_URL: `redis://127.0.0.1:${redisPort}/1`,
    APP_ORIGINS: [
      ...new Set([
        ...(backend.APP_ORIGINS || '').split(',').filter(Boolean),
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ]),
    ].join(','),
    ADMIN_ORIGINS: [
      ...new Set([
        ...(backend.ADMIN_ORIGINS || '').split(',').filter(Boolean),
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ]),
    ].join(','),
    SESSION_SECURE: 'false',
    SESSION_COOKIE_NAME: backend.SESSION_COOKIE_NAME?.startsWith('__Host-')
      ? 'assessment_session_dev'
      : backend.SESSION_COOKIE_NAME || 'assessment_session_dev',
    CSRF_SIGNING_KEY:
      !remote && backend.CSRF_SIGNING_KEY?.length >= 32 ? backend.CSRF_SIGNING_KEY : secret(),
    EXECUTION_ENABLED: 'false',
    JUDGE_QUEUE_PREFIX: backend.JUDGE_QUEUE_PREFIX || `assessment-local-${suffix}`,
    PUBLIC_TESTCASE_KMS_KEY_ID: keyring.keys.find((key) => key.dataClass === 'PUBLIC').id,
    QUESTION_KEYRING_FILE: questionKeyring,
    SANDBOX_TOOLCHAIN_CATALOG: catalog,
    DEV_STUDENT_ID: credentials.student.identifier,
    DEV_STUDENT_NAME: credentials.student.name,
    DEV_STUDENT_PASSWORD: credentials.student.password,
    DEV_ADMIN_EMAIL: credentials.admin.identifier,
    DEV_ADMIN_NAME: credentials.admin.name,
    DEV_ADMIN_PASSWORD: credentials.admin.password,
  };
  updateEnvironment(root, '.env', {
    ...readEnv(join(root, '.env.example')),
    ...infrastructure,
    POSTGRES_DB: dbName,
    POSTGRES_USER: dbUser,
    POSTGRES_PASSWORD: dbPassword,
    POSTGRES_PORT: String(postgresPort),
    REDIS_PORT: String(redisPort),
    DATABASE_URL: databaseUrl,
  });
  updateEnvironment(root, 'backend/.env', settings);
  const maintenance = {
    ...readEnv(join(root, 'backend/.env.maintenance.example')),
    ...readEnv(join(root, 'backend/.env.maintenance.local')),
    NODE_ENV: 'development',
    DATABASE_MAINTENANCE_URL: databaseUrl,
    REDIS_QUEUE_URL: settings.REDIS_QUEUE_URL,
    JUDGE_QUEUE_PREFIX: settings.JUDGE_QUEUE_PREFIX,
  };
  updateEnvironment(root, 'backend/.env.maintenance.local', maintenance);
  for (const app of ['frontend', 'admin']) {
    updateEnvironment(root, `${app}/.env.local`, {
      ...readEnv(join(root, `${app}/.env.example`)),
      ...readEnv(join(root, `${app}/.env.local`)),
      NEXT_PUBLIC_API_BASE_URL: '/api/v1',
      BACKEND_API_URL: 'http://127.0.0.1:4000',
    });
  }
  config.keyring = keyringPath;
  config.catalog = catalog;
  config.databaseProvider = provider;
  if (provider === 'railway') config.databaseFingerprint = databaseProfile.endpointFingerprint;
  writePrivate(configFile, config);
  const connections = [
    'DATABASE_URL',
    'ADMIN_DATABASE_URL',
    'REDIS_QUEUE_URL',
    'REDIS_SESSION_URL',
  ];
  const generated = ['CSRF_SIGNING_KEY', 'DEV_STUDENT_PASSWORD', 'DEV_ADMIN_PASSWORD'];
  writePrivate(join(root, '.local/environment-report.json'), {
    note: `Values intentionally omitted. Database provider: ${provider}. Configuration initializes execution disabled; local:up enables it only after the real Linux gVisor gate passes.`,
    variables: Object.keys(settings).map((name) => ({
      name,
      category: connections.includes(name)
        ? provider === 'railway' && ['DATABASE_URL', 'ADMIN_DATABASE_URL'].includes(name)
          ? 'Provisioned Railway development connection'
          : 'Local Docker connection'
        : backend[name] === settings[name]
          ? 'Existing value preserved'
          : generated.includes(name)
            ? 'Automatically generated value'
            : 'Local development setting',
    })),
    infrastructureRequired: [
      'Docker Linux engine',
      'Dedicated Linux gVisor runtime, reviewed toolchains and mTLS for execution',
    ],
    railwayRequired:
      provider === 'railway' ? ['Private provisioned Railway development database profile'] : [],
    externalCredentialsRequired: [],
    backups: relative(root, join(root, '.local/backups')),
  });
  return { config, databaseProfile, backend: settings, maintenance, credentials, credentialsFile };
}
