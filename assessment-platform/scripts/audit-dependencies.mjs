import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const destination = resolve('artifacts/security');
mkdirSync(destination, { recursive: true });
const productionOnly = process.argv.includes('--prod');
if (process.argv.slice(2).some((value) => value !== '--prod'))
  throw new Error('Only --prod is supported');
const suffix = productionOnly ? '.prod' : '';
const args = ['audit', '--json', ...(productionOnly ? ['--prod'] : [])];
const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const invocation =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', productionOnly ? 'pnpm.cmd audit --json --prod' : 'pnpm.cmd audit --json']
    : args;
const result = spawnSync(command, invocation, {
  encoding: 'utf8',
  timeout: 120000,
  // Windows invokes a fixed cmd.exe command; no user text/secrets enter shell code.
  maxBuffer: 20 * 1024 * 1024,
});
writeFileSync(resolve(destination, `pnpm-audit${suffix}.json`), result.stdout ?? '', {
  mode: 0o600,
});
writeFileSync(resolve(destination, `pnpm-audit${suffix}.stderr.log`), result.stderr ?? '', {
  mode: 0o600,
});
let parsed;
try {
  parsed = JSON.parse(result.stdout ?? '');
} catch {
  console.error('Dependency audit did not return a valid registry response. Audit is unverified.');
  process.exit(2);
}
if (result.error || parsed.error || !parsed.metadata?.vulnerabilities) {
  console.error('Dependency audit failed to query the registry. Audit is unverified.');
  process.exit(2);
}
const counts = parsed.metadata.vulnerabilities;
const review = {
  generatedAt: new Date().toISOString(),
  command: `pnpm ${args.join(' ')}`,
  registryResponseValid: true,
  vulnerabilities: counts,
  deployGatePassed: counts.high === 0 && counts.critical === 0,
};
writeFileSync(
  resolve(destination, `dependency-review${suffix}.json`),
  JSON.stringify(review, null, 2),
);
console.log(JSON.stringify(review, null, 2));
if (!review.deployGatePassed) {
  console.error(
    'Unresolved high/critical advisories block deployment. Review direct/transitive paths; do not blindly force upgrades.',
  );
  process.exit(1);
}
