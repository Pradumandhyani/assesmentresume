import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'backend/sandbox/secrets');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keys = ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'].map((dataClass) => ({
  id: `development-${dataClass.toLowerCase()}-v1`,
  dataClass,
  base64: randomBytes(32).toString('base64'),
}));
// Exclusive creation: reruns never replace keys used by immutable published cases.
writeFileSync(resolve(directory, 'keyring.local.json'), `${JSON.stringify({ keys }, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  'Created private development keyring. Key material is not printed. Preserve it across seed reruns.',
);
