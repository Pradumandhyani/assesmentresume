import { readFileSync } from 'node:fs';
import { z } from 'zod';
const item = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,128}$/),
    language: z.enum(['PYTHON', 'JAVA', 'CPP']),
    image: z.string().regex(/^(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/),
    version: z.string().min(1).max(100),
  })
  .strict();
export type Toolchain = z.infer<typeof item>;
export const toolchainDigest = (image: string) =>
  image.includes('@') ? image.split('@')[1]! : image;
export class ToolchainCatalog {
  readonly entries: Toolchain[];
  constructor(value: unknown) {
    this.entries = z
      .object({ toolchains: z.array(item).min(3).max(20) })
      .strict()
      .parse(value).toolchains;
    if (new Set(this.entries.map((v) => v.id)).size !== this.entries.length)
      throw new Error('Duplicate toolchain IDs');
    for (const language of ['PYTHON', 'JAVA', 'CPP'])
      if (!this.entries.some((v) => v.language === language))
        throw new Error('Three reviewed languages are required');
    // Supported runtime families. Patch versions and immutable image digests are mandatory.
    for (const v of this.entries) {
      if (v.language === 'PYTHON' && !/^3\.(13|14)\.\d+$/.test(v.version))
        throw new Error('Unsupported Python runtime');
      if (v.language === 'JAVA' && !/^(21|25)\.\d+\.\d+(?:\+\d+)?$/.test(v.version))
        throw new Error('Unsupported JDK runtime');
      if (v.language === 'CPP' && !/^(14|15)\.\d+\.\d+$/.test(v.version))
        throw new Error('Unsupported GCC runtime');
    }
  }
  static fromFile(path: string) {
    return new ToolchainCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  }
  get(id: string) {
    const entry = this.entries.find((v) => v.id === id);
    if (!entry) throw new Error('Unapproved toolchain');
    return entry;
  }
}
export const sourceFilename = (language: Toolchain['language']) =>
  ({ PYTHON: 'main.py', JAVA: 'Main.java', CPP: 'main.cpp' })[language];
export const compilerCommand = (language: Toolchain['language']): string[] =>
  ({
    PYTHON: ['python3', '-m', 'py_compile', '/work/main.py'],
    JAVA: ['javac', '-encoding', 'UTF-8', '-d', '/work', '/work/Main.java'],
    CPP: ['g++', '-std=c++20', '-O2', '-pipe', '/work/main.cpp', '-o', '/work/main'],
  })[language];
export function runtimeCommand(language: Toolchain['language'], memoryKiB: number): string[] {
  if (language === 'PYTHON') return ['python3', '-I', '-B', '/work/main.py'];
  if (language === 'CPP') return ['/work/main'];
  const heap = Math.max(16, Math.floor(memoryKiB / 2048));
  return [
    'java',
    '-Xms16m',
    `-Xmx${heap}m`,
    '-XX:MaxMetaspaceSize=64m',
    '-XX:ReservedCodeCacheSize=32m',
    '-Xss512k',
    '-XX:ActiveProcessorCount=1',
    '-XX:+ExitOnOutOfMemoryError',
    '-cp',
    '/work',
    'Main',
  ];
}
