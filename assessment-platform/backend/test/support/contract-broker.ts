// Transport double for HTTP/SQL lifecycle tests only. Never used by application entrypoints.
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  BrokerClient,
  BrokerResult,
  CompileResult,
  compileSchema,
  runSchema,
} from '../../src/workers/sandbox/protocol';
const success = (): BrokerResult => ({
  exitCode: 0,
  termination: 'EXITED',
  stdout: '',
  stderr: '',
  cpuTimeMs: 1,
  wallTimeMs: 2,
  memoryKiB: 1024,
});
export class ContractBroker implements BrokerClient {
  readonly requests: z.infer<typeof runSchema>[] = [];
  readonly artifacts = new Map<string, string>();
  outputs = new Map<string, string>();
  firstHiddenInput = '';
  transientFailures = 0;
  compileBarrier: Promise<void> | null = null;
  async health() {
    return { runtime: 'gvisor' as const, toolchains: [] };
  }
  async compile(input: z.infer<typeof compileSchema>): Promise<CompileResult> {
    if (this.compileBarrier) await this.compileBarrier;
    if (this.transientFailures > 0) {
      this.transientFailures--;
      throw new Error('untrusted-secret-diagnostic');
    }
    const result = success();
    if (input.sourceCode.includes('contract-compile-error'))
      return {
        artifactId: null,
        result: { ...result, exitCode: 1, stderr: 'syntax error at main.py:1' },
        toolchainDigest: 'sha256:' + 'a'.repeat(64),
      };
    const artifactId = randomUUID();
    this.artifacts.set(artifactId, input.sourceCode);
    return { artifactId, result, toolchainDigest: 'sha256:' + 'a'.repeat(64) };
  }
  async run(input: z.infer<typeof runSchema>): Promise<BrokerResult> {
    this.requests.push(input);
    const source = this.artifacts.get(input.artifactId) ?? '',
      stdin = Buffer.from(input.stdinBase64, 'base64').toString();
    const stdout =
      source.includes('contract-correct') ||
      (source.includes('contract-partial') && stdin === this.firstHiddenInput)
        ? (this.outputs.get(stdin) ?? 'incorrect\n')
        : source.includes('contract-echo')
          ? stdin
          : 'incorrect\n';
    return {
      ...success(),
      stdout,
      stderr: source.includes('contract-echo') ? `private echo: ${stdin}` : '',
    };
  }
  async cleanup(id: string) {
    this.artifacts.delete(id);
  }
}
