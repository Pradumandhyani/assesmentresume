import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, pnpm } from './runtime.mjs';
import { readEnv, readJson, writePrivate } from './environment.mjs';

function addTree(hash, path) {
  if (!existsSync(path)) return;
  for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      [
        'node_modules',
        '.next',
        'monaco',
        'coverage',
        'test-results',
        'AGENTS.md',
        'next-env.d.ts',
      ].includes(item.name)
    )
      continue;
    const file = join(path, item.name);
    if (item.isDirectory()) addTree(hash, file);
    else hash.update(relative(root, file)).update(readFileSync(file));
  }
}

export function frontendDigest(app) {
  const hash = createHash('sha256');
  addTree(hash, join(root, app));
  for (const file of [
    'package.json',
    'next.config.ts',
    'tsconfig.json',
    'postcss.config.mjs',
    '.env.local',
  ]) {
    const path = join(root, app, file);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  hash.update(readFileSync(join(root, 'pnpm-lock.yaml')));
  addTree(hash, join(root, 'contracts'));
  for (const script of [
    'prepare-monaco.mjs',
    `prepare-${app === 'frontend' ? 'student' : 'admin'}-standalone.mjs`,
  ])
    hash.update(readFileSync(join(root, 'scripts', script)));
  return hash.digest('hex');
}

/** Compiled Next servers use considerably less memory than two development compilers. */
export async function prepareFrontends() {
  const marker = join(root, '.local/frontend-builds.json');
  const builds = readJson(marker, {});
  for (const app of ['frontend', 'admin']) {
    const digest = frontendDigest(app);
    const server = join(root, app, '.next/standalone', app, 'server.js');
    const buildId = join(root, app, '.next/BUILD_ID');
    if (
      builds[app]?.digest !== digest ||
      !existsSync(server) ||
      !existsSync(buildId) ||
      readFileSync(buildId, 'utf8') !== builds[app].buildId
    ) {
      console.log(
        `Preparing compiled ${app} assets (cached until source or configuration changes)...`,
      );
      await pnpm(['--filter', `@assessment/${app}`, 'build'], {
        timeout: 1800000,
        env: {
          ...process.env,
          ...readEnv(join(root, app, '.env.local')),
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
        },
      });
      builds[app] = { digest, buildId: readFileSync(buildId, 'utf8') };
      writePrivate(marker, builds);
    }
  }
}
