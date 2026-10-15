import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  installedBraces,
  reviewDependencyAudit,
  verifyBracesBehavior,
  verifyBracesPatch,
} from '../scripts/dependency-remediations.mjs';

const advisoryId = 'GHSA-vfj7-8cjw-p6xm';
function report(advisories) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const advisory of advisories) vulnerabilities[advisory.severity]++;
  return { advisories, metadata: { vulnerabilities } };
}
const finding = {
  github_advisory_id: advisoryId,
  module_name: 'braces',
  severity: 'high',
  findings: [{ version: '3.0.3' }],
};

test('the pinned braces patch protects every application and preserves normal glob expansion', () => {
  assert.equal(verifyBracesPatch().advisoryId, advisoryId);
  for (const application of ['frontend', 'admin', 'backend'])
    verifyBracesBehavior(installedBraces(application));
});

test('the full audit retains the registry finding and records its verified remediation', () => {
  const review = reviewDependencyAudit(report([finding]));
  assert.equal(review.vulnerabilities.high, 1);
  assert.equal(review.unresolvedVulnerabilities.high, 0);
  assert.equal(review.remediations[0].verified, true);
  assert.equal(review.deployGatePassed, true);
});

test('a missing or altered patch still blocks deployment', () => {
  const review = reviewDependencyAudit(report([finding]), () => {
    throw new Error('Patch missing');
  });
  assert.equal(review.unresolvedVulnerabilities.high, 1);
  assert.equal(review.remediations[0].verified, false);
  assert.equal(review.deployGatePassed, false);
});

test('other advisories and other versions are never covered by the braces remediation', () => {
  for (const advisory of [
    { ...finding, github_advisory_id: 'GHSA-another-advisory' },
    { ...finding, severity: 'critical' },
    { ...finding, module_name: 'another-package' },
    { ...finding, findings: [{ version: '3.0.3' }, { version: '3.0.2' }] },
  ]) {
    const review = reviewDependencyAudit(report([finding, advisory]));
    assert.equal(review.deployGatePassed, false);
    assert.equal(review.remediations.length, 1);
  }
});

test('inconsistent registry data cannot pass the gate', () => {
  const invalid = report([finding]);
  invalid.metadata.vulnerabilities.high = 0;
  assert.throws(() => reviewDependencyAudit(invalid), /counts are inconsistent/);
});

test('a clean registry response passes without applying any exception', () => {
  const review = reviewDependencyAudit(report([]));
  assert.equal(review.deployGatePassed, true);
  assert.deepEqual(review.remediations, []);
});

test('Istanbul still loads YAML configurations through the replacement dependency', async () => {
  let require = createRequire(new URL('../backend/package.json', import.meta.url));
  for (const name of [
    'jest',
    '@jest/core',
    '@jest/transform',
    'babel-plugin-istanbul',
    '@istanbuljs/load-nyc-config',
  ])
    require = createRequire(require.resolve(`${name}/package.json`));
  assert.equal(require('js-yaml/package.json').version, '4.3.2');
  const directory = mkdtempSync(join(tmpdir(), 'assessment-nyc-'));
  try {
    writeFileSync(join(directory, 'package.json'), '{}');
    writeFileSync(join(directory, '.nycrc.yaml'), 'all: true\ninclude:\n  - src/**/*.ts\n');
    const config = await require('./').loadNycConfig({ cwd: directory });
    assert.equal(config.all, true);
    assert.deepEqual(config.include, ['src/**/*.ts']);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
