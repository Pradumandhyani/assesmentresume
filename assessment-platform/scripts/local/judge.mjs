import { createHash, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run, composeArgs, waitFor } from './runtime.mjs';
import { readJson, updateEnvironment, writePrivate } from './environment.mjs';

export const judgeComposeArgs = (config, args) =>
  composeArgs(config, ['-f', join(root, 'docker-compose.judge.local.yml'), ...args]);

export async function stopJudge(config, docker) {
  await stopGateTasks(config, docker);
  try {
    const loader = `${config.project}-image-loader`;
    const label = await run(
      docker,
      ['inspect', '--format', '{{index .Config.Labels "assessment-local-project"}}', loader],
      { capture: true, timeout: 10000 },
    );
    if (label === config.project)
      await run(docker, ['stop', '-t', '5', loader], { capture: true, timeout: 15000 });
  } catch {
    /* A one-shot image copier is normally absent. */
  }
  if (existsSync(join(root, '.local/judge/broker.env')))
    await run(
      docker,
      judgeComposeArgs(config, ['stop', 'sandbox-reaper', 'sandbox-broker', 'sandbox-daemon']),
      {
        capture: true,
        timeout: 60000,
      },
    );
}

async function stopGateTasks(config, docker) {
  const ids = await run(
    docker,
    [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${config.project}`,
      '--filter',
      'label=com.docker.compose.service=sandbox-gate',
    ],
    { capture: true, timeout: 15000 },
  );
  for (const id of ids.split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Unexpected local gate container ID.');
    await run(docker, ['stop', '-t', '10', id], { capture: true, timeout: 20000 });
  }
}

function hashTree(hash, path, projectRoot) {
  for (const file of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (file.name === 'generated') continue;
    const name = join(path, file.name);
    if (file.isDirectory()) hashTree(hash, name, projectRoot);
    else hash.update(name.slice(projectRoot.length)).update(readFileSync(name));
  }
}

/** Bind cached image builds and gate results to the actual control-plane configuration. */
export function judgeBuildHash(catalog, projectRoot = root) {
  const hash = createHash('sha256').update(readFileSync(catalog));
  for (const file of [
    'backend/sandbox/local/Dockerfile',
    'backend/Dockerfile',
    'pnpm-lock.yaml',
    'docker-compose.judge.local.yml',
    'scripts/local/judge.mjs',
    'backend/jest.judge.config.cjs',
  ])
    hash.update(file).update(readFileSync(join(projectRoot, file)));
  for (const folder of ['backend/src', 'backend/prisma', 'backend/test'])
    hashTree(hash, join(projectRoot, folder), projectRoot);
  return hash;
}

async function transferImages(docker, config, images) {
  if (!images.every((image) => /^sha256:[a-f0-9]{64}$/.test(image)))
    throw new Error('Local image loading requires immutable image IDs.');
  // Temporary TRUSTED image copier. Only this helper sees the outer engine socket.
  // The archive stays inside Linux; it never crosses a Windows text/stdio pipeline.
  // Broker, judge, gate and student containers never receive the outer socket.
  await run(
    docker,
    [
      'run',
      '--rm',
      '--name',
      `${config.project}-image-loader`,
      '--label',
      `assessment-local-project=${config.project}`,
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      '--mount',
      'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly',
      '--mount',
      `type=volume,source=${config.project}_sandbox_control,target=/run/assessment,readonly`,
      '--entrypoint',
      'sh',
      'docker:29-dind@sha256:0b6d18a4a222e71c88be6034926b4f6cde2fc33c2218643d03ccfddc65995470',
      '-ec',
      'set -o pipefail; docker --host unix:///var/run/docker.sock image save "$@" | docker --host unix:///run/assessment/docker.sock load',
      '--',
      ...images,
    ],
    { timeout: 1200000, label: 'Local immutable toolchain transfer' },
  );
}

export async function prepareJudge(settings, docker, { force = false } = {}) {
  const directory = join(root, '.local/judge');
  const certs = join(directory, 'certs');
  mkdirSync(certs, { recursive: true, mode: 0o700 });
  for (const file of ['broker.env', 'gate.env'])
    if (!existsSync(join(directory, file)))
      writeFileSync(join(directory, file), '', { mode: 0o600 });
  await stopGateTasks(settings.config, docker);
  const compose = (args, options) => run(docker, judgeComposeArgs(settings.config, args), options);
  const hashInput = judgeBuildHash(settings.config.catalog);
  const buildFingerprint = hashInput.copy().digest('hex');
  hashInput.update(
    await run(docker, ['info', '--format', '{{.KernelVersion}} {{.MemTotal}} {{.CgroupVersion}}'], {
      capture: true,
    }),
  );
  const fingerprint = hashInput.digest('hex');
  const reportFile = join(directory, 'gate-report.json');
  const previous = readJson(reportFile);
  if (!force && previous?.fingerprint === fingerprint && previous.status === 'FAIL') {
    console.log(
      'Judge remains disabled after its recorded real gate failure. See .local/judge/gate.log; use pnpm local:up --retry-judge after fixing the prerequisite.',
    );
    return null;
  }
  console.log(
    'Preparing the separate Linux gVisor control plane (first setup may take several minutes)...',
  );
  const buildFile = join(directory, 'build-report.json');
  const build = readJson(buildFile);
  let imagesPresent = false;
  try {
    await run(
      docker,
      [
        'image',
        'inspect',
        `${settings.config.project}-sandbox-control`,
        `${settings.config.project}-sandbox-daemon`,
      ],
      { capture: true },
    );
    imagesPresent = true;
  } catch {
    /* first installation */
  }
  if (build?.fingerprint !== buildFingerprint || !imagesPresent)
    await compose(['build', 'sandbox-daemon', 'sandbox-broker'], { timeout: 1800000 });
  writePrivate(buildFile, { fingerprint: buildFingerprint });
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'sandbox-daemon'], {
    timeout: 180000,
  });
  const daemon = await compose(['ps', '-q', 'sandbox-daemon'], { capture: true });
  const inner = (args, options) =>
    run(
      docker,
      ['exec', daemon, 'docker', '--host', 'unix:///run/assessment/docker.sock', ...args],
      options,
    );
  const catalog = readJson(settings.config.catalog);
  const entries = Array.isArray(catalog) ? catalog : catalog.toolchains;
  if (!Array.isArray(entries)) throw new Error('Unsupported local toolchain catalog.');
  const missing = [];
  for (const entry of entries) {
    try {
      await inner(['image', 'inspect', entry.image], { capture: true });
    } catch {
      missing.push(entry.image);
    }
  }
  if (missing.length) await transferImages(docker, settings.config, [...new Set(missing)]);
  const hash = (
    await run(docker, ['exec', daemon, 'sha256sum', '/opt/gvisor/runsc'], { capture: true })
  ).split(/\s/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Cannot verify the actual gVisor binary.');
  if (!existsSync(join(certs, 'ca.pem'))) {
    // Never replace an existing CA or private key. All output stays in a Git-ignored directory.
    if (
      ['ca-key.pem', 'client-key.pem', 'server-key.pem'].some((file) =>
        existsSync(join(certs, file)),
      )
    )
      throw new Error('Incomplete local judge certificates; restore the original certificate set.');
    await run(
      docker,
      [
        'run',
        '--rm',
        '--network=none',
        '--mount',
        `type=bind,source=${certs},target=/certs`,
        '--entrypoint',
        'sh',
        `${settings.config.project}-sandbox-control`,
        '-ec',
        `
      umask 077
      cd /certs
      openssl req -x509 -newkey rsa:3072 -nodes -keyout ca-key.pem -out ca.pem -days 365 -subj /CN=Assessment-Local-CA 2>/dev/null
      openssl req -newkey rsa:3072 -nodes -keyout server-key.pem -out server.csr -subj /CN=localhost 2>/dev/null
      printf 'subjectAltName=DNS:localhost,DNS:sandbox-broker,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > server.ext
      openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server.pem -days 365 -extfile server.ext 2>/dev/null
      openssl req -newkey rsa:3072 -nodes -keyout client-key.pem -out client.csr -subj /CN=Assessment-Local-Judge 2>/dev/null
      printf 'extendedKeyUsage=clientAuth\n' > client.ext
      openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out client.pem -days 365 -extfile client.ext 2>/dev/null
    `,
      ],
      { capture: true },
    );
  }
  const client = new X509Certificate(readFileSync(join(certs, 'client.pem')));
  const server = new X509Certificate(readFileSync(join(certs, 'server.pem')));
  if (Date.parse(client.validTo) <= Date.now() || Date.parse(server.validTo) <= Date.now())
    throw new Error('Local judge certificates expired; execution remains disabled.');
  const shared = {
    SANDBOX_TOOLCHAIN_CATALOG: '/etc/assessment/toolchains.json',
    SANDBOX_RUNSC_PATH: '/opt/gvisor/runsc',
    SANDBOX_RUNSC_SHA256: hash,
    SANDBOX_CA_FILE: '/run/secrets/ca.pem',
  };
  updateEnvironment(root, '.local/judge/broker.env', {
    ...shared,
    NODE_ENV: 'development',
    SANDBOX_BIND: '0.0.0.0',
    SANDBOX_PORT: '9443',
    SANDBOX_CONCURRENCY: '2',
    SANDBOX_CERT_FILE: '/run/secrets/server.pem',
    SANDBOX_KEY_FILE: '/run/secrets/server-key.pem',
    SANDBOX_CLIENT_FINGERPRINTS: client.fingerprint256.replaceAll(':', '').toLowerCase(),
  });
  updateEnvironment(root, '.local/judge/gate.env', {
    ...shared,
    NODE_ENV: 'test',
    SANDBOX_DOCKER_SOCKET: '/run/assessment/docker.sock',
    SANDBOX_BROKER_URL: 'https://sandbox-broker:9443',
    SANDBOX_CERT_FILE: '/run/secrets/client.pem',
    SANDBOX_KEY_FILE: '/run/secrets/client-key.pem',
    JUDGE_GATE_ACK: 'DEDICATED_DISPOSABLE_LINUX',
    JUDGE_GATE_REDIS_URL: 'redis://redis:6379/15',
    TESTCASE_KEYRING_FILE: '/run/secrets/keyring.json',
  });
  await compose(['up', '-d', 'sandbox-broker']);
  const require = createRequire(new URL('../../backend/package.json', import.meta.url));
  const { MtlsBrokerClient } = require('./dist/workers/sandbox/broker-client.js');
  const broker = new MtlsBrokerClient(
    'https://localhost:9443',
    join(certs, 'ca.pem'),
    join(certs, 'client.pem'),
    join(certs, 'client-key.pem'),
  );
  try {
    await waitFor('Real mTLS sandbox broker', () => broker.health(), { timeout: 120000 });
  } finally {
    broker.close();
  }
  // The full release gate must pass before any API can accept submitted code.
  if (
    force ||
    previous?.status !== 'PASS' ||
    previous.fingerprint !== fingerprint ||
    previous.runscHash !== hash
  ) {
    const logFile = join(directory, 'gate.log');
    try {
      await compose(['run', '--rm', '--no-deps', 'sandbox-gate'], {
        capture: true,
        logFile,
        timeout: 1800000,
        label: 'Mandatory real gVisor judge gate',
      });
      writePrivate(reportFile, {
        status: 'PASS',
        fingerprint,
        runscHash: hash,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      writePrivate(reportFile, {
        status: error.code === 'LOCAL_CANCELLED' ? 'CANCELLED' : 'FAIL',
        fingerprint,
        runscHash: hash,
        checkedAt: new Date().toISOString(),
        reason: error.message,
      });
      throw error;
    }
  }
  await compose(['up', '-d', 'sandbox-reaper']);
  return { certs, hash };
}
