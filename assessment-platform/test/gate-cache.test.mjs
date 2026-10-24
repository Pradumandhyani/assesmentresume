import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { judgeBuildHash } from '../scripts/local/judge.mjs';

test('control-plane changes invalidate both cached image builds and successful judge gates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-gate-cache-'));
  const catalog = join(directory, 'catalog.json');
  const files = [
    'backend/sandbox/local/Dockerfile',
    'backend/Dockerfile',
    'pnpm-lock.yaml',
    'docker-compose.judge.local.yml',
    'scripts/local/judge.mjs',
    'backend/jest.judge.config.cjs',
    'backend/src/broker.ts',
    'backend/prisma/schema.prisma',
    'backend/test/gate.spec.ts',
  ];
  const fingerprints = () => {
    const hash = judgeBuildHash(catalog, directory);
    return {
      build: hash.copy().digest('hex'),
      gate: hash.update('fixed-kernel-and-resource-profile').digest('hex'),
    };
  };
  try {
    writeFileSync(catalog, '{"toolchains":[]}');
    for (const file of files) {
      const path = join(directory, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `original ${file}`);
    }
    const previous = fingerprints();
    assert.deepEqual(fingerprints(), previous, 'unchanged inputs retain the cached evidence');
    for (const file of files) {
      writeFileSync(join(directory, file), `changed ${file}`);
      const changed = fingerprints();
      assert.notEqual(changed.build, previous.build, `${file} must rebuild trusted images`);
      assert.notEqual(changed.gate, previous.gate, `${file} must rerun the real judge gate`);
      writeFileSync(join(directory, file), `original ${file}`);
      assert.deepEqual(fingerprints(), previous, `${file} was the only changed input`);
    }
    writeFileSync(catalog, '{"toolchains":[{"id":"changed"}]}');
    assert.notDeepEqual(fingerprints(), previous, 'toolchain changes invalidate cached evidence');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('assessment-gate-cache-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
