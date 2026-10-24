import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  readEnv,
  readJson,
  writePrivate,
  assertConfiguredDatabase,
  localInfrastructureServices,
} from './environment.mjs';
import { root, alive, requireDocker, run, composeArgs, waitFor } from './runtime.mjs';

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
export async function http(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
  return { response, payload: await response.json().catch(() => null) };
}

async function authentication(origin, role, credentials) {
  const cookies = new Map();
  async function request(path, options = {}) {
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...options.headers,
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        equals = pair.indexOf('=');
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    const payload = await response.json();
    if (!response.ok) throw new Error('AUTH_CHECK_FAILED');
    return payload.data;
  }
  const csrf = await request('/auth/csrf');
  await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'X-CSRF-Token': csrf.csrfToken },
    body: JSON.stringify({
      identifier: credentials.identifier,
      password: credentials.password,
      role,
    }),
  });
  try {
    const me = await request('/auth/me');
    if (me?.user?.role !== role) throw new Error('ROLE_MISMATCH');
    await request(role === 'ADMIN' ? '/admin/dashboard' : '/assessments?limit=10');
  } finally {
    const sessionCsrf = await request('/auth/csrf');
    await request('/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-CSRF-Token': sessionCsrf.csrfToken,
      },
      body: '{}',
    });
  }
  return 'CSRF, login, role, dashboard and logout passed';
}

export async function checkLocal({ print = true, isStopping = () => false } = {}) {
  const env = readEnv(join(root, 'backend/.env'));
  const credentials = readJson(join(root, '.local/credentials.json'));
  const config = readJson(join(root, '.local/config.json'));
  const databaseProfile =
    config?.databaseProvider === 'railway'
      ? readJson(join(root, '.local/railway.json'))
      : { provider: 'docker' };
  const infrastructureServices = localInfrastructureServices(config);
  const report = { checkedAt: new Date().toISOString(), checks: [] };
  const errors = [];
  const check = async (name, operation) => {
    if (isStopping()) throw new Error('Local checks cancelled.');
    try {
      report.checks.push({ name, status: 'PASS', detail: await operation() });
    } catch (error) {
      if (isStopping()) throw error;
      errors.push({ name, message: error.message });
      writePrivate(join(root, '.local/check-errors.json'), errors);
      report.checks.push({
        name,
        status: 'FAIL',
        detail: 'Unavailable or not configured; inspect private logs and local prerequisites.',
      });
    }
  };
  await check(
    config?.databaseProvider === 'railway'
      ? 'Docker Redis service'
      : 'Docker PostgreSQL/Redis services',
    async () => {
      if (!config) throw new Error('NO_CONFIGURATION');
      const docker = await requireDocker();
      let probeError;
      try {
        await waitFor(
          'Healthy local infrastructure containers',
          async () => {
            try {
              const status = await run(docker, composeArgs(config, ['ps', '--format', 'json']), {
                capture: true,
                stdoutOnly: true,
                timeout: 30000,
              });
              const rows = status.trim().startsWith('[')
                ? JSON.parse(status)
                : status
                    .split(/\r?\n/)
                    .filter(Boolean)
                    .map((line) => JSON.parse(line));
              if (
                !infrastructureServices.every((service) =>
                  rows.some(
                    (row) =>
                      row.Service === service &&
                      row.State === 'running' &&
                      row.Health === 'healthy',
                  ),
                )
              )
                throw new Error('INFRASTRUCTURE_NOT_HEALTHY');
              return true;
            } catch (error) {
              probeError = error;
              return false;
            }
          },
          { timeout: 60000, isStopping },
        );
      } catch (error) {
        throw probeError || error;
      }
      return config.databaseProvider === 'railway'
        ? 'Local Redis container is running and healthy; Railway PostgreSQL is checked separately'
        : 'Both containers are running and healthy';
    },
  );
  await check('PostgreSQL 17 and migrated schema', async () => {
    if (config?.databaseProvider === 'railway' && !databaseProfile)
      throw new Error('RAILWAY_DEVELOPMENT_PROFILE_REQUIRED');
    assertConfiguredDatabase(databaseProfile, env.DATABASE_URL);
    const { Pool } = backendRequire('pg');
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000,
    });
    try {
      const version = await pool.query('SHOW server_version_num');
      if (Math.floor(Number(version.rows[0].server_version_num) / 10000) !== 17)
        throw new Error('POSTGRES_17_REQUIRED');
      const migrations = await pool.query(
        'SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      );
      if (migrations.rows[0].count < 5) throw new Error('MIGRATIONS_MISSING');
      return config?.databaseProvider === 'railway'
        ? 'Provisioned Railway PostgreSQL 17 responds over verified TLS; migrations applied'
        : 'Native PostgreSQL 17 responds; migrations applied';
    } finally {
      await pool.end();
    }
  });
  for (const [name, key] of [
    ['Redis queue database', 'REDIS_QUEUE_URL'],
    ['Redis session database', 'REDIS_SESSION_URL'],
  ]) {
    await check(name, async () => {
      const url = new URL(env[key]);
      if (!['localhost', '127.0.0.1'].includes(url.hostname))
        throw new Error('REMOTE_REDIS_REFUSED');
      const Redis = backendRequire('ioredis');
      const redis = new Redis(env[key], {
        lazyConnect: true,
        connectTimeout: 3000,
        commandTimeout: 3000,
        retryStrategy: null,
        maxRetriesPerRequest: 0,
      });
      redis.on('error', () => {});
      try {
        await redis.connect();
        if ((await redis.ping()) !== 'PONG') throw new Error('REDIS_FAILED');
        return `PONG (database ${url.pathname.slice(1)})`;
      } finally {
        redis.disconnect();
      }
    });
  }
  for (const [name, url] of [
    ['Backend liveness', 'http://127.0.0.1:4000/api/v1/health/live'],
    ['Backend readiness', 'http://127.0.0.1:4000/api/v1/health/ready'],
    ['Student frontend and API proxy', 'http://localhost:3000/api/v1/health/live'],
    ['Admin frontend and API proxy', 'http://localhost:3001/api/v1/health/live'],
  ])
    await check(name, async () => {
      const { response, payload } = await http(url);
      if (!response.ok || !(payload?.data?.live || payload?.data?.ready))
        throw new Error('HTTP_UNHEALTHY');
      return `HTTP ${response.status}`;
    });
  for (const [name, origin] of [
    ['Student login page', 'http://localhost:3000'],
    ['Admin login page', 'http://localhost:3001'],
  ])
    await check(name, async () => {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('LOGIN_PAGE_FAILED');
      await response.text();
      return 'HTTP 200';
    });
  for (const [role, origin] of [
    ['student', 'http://localhost:3000'],
    ['admin', 'http://localhost:3001'],
  ])
    await check(`${role} authentication`, async () => {
      if (!credentials?.[role]?.verified) throw new Error('CREDENTIALS_NOT_VERIFIED');
      return authentication(origin, role.toUpperCase(), credentials[role]);
    });
  await check('Maintenance worker', async () => {
    const state = readJson(join(root, '.local/state.json'));
    if (!state?.services?.some((service) => service.name === 'maintenance' && alive(service.pid)))
      throw new Error('WORKER_NOT_RUNNING');
    const { Queue } = backendRequire('bullmq');
    const url = new URL(env.REDIS_QUEUE_URL);
    const queue = new Queue('attempt-finalize-v1', {
      prefix: env.JUDGE_QUEUE_PREFIX,
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        db: Number(url.pathname.slice(1)),
        connectTimeout: 2000,
        maxRetriesPerRequest: 0,
        retryStrategy: null,
      },
    });
    queue.on('error', () => {});
    try {
      if (!(await queue.getWorkers()).length) throw new Error('NO_QUEUE_WORKER');
      return 'Live process and actual BullMQ worker connection';
    } finally {
      await queue.close();
    }
  });
  if (env.EXECUTION_ENABLED === 'true') {
    await check('Python / Java / C++ judge', async () => {
      if (readJson(join(root, '.local/judge/gate-report.json'))?.status !== 'PASS')
        throw new Error('REAL_GATE_REQUIRED');
      const state = readJson(join(root, '.local/state.json'));
      if (!state?.services?.some((service) => service.name === 'judge' && alive(service.pid)))
        throw new Error('JUDGE_NOT_RUNNING');
      const judge = readEnv(join(root, 'backend/.env.judge.local'));
      const { MtlsBrokerClient } = backendRequire('./dist/workers/sandbox/broker-client.js');
      const broker = new MtlsBrokerClient(
        judge.SANDBOX_BROKER_URL,
        judge.SANDBOX_CA_FILE,
        judge.SANDBOX_CERT_FILE,
        judge.SANDBOX_KEY_FILE,
      );
      try {
        await broker.health();
      } finally {
        broker.close();
      }
      const { payload } = await http('http://127.0.0.1:4000/api/v1/health/ready');
      if (payload?.data?.dependencies?.execution !== 'READY')
        throw new Error('JUDGE_HEARTBEAT_MISSING');
      return 'Real gate passed; mTLS broker, pinned toolchains and live judge heartbeat healthy';
    });
  } else {
    const gate = readJson(join(root, '.local/judge/gate-report.json'));
    report.checks.push({
      name: 'Python / Java / C++ judge',
      status: 'DISABLED',
      detail:
        gate?.status === 'FAIL'
          ? 'The actual gVisor release gate failed. See .local/judge/gate.log. Execution remains disabled; no successful results are fabricated.'
          : 'Requires a passing real Linux gVisor / mTLS release gate. See .local/judge/last-error.json if present. No submitted code runs on the Windows host.',
    });
  }
  report.passed = report.checks.filter((check) => check.status === 'PASS').length;
  report.failed = report.checks.filter((check) => check.status === 'FAIL').length;
  writePrivate(join(root, '.local/check-report.json'), report);
  writePrivate(join(root, '.local/check-errors.json'), errors);
  if (print) {
    for (const item of report.checks)
      console.log(`${item.status.padEnd(8)} ${item.name}: ${item.detail}`);
    console.log(
      `${report.passed} passed; ${report.failed} failed; judge ${env.EXECUTION_ENABLED === 'true' ? 'enabled' : 'disabled'}.`,
    );
  }
  return report;
}
