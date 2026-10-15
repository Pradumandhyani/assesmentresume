import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const admin = new URL('../admin/', import.meta.url);
const target = new URL('.next/standalone/admin/', admin);
if (!existsSync(fileURLToPath(new URL('server.js', target))))
  throw new Error('Build the admin standalone server before preparing its assets.');
for (const folder of ['.next/static', 'public']) {
  const source = fileURLToPath(new URL(folder, admin));
  if (!existsSync(source)) continue;
  const destination = fileURLToPath(new URL(folder, target));
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
console.log('Administration standalone server assets prepared.');
