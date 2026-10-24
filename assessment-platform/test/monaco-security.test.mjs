import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import {
  monacoBundle,
  purifierAsset,
  purifierVersion,
  replaceBundledSanitizer,
} from '../scripts/monaco-security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));

test('served Monaco AMD assets load the patched sanitizer and remove unsafe HTML', () => {
  const prepared = spawnSync(process.execPath, ['scripts/prepare-monaco.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  const directory = join(root, 'frontend/public/monaco/vs');
  let dependencies, factory;
  runInNewContext(readFileSync(join(directory, monacoBundle), 'utf8'), {
    define: (name, deps, callback) => {
      assert.equal(name, 'vs/editor-BdtEMBbM');
      dependencies = deps;
      factory = callback;
    },
  });
  assert.equal(dependencies.at(-1), './assessment-dompurify');
  assert.equal(factory.length, dependencies.length);
  assert.ok(!factory.toString().includes('version="3.4.15"'));
  assert.ok(factory.toString().includes('assessmentDOMPurify(window)'));
  const { JSDOM } = frontendRequire('jsdom');
  const dom = new JSDOM('');
  try {
    let purifier;
    const define = (dependencies, make) => {
      assert.equal(dependencies.length, 0);
      purifier = make();
    };
    define.amd = true;
    runInNewContext(readFileSync(join(directory, purifierAsset), 'utf8'), {
      define,
      window: dom.window,
    });
    assert.equal(purifier.version, purifierVersion);
    assert.equal(purifier.isSupported, true);
    const safe = purifier.sanitize(
      '<p>safe</p><img src="x" onerror="alert(1)"><script>alert(1)</script>',
    );
    assert.equal(safe, '<p>safe</p><img src="x">');
    assert.equal(
      purifier
        .sanitize('<img src=x onerror=alert(1)>', { RETURN_DOM: true })
        .querySelector('img')
        .hasAttribute('onerror'),
      false,
    );
  } finally {
    dom.window.close();
  }
});

test('an unknown or already modified Monaco artifact fails closed instead of shipping stale code', () => {
  const packageRoot = realpathSync(join(root, 'frontend/node_modules/monaco-editor'));
  const original = readFileSync(join(packageRoot, 'min/vs', monacoBundle), 'utf8');
  const fixed = replaceBundledSanitizer(original);
  assert.throws(() => replaceBundledSanitizer(fixed), /Review the bundled Monaco sanitizer/);
  assert.throws(
    () => replaceBundledSanitizer(original + '\n'),
    /Review the bundled Monaco sanitizer/,
  );
});
