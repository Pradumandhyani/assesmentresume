import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const spec = JSON.parse(
  readFileSync(new URL('../contracts/openapi.json', import.meta.url), 'utf8'),
);
const schemas = spec.components.schemas;
function reachableSchemas(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (value.$ref?.startsWith('#/components/schemas/')) {
    const name = value.$ref.split('/').at(-1);
    if (!found.has(name)) {
      found.add(name);
      reachableSchemas(schemas[name], found);
    }
  }
  for (const child of Object.values(value))
    if (typeof child === 'object') reachableSchemas(child, found);
  return found;
}
test('all response graphs exclude credential, hidden-case and internal judge schemas', () => {
  for (const item of Object.values(spec.paths))
    for (const operation of Object.values(item)) {
      const reachable = reachableSchemas(operation.responses);
      for (const name of reachable) {
        assert.ok(
          !['LoginRequest', 'TestCaseWriteRequest', 'QuestionVersionWriteRequest'].includes(name),
          `${operation.operationId} leaks ${name}`,
        );
        const properties = Object.keys(schemas[name].properties ?? {});
        for (const forbidden of [
          'passwordHash',
          'tokenHash',
          'csrfTokenHash',
          'inputCiphertext',
          'expectedOutputCiphertext',
          'internalDiagnosticsCiphertext',
          'hiddenTestCases',
          'encryptionKeyId',
        ])
          assert.ok(!properties.includes(forbidden), `${name} exposes ${forbidden}`);
      }
    }
  assert.deepEqual(Object.keys(schemas.SubmissionResultResponse.properties).sort(), [
    'publicCaseResults',
    'verdict',
  ]);
  assert.deepEqual(Object.keys(schemas.PublicCaseResult.properties).sort(), [
    'ordinal',
    'stderr',
    'stdout',
    'verdict',
  ]);
});
test('state-changing operations require CSRF and security policies declare roles', () => {
  for (const [route, item] of Object.entries(spec.paths))
    for (const [method, operation] of Object.entries(item)) {
      if (method !== 'get')
        assert.ok(
          operation.parameters.some((p) => p.name === 'X-CSRF-Token' && p.required),
          `${method} ${route}`,
        );
      if (!route.startsWith('/auth/'))
        assert.deepEqual(operation['x-roles'], [route.startsWith('/admin/') ? 'ADMIN' : 'STUDENT']);
    }
});
test('start, run, submission and finalization require idempotency keys', () => {
  for (const name of ['startAttempt', 'createPublicRun', 'createSubmission', 'finalizeAttempt']) {
    const operation = Object.values(spec.paths)
      .flatMap((item) => Object.values(item))
      .find((op) => op.operationId === name);
    assert.ok(operation.parameters.some((p) => p.name === 'Idempotency-Key' && p.required));
  }
});
test('fixed exam composition and exact duration are in public contracts', () => {
  const rule = schemas.AssessmentRuleResponse.properties;
  assert.deepEqual(rule.durationSeconds.enum, [10800]);
  assert.deepEqual(
    [rule.easyCount.enum[0], rule.mediumCount.enum[0], rule.hardCount.enum[0]],
    [2, 1, 1],
  );
  assert.equal(schemas.AttemptResponse.properties.questions.minItems, 4);
  assert.equal(schemas.AttemptResponse.properties.questions.maxItems, 4);
});
