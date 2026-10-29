import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'yaml';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Vercel builds reject missing or insecure API origins and retain same-origin API routing', () => {
  for (const application of ['frontend', 'admin']) {
    for (const value of [
      '',
      'http://127.0.0.1:4000',
      'https://api.example.test/path',
      'https://api.example.test/',
    ]) {
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import('./${application}/next.config.ts')`],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, VERCEL: '1', BACKEND_API_URL: value },
        },
      );
      assert.notEqual(result.status, 0, `${application} must refuse an invalid API origin`);
    }
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const {default:config}=await import('./${application}/next.config.ts');console.log(JSON.stringify(await config.rewrites()));`,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          VERCEL: '1',
          BACKEND_API_URL: 'https://assessment-api.example.test',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      {
        source: '/api/v1/:path*',
        destination: 'https://assessment-api.example.test/api/v1/:path*',
      },
    ]);
  }
});

test('untargeted Railway image builds select the HTTP API instead of the judge', () => {
  const dockerfile = read('backend/Dockerfile');
  const stages = [...dockerfile.matchAll(/^FROM (.+)$/gm)];
  assert.equal(stages.at(-1)[1].trim(), 'api AS railway-api');
  assert.match(
    dockerfile,
    /FROM base-runtime AS api\s+EXPOSE 4000\s+CMD \["node", "scripts\/production-runtime.mjs", "dist\/main.js"\]/,
  );
});
test('production deployment separates privileged admin keys from the student API and execution broker', () => {
  const config = parse(read('infra/deploy/docker-compose.prod.yml'));
  assert.equal(config.services.api.volumes, undefined);
  assert.ok(
    config.services['admin-api'].volumes.some((value) =>
      value.includes('ADMIN_QUESTION_KEYRING_FILE'),
    ),
  );
  assert.notEqual(config.services.api.env_file, config.services['admin-api'].env_file);
  assert.equal(config.services.frontend.environment.BACKEND_API_URL, 'http://api:4000');
  assert.equal(config.services.admin.environment.BACKEND_API_URL, 'http://admin-api:4000');
  assert.equal(config.services.broker, undefined);
  assert.equal(config.services.judge, undefined);
  const worker = parse(read('infra/deploy/docker-compose.judge.yml'));
  assert.deepEqual(Object.keys(worker.services), ['judge']);
  assert.doesNotMatch(JSON.stringify(worker), /docker\.sock/);
  assert.doesNotMatch(JSON.stringify(config), /docker\.sock|privileged/);
  for (const [name, service] of Object.entries(config.services)) {
    if (name !== 'gateway') assert.equal(service.ports, undefined);
    if (!['gateway', 'migrate'].includes(name)) {
      assert.equal(service.read_only, true);
      assert.deepEqual(service.cap_drop, ['ALL']);
    }
  }
  assert.match(read('infra/deploy/Caddyfile'), /reverse_proxy admin-api:4000/);
});
test('deployment example fails closed before any Docker command or secret reading', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/check-deployment.mjs', 'infra/deploy/.env.example'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed immutable image digest/);
});
test('load runner refuses unacknowledged execution before reading real credentials or running k6', () => {
  const result = spawnSync(process.execPath, ['scripts/run-load-test.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LOAD_TEST_ACK: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEDICATED_ISOLATED_LOAD_ENVIRONMENT/);
});
test('monitoring templates remain private and enforce HTTPS readiness checks', () => {
  const monitoring = parse(read('infra/monitoring/prometheus.yml'));
  assert.ok(monitoring.scrape_configs.some((value) => value.job_name === 'judge-node'));
  assert.equal(
    parse(read('infra/monitoring/blackbox.yml')).modules.http_2xx.http.tls_config
      .insecure_skip_verify,
    false,
  );
  assert.equal(
    parse(read('infra/monitoring/blackbox.yml')).modules.http_2xx.http.fail_if_not_ssl,
    true,
  );
});
