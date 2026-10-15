import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const advisoryId = 'GHSA-vfj7-8cjw-p6xm';
const patchPath = 'patches/braces@3.0.3.patch';
// Reviewed patch bytes, pinned independently of the workspace and lockfile.
const patchSha256 = '0f05d1ddd438d1f7e6d74b75d5150144b57e0ae52d6aac057794fad90b50ee03';
const depthError = { name: 'SyntaxError', message: 'Brace nesting exceeds maximum depth of 128' };

export function installedBraces(application) {
  let require = createRequire(resolve(root, application, 'package.json'));
  const chain =
    application === 'backend'
      ? ['jest', '@jest/core', 'micromatch', 'braces']
      : ['@next/eslint-plugin-next', 'fast-glob', 'micromatch', 'braces'];
  for (const name of chain) require = createRequire(require.resolve(`${name}/package.json`));
  assert.equal(require('./package.json').version, '3.0.3');
  return require('./');
}

export function verifyBracesBehavior(braces) {
  assert.deepEqual(braces.expand('src/{app,lib}/file{1..2}.ts'), [
    'src/app/file1.ts',
    'src/app/file2.ts',
    'src/lib/file1.ts',
    'src/lib/file2.ts',
  ]);
  assert.equal(braces.compile('src/{app,lib}/*.ts'), 'src/(app|lib)/*.ts');
  const nested = (open, close, count) => open.repeat(count) + 'x' + close.repeat(count);
  assert.equal(braces.stringify(nested('{', '}', 127)), nested('{', '}', 127));
  for (const pattern of [nested('{', '}', 4000), '{'.repeat(4000), nested('(', ')', 4000)]) {
    for (const method of ['parse', 'compile', 'expand', 'stringify'])
      assert.throws(() => braces[method](pattern), depthError);
  }
  // Callers may supply their own AST and bypass parsing.
  for (const method of ['compile', 'expand', 'stringify']) {
    const ast = { type: 'root', nodes: [] };
    let node = ast;
    for (let depth = 0; depth < 256; depth++) {
      const child = { type: 'brace', open: true, close: true, commas: 1, nodes: [] };
      node.nodes.push(child);
      node = child;
    }
    node.nodes.push({ type: 'text', value: 'x' });
    assert.throws(() => braces[method](ast), depthError);
  }
}

export function verifyBracesPatch() {
  const { parse } = createRequire(import.meta.url)('yaml');
  const workspace = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'));
  const lock = parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
  assert.equal(workspace.patchedDependencies?.['braces@3.0.3'], patchPath);
  assert.equal(
    createHash('sha256')
      .update(readFileSync(resolve(root, patchPath)))
      .digest('hex'),
    patchSha256,
    'The braces patch differs from the reviewed patch',
  );
  assert.deepEqual(lock.patchedDependencies?.['braces@3.0.3'], {
    hash: patchSha256,
    path: patchPath,
  });
  const snapshots = Object.keys(lock.snapshots).filter((key) => key.startsWith('braces@'));
  assert.deepEqual(snapshots, [`braces@3.0.3(patch_hash=${patchSha256})`]);
  for (const application of ['frontend', 'admin', 'backend'])
    verifyBracesBehavior(installedBraces(application));
  return { advisoryId, package: 'braces@3.0.3', patch: patchPath, sha256: patchSha256 };
}

export function reviewDependencyAudit(report, verifyPatch = verifyBracesPatch) {
  const vulnerabilities = report.metadata.vulnerabilities;
  const unresolvedVulnerabilities = { ...vulnerabilities };
  const remediations = [];
  const advisories = Object.values(report.advisories);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    assert.equal(
      vulnerabilities[severity],
      advisories.filter((advisory) => advisory.severity === severity).length,
      'Registry advisory counts are inconsistent',
    );
  }
  for (const advisory of advisories) {
    if (
      advisory.github_advisory_id !== advisoryId ||
      advisory.module_name !== 'braces' ||
      advisory.severity !== 'high' ||
      !advisory.findings?.length ||
      !advisory.findings.every((finding) => finding.version === '3.0.3')
    )
      continue;
    try {
      remediations.push({ ...verifyPatch(), verified: true });
      unresolvedVulnerabilities.high--;
    } catch {
      remediations.push({
        advisoryId,
        verified: false,
        reason: 'Local patch verification failed.',
      });
    }
  }
  return {
    vulnerabilities,
    remediations,
    unresolvedVulnerabilities,
    deployGatePassed:
      unresolvedVulnerabilities.high === 0 && unresolvedVulnerabilities.critical === 0,
  };
}
