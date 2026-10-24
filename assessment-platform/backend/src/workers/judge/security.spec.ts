import { randomBytes } from 'node:crypto';
import { TestcaseKeyring, caseAad, caseHash, verifyCaseHash } from './testcase-crypto';
import { adaptSource } from './source-adapter';
import {
  securityArgs,
  sourceArchive,
  GvisorSandboxEngine,
  reportsMemoryLimit,
  type DockerControl,
} from '../sandbox/docker-engine';
import { ToolchainCatalog, runtimeCommand } from '../sandbox/toolchain-catalog';
const keys = new TestcaseKeyring({
  keys: ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'].map((dataClass) => ({
    id: dataClass,
    dataClass,
    base64: randomBytes(32).toString('base64'),
  })),
});
describe('private case cryptography and trusted source adapters', () => {
  it('authenticates the version, ordinal, visibility and data field', () => {
    const aad = caseAad('version', 1, 'HIDDEN', 'input');
    const payload = keys.encrypt('private-input', 'HIDDEN', 'HIDDEN', aad);
    expect(Buffer.from(payload).toString()).not.toContain('private-input');
    expect(keys.decrypt(payload, 'HIDDEN', 'HIDDEN', aad)).toBe('private-input');
    expect(() => keys.decrypt(payload, 'HIDDEN', 'PUBLIC', aad)).toThrow();
    expect(() =>
      keys.decrypt(payload, 'HIDDEN', 'HIDDEN', caseAad('other', 1, 'HIDDEN', 'input')),
    ).toThrow();
    const changed = new Uint8Array(payload);
    changed[13] = changed[13]! ^ 1;
    expect(() => keys.decrypt(changed, 'HIDDEN', 'HIDDEN', aad)).toThrow();
  });
  it('rejects ambiguous input/output concatenation and integrity mismatches', () => {
    expect(caseHash('a', 'bc')).not.toBe(caseHash('ab', 'c'));
    expect(() => verifyCaseHash('a', 'c', caseHash('a', 'b'))).toThrow();
  });
  it('supports only publication-owned adapters', () => {
    expect(adaptSource('code', { kind: 'STDIO' })).toBe('code');
    expect(
      adaptSource('def solve(): pass', {
        kind: 'SOURCE_WRAPPER',
        prefix: 'import sys',
        suffix: 'solve()',
      }),
    ).toContain('import sys\ndef solve(): pass\nsolve()');
    expect(() => adaptSource('code', { kind: 'SHELL', command: 'evil' })).toThrow();
    expect(() => adaptSource('code', { kind: 'STDIO', command: 'evil' })).toThrow();
  });
});
describe('mandatory sandbox launch policy', () => {
  it('classifies HotSpot fail-fast OOM stdout without reclassifying successful or arbitrary output', () => {
    expect(
      reportsMemoryLimit(3, 'Terminating due to java.lang.OutOfMemoryError: Java heap space\n', ''),
    ).toBe(true);
    expect(reportsMemoryLimit(1, '', 'java.lang.OutOfMemoryError: Java heap space')).toBe(true);
    expect(
      reportsMemoryLimit(0, 'Terminating due to java.lang.OutOfMemoryError: Java heap space', ''),
    ).toBe(false);
    expect(reportsMemoryLimit(1, 'The text OutOfMemoryError is in my answer', '')).toBe(false);
  });
  it('transfers a single fixed regular source file without staging host paths', () => {
    const archive = sourceArchive('main.py', 'print(42)');
    expect(archive.subarray(0, 7).toString()).toBe('main.py');
    expect(archive[156]).toBe(48);
    expect(() => sourceArchive('../../escape', 'code')).toThrow();
    expect(archive.subarray(512, 521).toString()).toBe('print(42)');
  });
  it('never permits host mounts, root execution, network or a default-runtime fallback', () => {
    const args = securityArgs(
      'safe',
      'sha256:' + 'a'.repeat(64),
      'assessment-artifact-safe',
      true,
      262144,
      32,
      12345,
    );
    for (const option of [
      '--runtime=runsc',
      '--network=none',
      '--user=10001:10001',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
    ])
      expect(args).toContain(option);
    expect(args).toContain('type=volume,source=assessment-artifact-safe,target=/work,readonly');
    expect(args.join(' ')).not.toMatch(/privileged|type=bind|docker\.sock|host-gateway/);
    expect(args).toContain('--pids-limit');
    expect(args).toContain('--memory-swap');
  });
  it('requires supported families and content-addressed toolchains', () => {
    expect(() => new ToolchainCatalog({ toolchains: [] })).toThrow();
    expect(
      () =>
        new ToolchainCatalog({
          toolchains: [{ id: 'x', language: 'PYTHON', image: 'python:latest', version: '3.13.1' }],
        }),
    ).toThrow();
    expect(runtimeCommand('JAVA', 262144)).toContain('-Xmx128m');
  });
  it('destroys the compiler sandbox before exposing an artifact to fresh read-only test sandboxes', async () => {
    const catalog = new ToolchainCatalog({
      toolchains: [
        ['python', 'PYTHON', '3.13.1'],
        ['java', 'JAVA', '21.0.1'],
        ['cpp', 'CPP', '14.1.0'],
      ].map(([id, language, version]) => ({
        id,
        language,
        version,
        image: 'sha256:' + 'a'.repeat(64),
      })),
    });
    const calls: string[][] = [];
    const control: DockerControl = {
      command: async (args) => {
        calls.push(args);
        return '';
      },
      execute: async (args) => {
        calls.push(args);
        return {
          exitCode: 0,
          termination: 'EXITED',
          stdout: '42',
          stderr: '',
          cpuTimeMs: 1,
          wallTimeMs: 1,
          memoryKiB: 1,
        };
      },
    };
    const engine = new GvisorSandboxEngine(catalog, control);
    const compiled = await engine.compile(
      {
        executionId: 'b2400000-0000-4000-8000-000000000010',
        toolchainId: 'python',
        sourceCode: 'print(42)',
      },
      new AbortController().signal,
    );
    const removed = calls.findIndex(
      (args) => args[0] === 'rm' && args[2]?.startsWith('assessment-compile-'),
    );
    expect(removed).toBeGreaterThan(0);
    expect(calls.some((args) => args[0] === 'exec')).toBe(false);
    await engine.run(
      {
        artifactId: compiled.artifactId!,
        stdinBase64: '',
        limits: {
          cpuTimeMs: 1000,
          wallTimeMs: 2000,
          memoryKiB: 262144,
          outputBytes: 65536,
          processCount: 32,
          workspaceBytes: 67108864,
        },
      },
      new AbortController().signal,
    );
    const runtime = calls.findIndex(
      (args) => args[0] === 'create' && args[2]?.startsWith('assessment-run-'),
    );
    expect(runtime).toBeGreaterThan(removed);
    expect(calls[runtime]).toContain(
      `type=volume,source=assessment-artifact-${compiled.artifactId},target=/work,readonly`,
    );
    await engine.cleanup(compiled.artifactId!);
    expect(calls.some((args) => args[0] === 'volume' && args[1] === 'rm')).toBe(true);
  });
});
