import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
if (process.env.LOAD_TEST_ACK !== 'DEDICATED_ISOLATED_LOAD_ENVIRONMENT')
  throw new Error(
    'Set LOAD_TEST_ACK=DEDICATED_ISOLATED_LOAD_ENVIRONMENT; never point this workload at production',
  );
const file = resolve(
  process.env.LOAD_FIXTURE_FILE ?? 'backend/sandbox/secrets/load-fixture.local.json',
);
const fixture = JSON.parse(readFileSync(file, 'utf8'));
const info = statSync(file);
if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  throw new Error('Private credentials fixture must have mode 0600');
if (
  fixture.format !== 1 ||
  fixture.students?.length < 500 ||
  !/(^|[_-])(dev|test)([_-]|$)/i.test(fixture.databaseName ?? '')
)
  throw new Error('Require real prepared credentials for 500 students from a dev/test database');
const target = new URL(process.env.LOAD_BASE_URL ?? '');
if (
  !['http:', 'https:'].includes(target.protocol) ||
  target.username ||
  target.password ||
  target.pathname !== '/'
)
  throw new Error('LOAD_BASE_URL must be an isolated HTTP(S) origin without credentials/path');
const origin = new URL(process.env.LOAD_BROWSER_ORIGIN ?? target.origin);
if (origin.origin !== origin.href.replace(/\/$/, ''))
  throw new Error('LOAD_BROWSER_ORIGIN must be exact');
const binary = process.env.K6_BINARY ?? 'k6';
const version = spawnSync(binary, ['version'], { encoding: 'utf8', timeout: 10000 });
if (version.error || version.status !== 0 || !version.stdout.includes('k6'))
  throw new Error('A reviewed native k6 installation is required; load test was not executed');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${fixture.runId.slice(0, 8)}`;
const output = resolve('artifacts/load', runId);
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, 'infrastructure.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runId,
      targetOrigin: target.origin,
      students: fixture.students.length,
      assessmentId: fixture.assessmentId,
      durationSeconds: fixture.durationSeconds,
      k6Version: version.stdout.trim(),
      infrastructureDescription:
        process.env.LOAD_INFRASTRUCTURE_DESCRIPTION ?? 'UNSPECIFIED - capacity claim forbidden',
      status: 'STARTED',
    },
    null,
    2,
  ),
);
const result = spawnSync(
  binary,
  ['run', '--out', `json=${resolve(output, 'metrics.json')}`, 'scripts/load/assessment.k6.js'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOAD_FIXTURE_FILE: file,
      LOAD_OUTPUT_DIRECTORY: output,
      LOAD_BASE_URL: target.origin,
      LOAD_BROWSER_ORIGIN: origin.origin,
    },
  },
);
writeFileSync(
  resolve(output, 'process-result.json'),
  JSON.stringify(
    {
      completedAt: new Date().toISOString(),
      exitCode: result.status,
      error: result.error ? 'K6_PROCESS_FAILURE' : null,
      // Only threshold pass indicates workload assertions passed; capacity review needs
      // the infrastructure inventory and server-side measurements as well.
      thresholdsPassed: result.status === 0,
    },
    null,
    2,
  ),
);
process.exit(result.status ?? 2);
