import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const monacoBundle = 'editor-BdtEMBbM.js';
export const purifierAsset = 'assessment-dompurify.js';
export const purifierVersion = '3.4.17';
const reviewedBundleHash = 'e1e745003eb416b7ca6a1956a333e6f8434ff48381824858cb63c99e9c8f8acf';

/**
 * Monaco 0.57.0 ships an AMD bundle containing DOMPurify 3.4.15. A pnpm override
 * alone cannot update those bytes. Remove that factory and delegate to the
 * patched, separately served AMD distribution from the resolved dependency.
 * Fail closed if the reviewed artifact or AMD structure changes on an upgrade.
 */
export function replaceBundledSanitizer(text) {
  assert.equal(
    createHash('sha256').update(text).digest('hex'),
    reviewedBundleHash,
    'Review the bundled Monaco sanitizer replacement for this dependency version.',
  );
  const source = ts.createSourceFile(
    monacoBundle,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const call = source.statements[0]?.expression;
  assert.ok(ts.isCallExpression(call) && call.expression.getText(source) === 'define');
  const dependencies = call.arguments[1];
  const wrappedFactory = call.arguments[2];
  assert.ok(
    ts.isArrayLiteralExpression(dependencies) && ts.isParenthesizedExpression(wrappedFactory),
  );
  const factory = wrappedFactory.expression;
  assert.ok(
    ts.isFunctionExpression(factory) && factory.parameters.length === dependencies.elements.length,
  );
  const old = factory.body.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'GR',
  );
  assert.equal(old.length, 1, 'Expected exactly one reviewed DOMPurify factory.');
  assert.ok(old[0].getText(source).includes('version="3.4.15"'));
  assert.ok(!text.includes('assessmentDOMPurify'));
  const changes = [
    { start: dependencies.end - 1, end: dependencies.end - 1, value: ',"./assessment-dompurify"' },
    { start: factory.parameters.end, end: factory.parameters.end, value: ',assessmentDOMPurify' },
    {
      start: old[0].getStart(source),
      end: old[0].end,
      value: 'function GR(window){return window?assessmentDOMPurify(window):assessmentDOMPurify;}',
    },
  ];
  for (const change of changes.sort((a, b) => b.start - a.start))
    text = text.slice(0, change.start) + change.value + text.slice(change.end);
  assert.ok(
    !text.includes('version="3.4.15"'),
    'The vulnerable bundled sanitizer must be removed.',
  );
  return text;
}
