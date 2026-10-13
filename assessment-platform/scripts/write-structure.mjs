import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const destination = path.join(root, 'docs/folder-structure.md');
if (!existsSync(destination)) writeFileSync(destination, '');
const ignored = new Set([
  'node_modules',
  '.pnpm-store',
  '.npm-cache',
  '.tooling',
  '.git',
  '.next',
  'dist',
  'coverage',
  'artifacts',
  'secrets',
  'test-results',
  'playwright-report',
]);
let fileCount = 0;
function tree(folder, indent = '') {
  const entries = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => {
      const relative = path.relative(root, path.join(folder, entry.name)).replaceAll('\\', '/');
      return (
        !ignored.has(entry.name) &&
        relative !== 'backend/src/database/generated' &&
        relative !== 'frontend/public/monaco' &&
        !entry.name.endsWith('.tsbuildinfo') &&
        !entry.name.startsWith('.step4-') &&
        entry.name !== 'catalog.local.json' &&
        (!entry.name.startsWith('.env') || entry.name.endsWith('.example'))
      );
    })
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  const lines = [];
  for (const [index, entry] of entries.entries()) {
    const last = index === entries.length - 1;
    lines.push(`${indent}${last ? '└── ' : '├── '}${entry.name}${entry.isDirectory() ? '/' : ''}`);
    if (entry.isDirectory())
      lines.push(...tree(path.join(folder, entry.name), indent + (last ? '    ' : '│   ')));
    else fileCount++;
  }
  return lines;
}
const lines = tree(root);
writeFileSync(
  destination,
  `# Complete source structure\n\nExactly three application packages; root folders hold documentation, contracts, tests, scripts and infrastructure.\n\nGenerated dependency caches, build output, environment secrets and the regenerated Prisma client are excluded below.\n\n\`\`\`text\nassessment-platform/\n${lines.join('\n')}\n\`\`\`\n\n${fileCount} source/configuration/documentation files in this inventory.\n\nSteps 2–4 implement student authentication, dashboard, coding workspace, durable attempts/drafts, execution orchestration and grading. The gVisor judge has a separate Linux release gate; admin management remains reserved. The student App Router lives in frontend/src/app; components/features/services retain their original locations.\n`,
);
console.log(`Source inventory: ${fileCount} files, three applications.`);
