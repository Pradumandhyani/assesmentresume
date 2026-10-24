import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { run as runCommand, alive, delay, stopCommands } from '../scripts/local/runtime.mjs';
import {
  configureEnvironment,
  readEnv,
  readJson,
  updateEnvironment,
  assertLocalDatabase,
  assertConfiguredDatabase,
  localInfrastructureServices,
  writePrivate,
} from '../scripts/local/environment.mjs';
import { railwayEndpointFingerprint } from '../scripts/railway/database.mjs';
import { prepareOptionalJudge } from '../scripts/local.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

test('explicit judge skip overrides retry and never calls the provisioner or changes preserved catalog/keys', async () => {
  const settings = {
    config: { catalog: 'preserved-catalog', keyring: 'preserved-keys' },
    backend: { EXECUTION_ENABLED: 'false' },
  };
  let invoked = false;
  const result = await prepareOptionalJudge(settings, 'not-a-docker-process', {
    skipJudge: true,
    force: true,
    prepare: async () => {
      invoked = true;
      throw new Error('Provisioning must not execute');
    },
  });
  assert.equal(result, null);
  assert.equal(invoked, false);
  assert.equal(settings.backend.EXECUTION_ENABLED, 'false');
  assert.deepEqual(settings.config, { catalog: 'preserved-catalog', keyring: 'preserved-keys' });
});
test('normal optional judge preparation preserves the actual gate outcome and retry request', async () => {
  const settings = { config: {}, backend: { EXECUTION_ENABLED: 'false' } };
  let calls = 0;
  assert.equal(
    await prepareOptionalJudge(settings, 'owned-docker', {
      force: true,
      prepare: async (received, command, options) => {
        calls++;
        assert.equal(received, settings);
        assert.equal(command, 'owned-docker');
        assert.equal(options.force, true);
        return null;
      },
    }),
    null,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    prepareOptionalJudge(settings, 'owned-docker', {
      prepare: async () => {
        throw new Error('Real gate failed');
      },
    }),
    /Real gate failed/,
  );
  assert.equal(settings.backend.EXECUTION_ENABLED, 'false');
});

test('machine-readable command output excludes stderr warnings while private logs retain them', () =>
  fixture(async (directory) => {
    const logFile = join(directory, 'probe.log');
    const output = await runCommand(
      process.execPath,
      [
        '-e',
        'process.stderr.write("warning\\n");process.stdout.write(JSON.stringify({healthy:true}));',
      ],
      { capture: true, stdoutOnly: true, logFile, timeout: 15000 },
    );
    assert.deepEqual(JSON.parse(output), { healthy: true });
    assert.match(readFileSync(logFile, 'utf8'), /warning/);
  }));

test('shutdown cancels an in-progress setup command before startup can report ready', () =>
  fixture(async (directory) => {
    const sentinel = join(directory, 'ready.json');
    const entry = join(directory, 'long-command.mjs');
    writeFileSync(
      entry,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`,
    );
    const completed = runCommand(process.execPath, [entry], { capture: true, timeout: 30000 }).then(
      () => null,
      (error) => error,
    );
    try {
      const until = Date.now() + 10000;
      while (!readJson(sentinel) && Date.now() < until) await delay(50);
      const pid = readJson(sentinel)?.pid;
      assert.ok(pid, 'the actual command must have started');
      await stopCommands();
      assert.equal((await completed)?.code, 'LOCAL_CANCELLED');
      assert.equal(alive(pid), false);
    } finally {
      await stopCommands();
    }
  }));

test('a timed-out setup command also stops its owned compiler descendant', () =>
  fixture(async (directory) => {
    const sentinel = join(directory, 'descendant.json');
    const parent = join(directory, 'parent.mjs');
    writeFileSync(
      parent,
      `import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
writeFileSync(${JSON.stringify(sentinel)},JSON.stringify({pid:child.pid}));
setInterval(()=>{},1000);`,
    );
    let descendant;
    try {
      await assert.rejects(
        runCommand(process.execPath, [parent], {
          capture: true,
          timeout: 5000,
          label: 'Test setup command',
        }),
        /timed out/,
      );
      descendant = readJson(sentinel)?.pid;
      assert.ok(descendant, 'compiler descendant must have actually started');
      const until = Date.now() + 5000;
      while (alive(descendant) && Date.now() < until) await delay(100);
      assert.equal(alive(descendant), false, 'timed-out compiler must not survive');
    } finally {
      if (descendant && alive(descendant)) process.kill(descendant);
    }
  }));
async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-local-test-'));
  try {
    for (const app of ['backend', 'frontend', 'admin']) mkdirSync(join(directory, app));
    for (const name of [
      '.env.example',
      'backend/.env.example',
      'backend/.env.maintenance.example',
      'frontend/.env.example',
      'admin/.env.example',
    ])
      copyFileSync(join(project, name), join(directory, name));
    await run(directory);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('assessment-local-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
test('local configuration is repeatable, private and uses isolated queue/session databases', () =>
  fixture(async (directory) => {
    const first = await configureEnvironment(directory);
    const keyring = readFileSync(first.config.keyring, 'utf8');
    const credentials = readFileSync(first.credentialsFile, 'utf8');
    const env = readFileSync(join(directory, 'backend/.env'), 'utf8');
    const second = await configureEnvironment(directory);
    assert.equal(readFileSync(second.config.keyring, 'utf8'), keyring);
    assert.equal(readFileSync(second.credentialsFile, 'utf8'), credentials);
    assert.equal(readFileSync(join(directory, 'backend/.env'), 'utf8'), env);
    assert.notEqual(first.credentials.student.password, first.credentials.admin.password);
    assert.equal(first.credentials.provisioned, false);
    assert.equal(new URL(first.backend.REDIS_QUEUE_URL).pathname, '/0');
    assert.equal(new URL(first.backend.REDIS_SESSION_URL).pathname, '/1');
    assert.equal(first.backend.EXECUTION_ENABLED, 'false');
    assertLocalDatabase(first.backend.DATABASE_URL);
    assert.ok(
      !readFileSync(join(directory, '.local/environment-report.json'), 'utf8').includes(
        first.credentials.admin.password,
      ),
    );
  }));
test('environment updates back up existing files and preserve complex passwords and unrelated settings', () =>
  fixture(async (directory) => {
    const password = 'a#Complex\\literal-password!';
    writeFileSync(join(directory, 'backend/.env'), 'LOG_LEVEL=debug\nCUSTOM_FLAG=keep\n');
    updateEnvironment(directory, 'backend/.env', { DEV_STUDENT_PASSWORD: password });
    assert.equal(readEnv(join(directory, 'backend/.env')).DEV_STUDENT_PASSWORD, password);
    await configureEnvironment(directory);
    const env = readEnv(join(directory, 'backend/.env'));
    assert.equal(env.LOG_LEVEL, 'debug');
    assert.equal(env.CUSTOM_FLAG, 'keep');
    assert.equal(env.DEV_STUDENT_PASSWORD, password);
    const backups = readdirSync(join(directory, '.local/backups'));
    assert.ok(backups.length > 0);
    assert.ok(
      backups.some(
        (name) =>
          readFileSync(join(directory, '.local/backups', name), 'utf8') ===
          'LOG_LEVEL=debug\nCUSTOM_FLAG=keep\n',
      ),
    );
  }));
test('remote development settings are backed up and replaced with generated loopback settings', () =>
  fixture(async (directory) => {
    writeFileSync(
      join(directory, 'backend/.env'),
      'DATABASE_URL=postgresql://live:private-production-value@external.invalid/production\nEXECUTION_ENABLED=true\n',
    );
    const settings = await configureEnvironment(directory);
    assertLocalDatabase(settings.backend.DATABASE_URL);
    assert.ok(!settings.backend.DATABASE_URL.includes('private-production-value'));
    assert.equal(settings.backend.EXECUTION_ENABLED, 'false');
  }));
const railwayProfile = (overrides = {}) => {
  const profile = {
    version: 1,
    provider: 'railway',
    purpose: 'development',
    projectId: '10000000-0000-4000-8000-000000000001',
    environmentId: '10000000-0000-4000-8000-000000000002',
    serviceId: '10000000-0000-4000-8000-000000000003',
    databaseUrl:
      'postgresql://test_user:private-fixture-password@unit-test.proxy.rlwy.net:23456/assessment_dev?sslmode=verify-full&schema=public',
    ...overrides,
  };
  return {
    ...profile,
    endpointFingerprint: railwayEndpointFingerprint(profile.databaseUrl, profile),
  };
};
test('explicit Railway mode persists its approved target across restarts and preserves keys and credentials', () =>
  fixture(async (directory) => {
    const local = await configureEnvironment(directory);
    const keyring = readFileSync(local.config.keyring, 'utf8');
    const studentPassword = local.credentials.student.password;
    const profile = railwayProfile();
    writePrivate(join(directory, '.local/railway.json'), profile);
    const first = await configureEnvironment(directory, { railway: true });
    assert.equal(first.config.databaseProvider, 'railway');
    assert.equal(first.credentials.provisioned, false);
    assert.equal(first.credentials.student.verified, false);
    const second = await configureEnvironment(directory);
    for (const settings of [first, second]) {
      assert.equal(settings.backend.DATABASE_URL, profile.databaseUrl);
      assert.equal(settings.backend.ADMIN_DATABASE_URL, profile.databaseUrl);
      assert.equal(settings.maintenance.DATABASE_MAINTENANCE_URL, profile.databaseUrl);
      assert.equal(readEnv(join(directory, '.env')).DATABASE_URL, profile.databaseUrl);
      assert.equal(settings.credentials.student.password, studentPassword);
      assert.equal(readFileSync(settings.config.keyring, 'utf8'), keyring);
      assert.equal(new URL(settings.backend.REDIS_QUEUE_URL).hostname, '127.0.0.1');
      assertConfiguredDatabase(settings.databaseProfile, settings.backend.DATABASE_URL);
    }
    const report = readFileSync(join(directory, '.local/environment-report.json'), 'utf8');
    assert.ok(!report.includes('private-fixture-password'));
    assert.ok(!report.includes(profile.databaseUrl));
    assert.deepEqual(localInfrastructureServices(first.config), ['redis']);
    assert.deepEqual(localInfrastructureServices({ databaseProvider: 'docker' }), [
      'postgres',
      'redis',
    ]);
  }));
test('Railway mode requires its explicit profile before changing existing environment files', () =>
  fixture(async (directory) => {
    await configureEnvironment(directory);
    const before = readFileSync(join(directory, 'backend/.env'), 'utf8');
    await assert.rejects(configureEnvironment(directory, { railway: true }), /not provisioned/);
    assert.equal(readFileSync(join(directory, 'backend/.env'), 'utf8'), before);
  }));
test('a Railway profile alone does not silently switch the default Docker provider', () =>
  fixture(async (directory) => {
    writePrivate(join(directory, '.local/railway.json'), railwayProfile());
    const settings = await configureEnvironment(directory);
    assert.equal(settings.config.databaseProvider, 'docker');
    assertLocalDatabase(settings.backend.DATABASE_URL);
  }));
test('configured database guard binds Railway cloud IDs and endpoint while permitting explicit credential rotation', () => {
  const profile = railwayProfile();
  assertConfiguredDatabase(profile, profile.databaseUrl);
  for (const changed of [
    { ...profile, purpose: 'production' },
    { ...profile, serviceId: '20000000-0000-4000-8000-000000000003' },
    { ...profile, endpointFingerprint: '0'.repeat(64) },
    { ...profile, databaseUrl: profile.databaseUrl.replace('verify-full', 'disable') },
    { ...profile, databaseUrl: profile.databaseUrl.replace('/assessment_dev', '/railway') },
    {
      ...profile,
      databaseUrl: profile.databaseUrl.replace('unit-test.proxy.rlwy.net', 'external.invalid'),
    },
  ])
    assert.throws(() => assertConfiguredDatabase(changed, changed.databaseUrl));
  assert.throws(() =>
    assertConfiguredDatabase(profile, profile.databaseUrl.replace('test_user:', 'other_user:')),
  );
  const rotated = railwayProfile({
    databaseUrl: profile.databaseUrl.replace(
      'private-fixture-password',
      'rotated-fixture-password',
    ),
  });
  assert.equal(rotated.endpointFingerprint, profile.endpointFingerprint);
  assertConfiguredDatabase(rotated, rotated.databaseUrl);
});
test('duplicate updated environment keys cannot retain a later shadowing database URL', () =>
  fixture(async (directory) => {
    const original =
      "DATABASE_URL='first'\n# Preserve this comment\nexport DATABASE_URL = 'shadow'\nCUSTOM_FLAG=keep\nDATABASE_URL='last'\n";
    writeFileSync(join(directory, 'backend/.env'), original);
    const target = 'postgresql://test:private@127.0.0.1/assessment_dev';
    updateEnvironment(directory, 'backend/.env', { DATABASE_URL: target });
    const actual = readFileSync(join(directory, 'backend/.env'), 'utf8');
    assert.equal(readEnv(join(directory, 'backend/.env')).DATABASE_URL, target);
    assert.equal(
      actual.split(/\r?\n/).filter((line) => /^(?:export\s+)?DATABASE_URL\s*=/.test(line)).length,
      1,
    );
    assert.match(actual, /# Preserve this comment/);
    assert.match(actual, /CUSTOM_FLAG=keep/);
    assert.ok(
      readdirSync(join(directory, '.local/backups')).some(
        (name) => readFileSync(join(directory, '.local/backups', name), 'utf8') === original,
      ),
    );
  }));
test('multiline updated values and invalid private JSON fail without exposing content or changing files', () =>
  fixture(async (directory) => {
    const original = "DATABASE_URL='private\nsecret'\n";
    writeFileSync(join(directory, 'backend/.env'), original);
    assert.throws(
      () => updateEnvironment(directory, 'backend/.env', { DATABASE_URL: 'new' }),
      /multiline DATABASE_URL/,
    );
    assert.equal(readFileSync(join(directory, 'backend/.env'), 'utf8'), original);
    writePrivate(join(directory, '.local/config.json'), {
      version: 1,
      project: 'test-local',
      databaseProvider: 'railway',
    });
    writeFileSync(
      join(directory, '.local/railway.json'),
      '{"databaseUrl":"private-secret" invalid}',
    );
    await assert.rejects(
      configureEnvironment(directory),
      (error) =>
        error.message.includes('private local JSON') && !error.message.includes('private-secret'),
    );
  }));
test('a missing previously configured keyring is not regenerated', () =>
  fixture(async (directory) => {
    const settings = await configureEnvironment(directory);
    const keyring = resolve(settings.config.keyring);
    assert.ok(
      keyring.startsWith(
        resolve(directory) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'),
      ),
    );
    rmSync(keyring);
    await assert.rejects(configureEnvironment(directory), /keys will not be regenerated/);
  }));
test('database guards reject remote and non-development database targets', () => {
  for (const value of [
    'postgresql://user@remote.invalid/project_dev',
    'postgresql://user@127.0.0.1/production',
    'https://localhost/app_dev',
  ])
    assert.throws(() => assertLocalDatabase(value));
});
test(
  'Windows-compatible IPC shutdown runs service cleanup before the child exits',
  { timeout: 15000 },
  () =>
    fixture(async (directory) => {
      const entry = join(directory, 'service.mjs'),
        marker = join(directory, 'stopped');
      writeFileSync(
        entry,
        `import {writeFileSync} from 'node:fs';
const timer=setInterval(()=>{},1000);
process.once('SIGTERM',()=>{clearInterval(timer);writeFileSync(process.env.TEST_STOP_MARKER,'clean');});
process.send({ready:true});`,
      );
      const child = fork(join(project, 'scripts/local/service.mjs'), [entry], {
        env: { ...process.env, LOCAL_SUPERVISOR_TOKEN: 'test-token', TEST_STOP_MARKER: marker },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      try {
        await once(child, 'message');
        const exited = once(child, 'exit');
        child.send({ type: 'stop', token: 'test-token' });
        const [code] = await exited;
        assert.equal(code, 0);
        assert.equal(readFileSync(marker, 'utf8'), 'clean');
      } finally {
        if (child.exitCode === null) child.kill();
      }
    }),
);
