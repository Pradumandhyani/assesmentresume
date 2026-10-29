import { X509Certificate } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Railway supplies secrets as variables. Materialize only the files required by
// existing adapters, in a process-private directory. Never print their contents.
export function prepareRuntimeFiles(env = process.env) {
  let directory;
  const secretFile = (name, content) => {
    directory ??= mkdtempSync(join(tmpdir(), 'assessment-runtime-'));
    const path = join(directory, name);
    writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
    return path;
  };
  if (env.DATABASE_TLS_CA_BASE64) {
    const pem = Buffer.from(env.DATABASE_TLS_CA_BASE64, 'base64').toString('utf8');
    if (!new X509Certificate(pem).ca) throw new Error('Database trust anchor must be a CA.');
    const path = secretFile('postgres-ca.crt', pem);
    for (const key of [
      'DATABASE_URL',
      'ADMIN_DATABASE_URL',
      'DATABASE_MAINTENANCE_URL',
      'DATABASE_JUDGE_URL',
    ]) {
      if (!env[key]) continue;
      const url = new URL(env[key]);
      if (url.protocol !== 'postgresql:') throw new Error('Invalid database protocol.');
      url.searchParams.set('sslmode', 'verify-full');
      url.searchParams.set('sslrootcert', path);
      env[key] = url.toString();
    }
    delete env.DATABASE_TLS_CA_BASE64;
  }
  if (env.QUESTION_KEYRING_BASE64) {
    const json = Buffer.from(env.QUESTION_KEYRING_BASE64, 'base64').toString('utf8');
    const keyring = JSON.parse(json);
    if (
      !Array.isArray(keyring.keys) ||
      keyring.keys.some((key) => !['PUBLIC', 'HIDDEN'].includes(key.dataClass))
    )
      throw new Error('Invalid administration question keyring.');
    env.QUESTION_KEYRING_FILE = secretFile('question-keyring.json', json);
    delete env.QUESTION_KEYRING_BASE64;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareRuntimeFiles();
  const entry = process.argv[2];
  if (
    !['dist/main.js', 'dist/workers/outbox/main.js', 'dist/workers/judge/main.js'].includes(entry)
  )
    throw new Error('Unknown production entry point.');
  await import(pathToFileURL(resolve(entry)).href);
}
