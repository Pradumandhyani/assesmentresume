import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const workspace = parse(read('pnpm-workspace.yaml'));
assert.deepEqual(workspace.packages, ['frontend', 'backend', 'admin']);
const applications = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(applications, ['admin', 'backend', 'frontend']);
const required = {
  frontend: [
    'src/app',
    'components',
    'features',
    'hooks',
    'services',
    'lib',
    'types',
    'providers',
    'styles',
  ],
  admin: ['app', 'components', 'features', 'services', 'hooks', 'lib', 'types'],
  backend: [
    'src/modules/auth',
    'src/modules/students',
    'src/modules/assessments',
    'src/modules/questions',
    'src/modules/attempts',
    'src/modules/submissions',
    'src/modules/execution',
    'src/modules/results',
    'src/modules/admin',
    'src/common',
    'src/config',
    'src/database',
    'src/queues',
    'src/workers',
    'prisma',
    'test',
  ],
};
for (const [app, folders] of Object.entries(required)) {
  for (const folder of folders)
    assert.ok(existsSync(path.join(root, app, folder)), `Missing ${app}/${folder}`);
  const manifest = JSON.parse(read(`${app}/package.json`));
  for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies }))
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Application dependencies must be pinned');
  assert.equal(JSON.parse(read(`${app}/tsconfig.json`)).extends, '../tsconfig.base.json');
}
assert.equal(JSON.parse(read('tsconfig.base.json')).compilerOptions.strict, true);
const compose = parse(read('docker-compose.yml'));
assert.deepEqual(Object.keys(compose.services).sort(), ['gateway', 'postgres', 'redis']);
assert.ok(compose.services.redis.command.includes('noeviction'));
assert.ok(!JSON.stringify(compose).includes('docker.sock'));
for (const service of Object.values(compose.services))
  for (const port of service.ports ?? [])
    assert.ok(port.startsWith('127.0.0.1:'), 'Dev services must bind to loopback');
for (const app of ['frontend', 'admin'])
  assert.doesNotMatch(read(`${app}/.env.example`), /DATABASE_URL|REDIS|PASSWORD_HASH/);
const spec = JSON.parse(read('contracts/openapi.json'));
const operations = Object.values(spec.paths).flatMap((item) => Object.values(item));
assert.equal(new Set(operations.map((op) => op.operationId)).size, operations.length);
console.log(
  `Configuration valid: exactly 3 applications, strict TypeScript, pinned dependencies, development infrastructure, ${operations.length} API contracts.`,
);
