import { randomBytes, X509Certificate } from 'node:crypto';
import { mkdirSync, existsSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { root, run, delay, alive } from './local/runtime.mjs';
import { readJson, writePrivate } from './local/environment.mjs';
import { railway, railwayCommand } from './railway/cli.mjs';
import { prepareDevelopmentDatabase } from './railway/database.mjs';
import { writePublicCertificate } from './railway/certificate.mjs';
import {
  normalizeVolumeInventory,
  normalizeProxyInventory,
  normalizeCreatedProxy,
} from './railway/responses.mjs';

const command = process.argv[2] || 'up';
const directory = join(root, '.local/railway-workspace');
const journalFile = join(root, '.local/railway-setup.json');
const profileFile = join(root, '.local/railway.json');
const caFile = join(root, '.local/railway-ca.crt');
const idPattern = /^[a-f0-9-]{36}$/i;
const ids = (state) => [
  '--project',
  state.projectId,
  '--environment',
  state.environmentId,
  '--service',
  state.serviceId,
];
const save = (state) => writePrivate(journalFile, state);
const call = (args, options = {}) => railway(args, { cwd: directory, ...options });

async function provision() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let account;
  try {
    account = await call(['whoami', '--json'], { json: true });
  } catch {
    throw new Error(
      'Railway sign-in is required. Run pnpm.cmd railway:login, finish browser authorization, then retry railway:up.',
    );
  }
  let state = readJson(journalFile);
  if (!state) {
    const workspaces = account.workspaces || [];
    const workspaceId =
      process.env.ASSESSMENT_RAILWAY_WORKSPACE_ID ||
      (workspaces.length === 1 ? workspaces[0].id : undefined);
    if (!workspaceId || !workspaces.some((item) => item.id === workspaceId))
      throw new Error(
        'Set ASSESSMENT_RAILWAY_WORKSPACE_ID to an authorized workspace ID, then retry.',
      );
    state = {
      version: 1,
      purpose: 'development',
      workspaceId,
      name: `assessment-platform-dev-${randomBytes(4).toString('hex')}`,
      password: randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    save(state);
  }
  if (
    state.version !== 1 ||
    state.purpose !== 'development' ||
    !idPattern.test(state.workspaceId) ||
    !/^assessment-platform-dev-[a-f0-9]{8}$/.test(state.name || '') ||
    !/^[a-f0-9]{64}$/.test(state.password || '')
  )
    throw new Error('Invalid private Railway setup journal. Existing resources were preserved.');
  if (!state.projectId) {
    const projects = await call(['list', '--json'], { json: true });
    const matches = projects.filter(
      (item) => item.name === state.name && item.workspace?.id === state.workspaceId,
    );
    if (matches.length > 1)
      throw new Error('Ambiguous setup project; inspect Railway before continuing.');
    const created =
      matches[0] ||
      (await call(['init', '--name', state.name, '--workspace', state.workspaceId, '--json'], {
        json: true,
      }));
    state.projectId = created.id;
    save(state);
  }
  if (!state.environmentId) {
    const projects = await call(['list', '--json'], { json: true });
    const project = projects.find((item) => item.id === state.projectId);
    const environments = project?.environments?.edges || [];
    if (environments.length !== 1)
      throw new Error('Expected one initial development environment in the newly created project.');
    state.environmentId = environments[0].node.id;
    save(state);
  }
  const projects = await call(['list', '--json'], { json: true });
  const owned = projects.find((item) => item.id === state.projectId);
  if (
    !owned ||
    owned.name !== state.name ||
    owned.workspace?.id !== state.workspaceId ||
    !owned.environments?.edges?.some((item) => item.node.id === state.environmentId)
  )
    throw new Error('The saved setup project identity changed. No existing resource was modified.');
  await call([
    'link',
    '--project',
    state.projectId,
    '--environment',
    state.environmentId,
    '--json',
  ]);
  if (!state.serviceId) {
    const status = await call(
      ['status', '--project', state.projectId, '--environment', state.environmentId, '--json'],
      { json: true },
    );
    const services = status.services?.edges?.map((item) => item.node) || [];
    if (services.some((item) => item.name !== 'assessment-postgres-17'))
      throw new Error('Unexpected services in the setup project; no existing service was changed.');
    const service =
      services[0] ||
      (await call(['add', '--service', 'assessment-postgres-17', '--json'], { json: true }));
    state.serviceId = service.id;
    save(state);
  }
  if (
    ![state.projectId, state.environmentId, state.serviceId].every((value) => idPattern.test(value))
  )
    throw new Error('Invalid saved Railway resource IDs.');
  if (!state.volumeId) {
    const volumes = await call(['volume', ...ids(state), 'list', '--json'], { json: true });
    const entries = normalizeVolumeInventory(volumes, 'assessment-postgres-17', state.serviceId);
    const volume =
      entries[0] ||
      (await call(
        ['volume', ...ids(state), 'add', '--mount-path', '/var/lib/postgresql/data', '--json'],
        { json: true },
      ));
    state.volumeId = volume.id;
    save(state);
  }
  if (!state.proxy) {
    const proxies = await call(['tcp-proxy', 'list', ...ids(state), '--json'], { json: true });
    const entries = normalizeProxyInventory(proxies);
    state.proxy =
      entries[0] ||
      normalizeCreatedProxy(
        await call(['tcp-proxy', 'create', '--port', '5432', ...ids(state), '--json'], {
          json: true,
        }),
      );
    if (!state.proxy)
      throw new Error(
        'Railway has staged the TCP proxy. Retry setup after the network change is committed; no database was reset.',
      );
    save(state);
  }
  if (!state.variablesSet) {
    await call(
      ['variable', 'set', ...ids(state), '--skip-deploys', 'POSTGRES_PASSWORD', '--stdin'],
      { input: state.password },
    );
    await call([
      'variable',
      'set',
      ...ids(state),
      '--skip-deploys',
      'POSTGRES_USER=postgres',
      'POSTGRES_DB=railway',
      'PGDATA=/var/lib/postgresql/data/pgdata',
      'SSL_REQUIRE=true',
    ]);
    state.variablesSet = true;
    save(state);
  }
  if (!state.deploymentUploaded) {
    console.log('Deploying the isolated PostgreSQL 17 development service...');
    await call(
      ['up', join(root, 'scripts/railway/postgres'), '--path-as-root', '--detach', ...ids(state)],
      { timeout: 180000 },
    );
    state.deploymentUploaded = true;
    save(state);
  }
  if (!existsSync(caFile)) {
    console.log(
      'Waiting for PostgreSQL and exporting its public TLS CA over authenticated Railway SSH...',
    );
    const until = Date.now() + 600000;
    let pem;
    while (Date.now() < until) {
      try {
        const output = await call(
          ['ssh', ...ids(state), '--', 'cat', '/var/lib/postgresql/data/certs/root.crt'],
          { timeout: 30000 },
        );
        pem = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
        if (pem) {
          new X509Certificate(pem);
          break;
        }
      } catch {
        /* Build/deploy may still be in progress. */
      }
      await delay(5000);
    }
    if (!pem)
      throw new Error(
        'PostgreSQL is not ready. Inspect its Railway deployment, then retry; no data was reset.',
      );
    writePublicCertificate(caFile, pem);
  }
  const variables = await call(['variable', 'list', ...ids(state), '--json'], { json: true });
  const host = variables.RAILWAY_TCP_PROXY_DOMAIN || state.proxy.domain;
  const port = variables.RAILWAY_TCP_PROXY_PORT || state.proxy.proxyPort;
  if (!host || !port) throw new Error('The Railway public TCP proxy is not ready. Retry setup.');
  const connectionString = `postgresql://postgres:${encodeURIComponent(state.password)}@${host}:${port}/railway`;
  const prepared = await prepareDevelopmentDatabase({
    connectionString,
    projectId: state.projectId,
    environmentId: state.environmentId,
    serviceId: state.serviceId,
    tlsCACertificateFile: caFile,
    trustedProfile: readJson(profileFile),
  });
  writePrivate(profileFile, prepared.profile);
  console.log(
    `Railway development database verified. Project: https://railway.com/project/${state.projectId}`,
  );
  console.log(
    'Private connection settings saved in .local/railway.json; credentials were not printed.',
  );
}

async function setup() {
  mkdirSync(join(root, '.local'), { recursive: true, mode: 0o700 });
  const lock = join(root, '.local/railway-setup.lock.json');
  const previous = readJson(lock);
  if (previous && alive(previous.pid))
    throw new Error('Another Railway setup is running in this checkout.');
  if (existsSync(lock)) unlinkSync(lock);
  const token = randomBytes(16).toString('hex');
  const descriptor = openSync(lock, 'wx', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  } finally {
    closeSync(descriptor);
  }
  try {
    await provision();
  } finally {
    if (readJson(lock)?.token === token) unlinkSync(lock);
  }
}

try {
  if (command === 'login')
    await run(await railwayCommand(), ['login'], { cwd: root, timeout: 360000 });
  else if (['setup', 'up'].includes(command)) {
    await setup();
    if (command === 'up')
      await run(process.execPath, ['scripts/local.mjs', 'up', '--railway'], { timeout: 86400000 });
  } else throw new Error('Use railway:login, railway:setup or railway:up.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
