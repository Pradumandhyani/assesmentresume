import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import net from 'node:net';
import {
  configureEnvironment,
  readEnv,
  readJson,
  writePrivate,
  assertConfiguredDatabase,
  localInfrastructureServices,
  updateEnvironment,
} from './local/environment.mjs';
import {
  root,
  alive,
  run,
  pnpm,
  requireDocker,
  dockerCommand,
  composeArgs,
  checkDockerStorage,
  waitFor,
  startService,
  stopServices,
  stopCommands,
  serviceReady,
} from './local/runtime.mjs';
import { checkLocal, http } from './local/check.mjs';
import { prepareFrontends } from './local/assets.mjs';
import { prepareJudge, stopJudge } from './local/judge.mjs';

const command = process.argv[2] || 'up';
const local = join(root, '.local'),
  lockFile = join(local, 'lock.json'),
  stopFile = join(local, 'stop.json');
const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const remove = (file) => {
  if (existsSync(file)) unlinkSync(file);
};

/** Explicit core-only startup never provisions, inspects or trusts a cached judge gate. */
export async function prepareOptionalJudge(
  settings,
  docker,
  { skipJudge = false, force = false, prepare = prepareJudge } = {},
) {
  if (skipJudge) return null;
  return prepare(settings, docker, { force });
}

async function versions() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 12) throw new Error('Use Node 24.12.0 or newer within major 24.');
  const version = await pnpm(['--version'], { capture: true, timeout: 15000 });
  const [pmMajor, pmMinor, pmPatch] = version.split('.').map(Number);
  if (pmMajor !== 10 || pmMinor < 34 || (pmMinor === 34 && pmPatch < 6))
    throw new Error('Use pnpm >=10.34.6 <11.');
  console.log(`Node ${process.versions.node}; pnpm ${version}`);
}
function acquire(token) {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const previous = readJson(lockFile);
  if (previous && alive(previous.pid)) return false;
  remove(lockFile);
  const descriptor = openSync(lockFile, 'wx', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  } finally {
    closeSync(descriptor);
  }
  remove(stopFile);
  return true;
}
async function portsAvailable() {
  for (const port of [3000, 3001, 4000])
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', () =>
        reject(
          new Error(
            `Port ${port} is already occupied. Stop that application or run pnpm local:down; no unrelated process was terminated.`,
          ),
        ),
      );
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
}
async function databaseSetup(settings) {
  assertConfiguredDatabase(settings.databaseProfile, settings.backend.DATABASE_URL);
  const { Pool } = backendRequire('pg');
  const pool = new Pool({
    connectionString: settings.backend.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const result = await pool.query('SHOW server_version_num');
    if (Math.floor(Number(result.rows[0].server_version_num) / 10000) !== 17)
      throw new Error('Development startup requires PostgreSQL 17.');
    for (const role of ['student', 'admin']) {
      const account = settings.credentials[role];
      const existing = await pool.query(
        role === 'student'
          ? 'SELECT u.password_hash FROM users u JOIN students s ON s.user_id=u.id WHERE s.external_id=$1'
          : 'SELECT password_hash FROM users WHERE lower(email)=lower($1)',
        [account.identifier],
      );
      if (!existing.rowCount)
        await pnpm([role === 'student' ? 'dev:student' : 'dev:admin-user'], {
          env: { ...process.env, ...settings.backend },
        });
      const provisioned = await pool.query(
        role === 'student'
          ? "SELECT u.password_hash FROM users u JOIN students s ON s.user_id=u.id WHERE s.external_id=$1 AND u.is_active=true AND u.role='STUDENT'"
          : "SELECT u.password_hash FROM users u JOIN admins a ON a.user_id=u.id WHERE lower(u.email)=lower($1) AND u.is_active=true AND u.role='ADMIN'",
        [account.identifier],
      );
      account.verified =
        !!provisioned.rowCount &&
        (await backendRequire('argon2').verify(
          provisioned.rows[0].password_hash,
          account.password,
        ));
      if (!account.verified)
        console.log(
          `Existing ${role} identity was preserved; its saved local password could not be verified.`,
        );
    }
    settings.credentials.provisioned = ['student', 'admin'].every(
      (role) => settings.credentials[role].verified,
    );
    writePrivate(settings.credentialsFile, settings.credentials);
    const fixture = await pool.query('SELECT id FROM assessments WHERE id=$1', [
      'b2400000-0000-4000-8000-000000000001',
    ]);
    const databaseClock = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const seedEnv = {
      ...process.env,
      ...settings.backend,
      TESTCASE_KEYRING_FILE: settings.config.keyring,
      DEV_EXECUTION_START_AT: new Date(databaseClock.getTime() - 60000).toISOString(),
    };
    if (!fixture.rowCount) await pnpm(['db:seed:judge'], { env: seedEnv });
    await pnpm(['db:seed:local'], { env: seedEnv });
  } finally {
    await pool.end();
  }
}
async function up() {
  const token = randomBytes(24).toString('hex');
  if (!acquire(token)) {
    console.log(
      'Local startup is already running. No duplicate processes were launched. Use pnpm local:check for status.',
    );
    return;
  }
  const services = [];
  let stopping = false,
    interval,
    docker,
    settings,
    failed = false;
  const state = {
    version: 1,
    pid: process.pid,
    token,
    phase: 'starting',
    services: [],
    startedAt: new Date().toISOString(),
  };
  const saveState = () => writePrivate(join(local, 'state.json'), state);
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  // Do not continue to the next startup operation after a shutdown request.
  const setupStep = async (operation) => {
    if (stopping) throw new Error('Startup cancelled.');
    const value = await operation();
    if (stopping) throw new Error('Startup cancelled.');
    return value;
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    await stopCommands();
    await stopServices(services, token);
    if (docker && settings) {
      try {
        await stopJudge(settings.config, docker);
        await run(
          docker,
          composeArgs(settings.config, ['stop', ...localInfrastructureServices(settings.config)]),
          {
            capture: true,
            timeout: 30000,
          },
        );
      } catch {
        console.error(
          'Could not stop local containers. Run pnpm local:down after Docker is available. Volumes were preserved.',
        );
      }
    }
    state.phase = failed ? 'failed' : 'stopped';
    saveState();
    remove(lockFile);
    remove(stopFile);
    finish();
  };
  const onSignal = () => {
    void stop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    saveState();
    interval = setInterval(() => {
      if (readJson(stopFile)?.token === token) void stop();
    }, 500);
    await setupStep(versions);
    console.log('Configuring private local environment (values are not logged)...');
    settings = await setupStep(() =>
      configureEnvironment(root, { railway: process.argv.includes('--railway') }),
    );
    console.log(
      'Private credentials: assessment-platform/.local/credentials.json (accounts provisioned after database startup).',
    );
    docker = await setupStep(() => requireDocker({ start: true }));
    checkDockerStorage(
      !existsSync(settings.config.catalog) || !existsSync(join(local, 'judge/build-report.json')),
    );
    await setupStep(portsAvailable);
    console.log('Installing locked dependencies...');
    await setupStep(() => pnpm(['install', '--frozen-lockfile']));
    console.log(
      settings.config.databaseProvider === 'railway'
        ? 'Using the provisioned Railway development PostgreSQL target; starting local Redis...'
        : 'Starting isolated PostgreSQL 17 and Redis; waiting for container health...',
    );
    await setupStep(() =>
      run(
        docker,
        composeArgs(settings.config, [
          'up',
          '-d',
          '--wait',
          '--wait-timeout',
          '180',
          ...localInfrastructureServices(settings.config),
        ]),
        { timeout: 240000 },
      ),
    );
    const backendEnv = { ...process.env, ...settings.backend };
    await setupStep(() => pnpm(['db:validate'], { env: backendEnv }));
    await setupStep(() => pnpm(['db:generate'], { env: backendEnv }));
    console.log('Applying reviewed migrations to the configured development database...');
    await setupStep(() => pnpm(['db:migrate'], { env: backendEnv }));
    if (!existsSync(settings.config.catalog)) {
      console.log(
        'Building real Python/Java/C++ toolchain images for the question bank. This does not enable student execution.',
      );
      await setupStep(() => pnpm(['sandbox:build'], { timeout: 1800000 }));
    }
    console.log('Generating Prisma Client and compiling the backend and workers...');
    await setupStep(() => pnpm(['--filter', '@assessment/backend', 'build'], { env: backendEnv }));
    const { ToolchainCatalog, toolchainDigest } = backendRequire(
      './dist/workers/sandbox/toolchain-catalog.js',
    );
    const catalog = ToolchainCatalog.fromFile(settings.config.catalog);
    for (const entry of catalog.entries) {
      const image = await setupStep(() =>
        run(docker, ['image', 'inspect', '--format', '{{.Id}}', entry.image], {
          capture: true,
          timeout: 15000,
          label: `Toolchain image ${entry.id}`,
        }),
      );
      if (
        !/^sha256:[a-f0-9]{64}$/.test(image) ||
        (!entry.image.includes('@') && image !== toolchainDigest(entry.image))
      )
        throw new Error(
          `Toolchain ${entry.id} does not match an available immutable image. Restore the original image/catalog; published IDs were not changed.`,
        );
    }
    await setupStep(() => databaseSetup(settings));
    const skipJudge = process.argv.includes('--skip-judge');
    if (skipJudge) {
      settings.backend.EXECUTION_ENABLED = backendEnv.EXECUTION_ENABLED = 'false';
      console.log(
        'Judge setup explicitly skipped. Execution stays disabled; no public runs, hidden pass counts or successful grades are claimed.',
      );
    }
    try {
      const judge = await setupStep(() =>
        prepareOptionalJudge(settings, docker, {
          skipJudge,
          force: process.argv.includes('--retry-judge'),
        }),
      );
      if (judge) {
        const keyring = readJson(settings.config.keyring);
        settings.judge = {
          NODE_ENV: 'development',
          LOG_LEVEL: 'info',
          DATABASE_JUDGE_URL: settings.backend.DATABASE_URL,
          DATABASE_JUDGE_POOL_MAX: '2',
          REDIS_QUEUE_URL: settings.backend.REDIS_QUEUE_URL,
          JUDGE_QUEUE_PREFIX: settings.backend.JUDGE_QUEUE_PREFIX,
          JUDGE_CONCURRENCY: '1',
          JUDGE_PUBLIC_CONCURRENCY: '1',
          SANDBOX_RUNTIME: 'gvisor',
          SANDBOX_BROKER_URL: 'https://localhost:9443',
          TESTCASE_KEYRING_FILE: settings.config.keyring,
          SANDBOX_TOOLCHAIN_CATALOG: settings.config.catalog,
          SANDBOX_CA_FILE: join(judge.certs, 'ca.pem'),
          SANDBOX_CERT_FILE: join(judge.certs, 'client.pem'),
          SANDBOX_KEY_FILE: join(judge.certs, 'client-key.pem'),
          PUBLIC_TESTCASE_KMS_KEY_ID: keyring.keys.find((k) => k.dataClass === 'PUBLIC').id,
          HIDDEN_TESTCASE_KMS_KEY_ID: keyring.keys.find((k) => k.dataClass === 'HIDDEN').id,
          JUDGE_DIAGNOSTICS_KMS_KEY_ID: keyring.keys.find((k) => k.dataClass === 'DIAGNOSTICS').id,
        };
        updateEnvironment(root, 'backend/.env.judge.local', settings.judge);
        updateEnvironment(root, 'backend/.env', { EXECUTION_ENABLED: 'true' });
        settings.backend.EXECUTION_ENABLED = backendEnv.EXECUTION_ENABLED = 'true';
      }
    } catch (error) {
      if (stopping) throw error;
      console.log(`Judge unavailable; execution stays disabled: ${error.message}`);
      writePrivate(join(local, 'judge/last-error.json'), {
        checkedAt: new Date().toISOString(),
        reason: error.message,
      });
      await stopJudge(settings.config, docker).catch(() => {});
    }
    await setupStep(prepareFrontends);
    if (stopping) return;
    mkdirSync(join(local, 'logs'), { recursive: true, mode: 0o700 });
    const serviceExit = (name) => {
      if (!stopping) {
        failed = true;
        process.exitCode = 1;
        console.error(`${name} exited unexpectedly. See .local/logs/${name}.log.`);
        void stop();
      }
    };
    const start = (name, entry, args, cwd, env) => {
      services.push(startService(name, entry, args, cwd, env, token, serviceExit));
      state.services = services.map(({ name, pid }) => ({ name, pid }));
      saveState();
    };
    if (settings.judge) {
      start('judge', join(root, 'backend/dist/workers/judge/main.js'), [], join(root, 'backend'), {
        ...process.env,
        ...settings.judge,
      });
      await waitFor('Judge worker', async () => serviceReady('judge', 'judge.ready'), {
        timeout: 60000,
        isStopping: () => stopping,
      });
    }
    start('backend', join(root, 'backend/dist/main.js'), [], join(root, 'backend'), backendEnv);
    await waitFor(
      'Backend readiness',
      async () => (await http('http://127.0.0.1:4000/api/v1/health/ready')).payload?.data?.ready,
      { isStopping: () => stopping },
    );
    start(
      'maintenance',
      join(root, 'backend/dist/workers/outbox/main.js'),
      [],
      join(root, 'backend'),
      { ...process.env, ...settings.maintenance },
    );
    await waitFor(
      'Maintenance worker',
      async () => serviceReady('maintenance', 'maintenance.ready'),
      { timeout: 30000, isStopping: () => stopping },
    );
    for (const [app, port] of [
      ['frontend', '3000'],
      ['admin', '3001'],
    ]) {
      start(app, join(root, app, '.next/standalone', app, 'server.js'), [], join(root, app), {
        ...process.env,
        ...readEnv(join(root, app, '.env.local')),
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: port,
        NEXT_TELEMETRY_DISABLED: '1',
      });
    }
    for (const port of [3000, 3001])
      await waitFor(
        `Frontend ${port}`,
        async () =>
          (await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(30000) }))
            .ok,
        { timeout: 180000, isStopping: () => stopping },
      );
    const report = await setupStep(() => checkLocal({ isStopping: () => stopping }));
    if (report.failed)
      throw new Error(
        'Some local health/authentication checks failed. See .local/check-report.json, .local/check-errors.json and .local/logs.',
      );
    state.phase = 'ready';
    saveState();
    console.log(
      '\nStudent: http://localhost:3000/login\nAdmin:   http://localhost:3001/login\nAPI:     http://localhost:4000/api/v1\nHealth:  http://localhost:4000/api/v1/health/live',
    );
    console.log(
      `Credentials: assessment-platform/.local/credentials.json\nUse separate browser profiles for student/admin cookies.\nDatabase: ${settings.config.databaseProvider === 'railway' ? 'Railway development PostgreSQL' : 'local Docker PostgreSQL'}\nJudge: ${settings.judge ? 'READY (real gVisor gate passed)' : 'DISABLED (see .local/judge and local:check)'}\nCtrl+C or pnpm local:down stops local services and preserves Docker volumes. Railway resources are never stopped or deleted.`,
    );
    await finished;
  } catch (error) {
    if (!stopping) {
      failed = true;
      process.exitCode = 1;
      console.error(`Local startup stopped: ${error.message}`);
    }
  } finally {
    await stop();
    await finished;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
async function down() {
  const lock = readJson(lockFile);
  if (lock && alive(lock.pid)) {
    writePrivate(stopFile, { token: lock.token });
    await waitFor('Local supervisor shutdown', async () => !existsSync(lockFile), {
      timeout: 60000,
    });
  } else {
    remove(lockFile);
    remove(stopFile);
  }
  const config = readJson(join(local, 'config.json'));
  if (config) {
    const docker = dockerCommand();
    await stopJudge(config, docker);
    await run(docker, composeArgs(config, ['stop', ...localInfrastructureServices(config)]), {
      capture: true,
      timeout: 60000,
    });
  }
  console.log(
    'Local services stopped. Docker volumes, Railway resources and private local files were preserved.',
  );
}
const invokedDirectly =
  process.argv[1] &&
  (process.platform === 'win32'
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invokedDirectly)
  try {
    if (command === 'up') await up();
    else if (command === 'down') await down();
    else if (command === 'check') {
      if ((await checkLocal()).failed) process.exitCode = 1;
    } else if (command === 'configure') {
      await versions();
      await configureEnvironment(root, { railway: process.argv.includes('--railway') });
      console.log(
        'Local environment configured. Private credentials: assessment-platform/.local/credentials.json. No accounts are claimed provisioned until local:up succeeds.',
      );
    } else throw new Error('Use local:up, local:down, local:check or local:configure.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
