import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
function collect(directory, recursive) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && recursive) collect(path, true);
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) files.push(path);
  }
}
collect(root, false);
collect(resolve(root, 'infra'), true);
collect(resolve(root, '../.github'), true);
for (const file of files) {
  const documents = parseAllDocuments(readFileSync(file, 'utf8'), { uniqueKeys: true });
  assert.equal(documents.length, 1, `${file}: expected one YAML document`);
  const document = documents[0];
  assert.equal(document.errors.length, 0, `${file}: ${document.errors.join('; ')}`);
  const value = document.toJS();
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${file}: expected a mapping`,
  );
}
console.log(
  `Validated ${files.length} YAML files, including workflows, Compose and monitoring configuration.`,
);
