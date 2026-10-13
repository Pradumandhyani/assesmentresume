import { z } from 'zod';
const id = z.string().uuid();
const limits = z
  .object({
    cpuTimeMs: z.number().int().min(1).max(10000),
    wallTimeMs: z.number().int().min(1).max(30000),
    memoryKiB: z.number().int().min(16384).max(1048576),
    outputBytes: z.number().int().min(1024).max(65536),
    processCount: z.number().int().min(1).max(64),
    workspaceBytes: z.literal(67108864),
  })
  .strict()
  .refine((v) => v.wallTimeMs >= v.cpuTimeMs);
export const compileSchema = z
  .object({
    executionId: id,
    toolchainId: z.string().min(1).max(128),
    sourceCode: z.string().max(98304),
  })
  .strict();
export const runSchema = z
  .object({ artifactId: id, stdinBase64: z.string().max(349528), limits })
  .strict();
export const cleanupSchema = z.object({ artifactId: id }).strict();
export interface BrokerResult {
  exitCode: number | null;
  termination:
    'EXITED' | 'CPU_LIMIT' | 'WALL_LIMIT' | 'MEMORY_LIMIT' | 'OUTPUT_LIMIT' | 'SANDBOX_ERROR';
  stdout: string;
  stderr: string;
  cpuTimeMs: number | null;
  wallTimeMs: number;
  memoryKiB: number | null;
}
export interface CompileResult {
  artifactId: string | null;
  result: BrokerResult;
  toolchainDigest: string;
}
export interface BrokerClient {
  health(): Promise<{ runtime: 'gvisor'; toolchains: { id: string; digest: string }[] }>;
  compile(input: z.infer<typeof compileSchema>, signal: AbortSignal): Promise<CompileResult>;
  run(input: z.infer<typeof runSchema>, signal: AbortSignal): Promise<BrokerResult>;
  cleanup(artifactId: string): Promise<void>;
}
export const brokerResultSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    termination: z.enum([
      'EXITED',
      'CPU_LIMIT',
      'WALL_LIMIT',
      'MEMORY_LIMIT',
      'OUTPUT_LIMIT',
      'SANDBOX_ERROR',
    ]),
    stdout: z.string().max(65536),
    stderr: z.string().max(4096),
    cpuTimeMs: z.number().nonnegative().nullable(),
    wallTimeMs: z.number().nonnegative(),
    memoryKiB: z.number().nonnegative().nullable(),
  })
  .strict();
