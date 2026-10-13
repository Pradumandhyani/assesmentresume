import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 600000,
  }).trim();
const entries = [
  {
    id: 'python-3-13-v1',
    language: 'PYTHON',
    tag: 'python:3.13-slim-bookworm',
    command: ['python3', '--version'],
    pattern: /Python (3\.13\.\d+)/,
  },
  {
    id: 'java-21-v1',
    language: 'JAVA',
    tag: 'eclipse-temurin:21-jdk-jammy',
    command: ['java', '--version'],
    pattern: /openjdk (21\.\d+\.\d+)/,
  },
  {
    id: 'cpp-14-v1',
    language: 'CPP',
    tag: 'gcc:14-bookworm',
    command: ['g++', '-dumpfullversion'],
    pattern: /(14\.\d+\.\d+)/,
  },
];
const toolchains = [];
const destination = resolve(root, 'backend/sandbox/toolchains/catalog.local.json');
const historical = existsSync(destination)
  ? JSON.parse(readFileSync(destination, 'utf8')).toolchains
  : [];
if (!Array.isArray(historical))
  throw new Error('Existing catalog must be reviewed before rebuilding');
for (const entry of entries) {
  docker(['pull', entry.tag]);
  const metadata = JSON.parse(docker(['image', 'inspect', entry.tag]))[0];
  const base = metadata.RepoDigests?.[0];
  if (!base || !/@sha256:[a-f0-9]{64}$/.test(base))
    throw new Error('Base image digest unavailable');
  const tag = `assessment-toolchain:${entry.id}`;
  docker([
    'build',
    '--build-arg',
    `BASE_IMAGE=${base}`,
    '-t',
    tag,
    '-f',
    resolve(root, 'backend/sandbox/toolchains/Dockerfile'),
    resolve(root, 'backend/sandbox/toolchains'),
  ]);
  const image = JSON.parse(docker(['image', 'inspect', tag]))[0].Id;
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Built image digest unavailable');
  docker(['tag', image, `assessment-toolchain:${entry.id}-${image.slice(7)}`]);
  const version = docker(['run', '--rm', '--network=none', image, ...entry.command]).match(
    entry.pattern,
  )?.[1];
  if (!version) throw new Error('Runtime version unavailable');
  // Never rebind a published template ID to a newly patched image.
  toolchains.push({
    id: `${entry.id}-${image.slice(7)}`,
    language: entry.language,
    image,
    version,
  });
}
const combined = new Map(historical.map((entry) => [entry.id, entry]));
for (const entry of toolchains) {
  const old = combined.get(entry.id);
  if (old && old.image !== entry.image) throw new Error('Immutable toolchain ID conflict');
  combined.set(entry.id, entry);
}
if (combined.size > 20)
  throw new Error(
    'Catalog limit reached; review historical active version dependencies before retiring toolchains',
  );
writeFileSync(destination, `${JSON.stringify({ toolchains: [...combined.values()] }, null, 2)}\n`);
console.log(
  'Built content-addressed toolchain catalog. Review and run the gVisor security tests before deployment.',
);
