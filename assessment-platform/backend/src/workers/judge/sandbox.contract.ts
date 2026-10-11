export interface SandboxLimits {
  readonly cpuTimeMs: number;
  readonly wallTimeMs: number;
  readonly memoryKiB: number;
  readonly outputBytes: number;
  readonly processCount: number;
  readonly workspaceBytes: number;
}
export interface SandboxRequest {
  readonly executionId: string;
  readonly imageDigest: string;
  readonly language: 'PYTHON' | 'JAVA' | 'CPP';
  readonly sourceCode: string;
  readonly stdin: Uint8Array;
  readonly limits: SandboxLimits;
}
export interface SandboxResponse {
  readonly exitCode: number | null;
  readonly termination:
    'EXITED' | 'CPU_LIMIT' | 'WALL_LIMIT' | 'MEMORY_LIMIT' | 'OUTPUT_LIMIT' | 'SANDBOX_ERROR';
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly cpuTimeMs: number;
  readonly memoryKiB: number;
}
export interface SandboxBroker {
  execute(request: SandboxRequest): Promise<SandboxResponse>;
}
// Internal-only mTLS contract. Never implement with unrestricted child_process or expose to browsers.
