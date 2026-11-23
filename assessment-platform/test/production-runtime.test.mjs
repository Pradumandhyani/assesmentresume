import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { rootCertificates } from 'node:tls';
import { prepareRuntimeFiles } from '../scripts/production-runtime.mjs';

test('ordinary deployments retain their existing file and database configuration', () => {
  const env = {
    DATABASE_URL: 'postgresql://api:secret@db/assessment',
    QUESTION_KEYRING_FILE: '/run/secrets/questions.json',
  };
  const original = { ...env };
  prepareRuntimeFiles(env);
  assert.deepEqual(env, original);
});

test('cloud administration keyring is materialized privately and removed from inherited environment', () => {
  const json = JSON.stringify({ keys: [{ dataClass: 'PUBLIC' }, { dataClass: 'HIDDEN' }] });
  const env = { QUESTION_KEYRING_BASE64: Buffer.from(json).toString('base64') };
  prepareRuntimeFiles(env);
  try {
    assert.equal(env.QUESTION_KEYRING_BASE64, undefined);
    assert.equal(readFileSync(env.QUESTION_KEYRING_FILE, 'utf8'), json);
    if (process.platform !== 'win32')
      assert.equal(statSync(env.QUESTION_KEYRING_FILE).mode & 0o777, 0o600);
  } finally {
    rmSync(dirname(env.QUESTION_KEYRING_FILE), { recursive: true });
  }
});

test('cloud administration process rejects judge diagnostics keys and invalid CA material', () => {
  assert.throws(
    () =>
      prepareRuntimeFiles({
        QUESTION_KEYRING_BASE64: Buffer.from(
          JSON.stringify({ keys: [{ dataClass: 'DIAGNOSTICS' }] }),
        ).toString('base64'),
      }),
    /Invalid administration/,
  );
  assert.throws(() =>
    prepareRuntimeFiles({ DATABASE_TLS_CA_BASE64: Buffer.from('invalid').toString('base64') }),
  );
});

test('database variables use the provided CA with hostname verification, preserving credentials and query parameters', () => {
  const env = {
    DATABASE_TLS_CA_BASE64: Buffer.from(rootCertificates[0]).toString('base64'),
    DATABASE_URL:
      'postgresql://api:private@postgres.railway.internal/assessment_production?application_name=student',
    ADMIN_DATABASE_URL:
      'postgresql://admin:private@postgres.railway.internal/assessment_production',
  };
  prepareRuntimeFiles(env);
  const url = new URL(env.DATABASE_URL);
  const ca = url.searchParams.get('sslrootcert');
  try {
    assert.equal(env.DATABASE_TLS_CA_BASE64, undefined);
    assert.equal(url.searchParams.get('sslmode'), 'verify-full');
    assert.equal(url.searchParams.get('application_name'), 'student');
    assert.equal(url.username, 'api');
    assert.equal(new URL(env.ADMIN_DATABASE_URL).searchParams.get('sslrootcert'), ca);
    assert.equal(readFileSync(ca, 'utf8'), rootCertificates[0]);
  } finally {
    rmSync(dirname(ca), { recursive: true });
  }
});

test('cloud toolchain catalog is materialized with immutable references and removed from the environment', () => {
  const catalog = {
    toolchains: ['PYTHON', 'JAVA', 'CPP'].map((language, index) => ({
      id: `reviewed-${language.toLowerCase()}`,
      language,
      version: ['3.13.16', '21.0.12', '14.3.0'][index],
      image: `sha256:${String(index + 1).repeat(64)}`,
    })),
  };
  const env = {
    SANDBOX_TOOLCHAIN_CATALOG_BASE64: Buffer.from(JSON.stringify(catalog)).toString('base64'),
  };
  prepareRuntimeFiles(env);
  try {
    assert.equal(env.SANDBOX_TOOLCHAIN_CATALOG_BASE64, undefined);
    assert.deepEqual(JSON.parse(readFileSync(env.SANDBOX_TOOLCHAIN_CATALOG, 'utf8')), catalog);
    if (process.platform !== 'win32')
      assert.equal(statSync(env.SANDBOX_TOOLCHAIN_CATALOG).mode & 0o777, 0o600);
  } finally {
    rmSync(dirname(env.SANDBOX_TOOLCHAIN_CATALOG), { recursive: true });
  }
  for (const invalid of [
    { toolchains: catalog.toolchains.slice(0, 2) },
    { toolchains: catalog.toolchains.map((entry) => ({ ...entry, image: 'python:latest' })) },
  ]) {
    assert.throws(
      () =>
        prepareRuntimeFiles({
          SANDBOX_TOOLCHAIN_CATALOG_BASE64: Buffer.from(JSON.stringify(invalid)).toString('base64'),
        }),
      /complete, pinned toolchain/,
    );
  }
});
