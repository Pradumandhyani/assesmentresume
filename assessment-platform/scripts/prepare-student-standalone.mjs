import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const frontend = new URL('../frontend/', import.meta.url);
const target = new URL('.next/standalone/frontend/', frontend);
for (const folder of ['.next/static', 'public']) {
  const source = fileURLToPath(new URL(folder, frontend));
  if (!existsSync(source)) continue;
  const destination = fileURLToPath(new URL(folder, target));
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
console.log('Student standalone server assets prepared.');
