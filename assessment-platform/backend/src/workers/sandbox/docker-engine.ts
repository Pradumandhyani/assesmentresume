// Trusted node-control code only. Student programs execute exclusively in mandatory runsc sandboxes.
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { compileSchema, runSchema, BrokerResult, CompileResult } from './protocol';
import {
  ToolchainCatalog,
  compilerCommand,
  runtimeCommand,
  sourceFilename,
  toolchainDigest,
  type Toolchain,
} from './toolchain-catalog';

// Docker can return the "not started" snapshot to a stats request that raced start.
// This is distinct from unavailable/corrupt telemetry for an already running guest.
class DockerStatsNotStarted extends Error {}
export function reportsMemoryLimit(exitCode: number | null, stdout: string, stderr: string) {
  return (
    exitCode !== 0 &&
    (/MemoryError|OutOfMemoryError|Cannot allocate memory|std::bad_alloc/.test(stderr) ||
      // HotSpot's -XX:+ExitOnOutOfMemoryError writes this diagnostic to stdout.
      /^Terminating due to java\.lang\.OutOfMemoryError(?::|\s)/m.test(stdout))
  );
}

export interface DockerControl {
  command(args: string[], timeoutMs?: number, stdin?: Buffer): Promise<string>;
  execute(
    args: string[],
    container: string,
    stdin: Buffer,
    limits: { cpuMs: number; wallMs: number; outputBytes: number },
    signal: AbortSignal,
  ): Promise<BrokerResult>;
}
export function securityArgs(
  name: string,
  image: string,
  volume: string,
  readonly: boolean,
  memoryKiB: number,
  processes: number,
  deadline: number,
) {
  return [
    'create',
    '--name',
    name,
    '--runtime=runsc',
    '--network=none',
    '--user=10001:10001',
    '--read-only',
    // Host PID budget includes the runsc/gofer threads; guest processes use RLIMIT_NPROC below.
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--pids-limit',
    '256',
    '--cpus=1',
    '--memory',
    `${memoryKiB}k`,
    '--memory-swap',
    `${memoryKiB}k`,
    '--ulimit',
    'nofile=64:64',
    '--ulimit',
    `nproc=${processes}:${processes}`,
    '--ulimit',
    'core=0:0',
    '--ulimit',
    'fsize=67108864:67108864',
    '--ipc=none',
    '--workdir=/work',
    '-i',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
    '--mount',
    `type=volume,source=${volume},target=/work${readonly ? ',readonly' : ''}`,
    '--label',
    'assessment-sandbox=true',
    '--label',
    `assessment-deadline=${deadline}`,
    image,
  ];
}
export class DockerCliControl implements DockerControl {
  constructor(private readonly socket = '/var/run/docker.sock') {}
  command(args: string[], timeoutMs = 10000, stdin?: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['--host', `unix://${this.socket}`, ...args], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
      let stdout = '';
      let length = 0;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('DOCKER_CONTROL_TIMEOUT'));
      }, timeoutMs);
      child.stdout.on('data', (data: Buffer) => {
        length += data.length;
        if (length > 1048576) {
          child.kill('SIGKILL');
          reject(new Error('DOCKER_CONTROL_LIMIT'));
        } else stdout += data.toString('utf8');
      });
      child.stderr.resume();
      child.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('DOCKER_CONTROL_UNAVAILABLE'));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error('DOCKER_CONTROL_FAILED'));
      });
    });
  }
  private stats(name: string): Promise<{ cpuMs: number; memoryKiB: number }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: `/containers/${encodeURIComponent(name)}/stats?stream=false&one-shot=true`,
          timeout: 1000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (data: Buffer) => {
            bytes += data.length;
            if (bytes > 262144) req.destroy();
            else chunks.push(data);
          });
          res.on('error', () => reject(new Error('DOCKER_STATS')));
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) throw new Error('DOCKER_STATS');
              const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                read?: string;
                cpu_stats?: { cpu_usage?: { total_usage?: number } };
                memory_stats?: { usage?: number };
              };
              const cpu = value.cpu_stats?.cpu_usage?.total_usage,
                memory = value.memory_stats?.usage;
              if (value.read === '0001-01-01T00:00:00Z' && cpu === 0 && memory === undefined)
                throw new DockerStatsNotStarted('DOCKER_STATS_NOT_STARTED');
              if (typeof cpu !== 'number' || typeof memory !== 'number')
                throw new Error('DOCKER_STATS');
              resolve({ cpuMs: cpu / 1000000, memoryKiB: Math.ceil(memory / 1024) });
            } catch (error) {
              reject(error instanceof DockerStatsNotStarted ? error : new Error('DOCKER_STATS'));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => reject(new Error('DOCKER_STATS')));
      req.end();
    });
  }
  async execute(
    args: string[],
    container: string,
    stdin: Buffer,
    limits: { cpuMs: number; wallMs: number; outputBytes: number },
    signal: AbortSignal,
  ): Promise<BrokerResult> {
    const started = performance.now();
    let termination: BrokerResult['termination'] = 'EXITED',
      stopped = false,
      ended = false;
    let cpuTimeMs: number | null = null,
      memoryKiB: number | null = null;
    let monitorFailure = false;
    const child = spawn('docker', ['--host', `unix://${this.socket}`, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let outSize = 0,
      errSize = 0;
    const kill = async (reason: BrokerResult['termination']) => {
      if (stopped || ended) return;
      stopped = true;
      termination = reason;
      try {
        await this.command(['kill', container], 3000);
      } catch {
        /* cleanup removes the entire sandbox */
      }
      child.kill('SIGKILL');
    };
    const abort = () => {
      void kill('SANDBOX_ERROR');
    };
    signal.addEventListener('abort', abort, { once: true });
    const wall = setTimeout(() => {
      void kill('WALL_LIMIT');
    }, limits.wallMs);
    child.stdout.on('data', (data: Buffer) => {
      const remaining = limits.outputBytes - outSize;
      outSize += data.length;
      if (remaining > 0) stdout.push(data.subarray(0, remaining));
      if (outSize > limits.outputBytes) void kill('OUTPUT_LIMIT');
    });
    child.stderr.on('data', (data: Buffer) => {
      const remaining = 4096 - errSize;
      errSize += data.length;
      if (remaining > 0) stderr.push(data.subarray(0, remaining));
      if (errSize > 4096) void kill('OUTPUT_LIMIT');
    });
    const sample = async () => {
      const stats = await this.stats(container);
      cpuTimeMs = stats.cpuMs;
      memoryKiB = Math.max(memoryKiB ?? 0, stats.memoryKiB);
      if (stats.cpuMs >= limits.cpuMs) await kill('CPU_LIMIT');
    };
    const monitor = (async () => {
      while (!ended && !stopped) {
        try {
          await sample();
        } catch (error) {
          // Exited containers can disappear from stats. Failure while running fails closed.
          if (!ended && !stopped) {
            try {
              const state = JSON.parse(
                await this.command(['inspect', '--format', '{{json .State}}', container]),
              ) as { Running: boolean };
              if (state.Running) {
                if (error instanceof DockerStatsNotStarted && cpuTimeMs === null) {
                  // The first request preceded Running. Collect a fresh sample now;
                  // failure here still fails closed. All kernel limits/watchdogs stay active.
                  await sample();
                } else {
                  monitorFailure = true;
                  await kill('SANDBOX_ERROR');
                }
              }
            } catch {
              monitorFailure = true;
              await kill('SANDBOX_ERROR');
            }
          }
        }
        if (!ended && !stopped) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('error', () => {
        termination = 'SANDBOX_ERROR';
        resolve(null);
      });
      child.on('close', resolve);
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
      if (signal.aborted) abort();
    });
    ended = true;
    clearTimeout(wall);
    signal.removeEventListener('abort', abort);
    await monitor;
    try {
      const state = JSON.parse(
        await this.command(['inspect', '--format', '{{json .State}}', container]),
      ) as { OOMKilled: boolean };
      if (state.OOMKilled) termination = 'MEMORY_LIMIT';
    } catch {
      termination = 'SANDBOX_ERROR';
    }
    if (monitorFailure) termination = 'SANDBOX_ERROR';
    const errorText = Buffer.concat(stderr).toString('utf8');
    if (
      termination === 'EXITED' &&
      reportsMemoryLimit(exitCode, Buffer.concat(stdout).toString('utf8'), errorText)
    )
      termination = 'MEMORY_LIMIT';
    return {
      exitCode,
      termination,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: errorText,
      cpuTimeMs: cpuTimeMs === null ? null : Math.ceil(cpuTimeMs),
      wallTimeMs: Math.ceil(performance.now() - started),
      memoryKiB,
    };
  }
}
type Artifact = {
  toolchain: Toolchain;
  volume: string;
  holder: string;
  deadline: number;
  active: boolean;
};
// Build one regular file, with a fixed allowlisted name; accept no student-supplied archive/path.
export function sourceArchive(filename: string, source: string): Buffer {
  if (!['main.py', 'Main.java', 'main.cpp'].includes(filename)) throw new Error('SOURCE_FILENAME');
  const content = Buffer.from(source),
    header = Buffer.alloc(512);
  const octal = (offset: number, size: number, value: number) =>
    header.write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size, 'ascii');
  header.write(filename);
  octal(100, 8, 0o444);
  octal(108, 8, 10001);
  octal(116, 8, 10001);
  octal(124, 12, content.length);
  octal(136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([
    header,
    content,
    Buffer.alloc(((512 - (content.length % 512)) % 512) + 1024),
  ]);
}
export class GvisorSandboxEngine {
  private readonly artifacts = new Map<string, Artifact>();
  constructor(
    readonly catalog: ToolchainCatalog,
    private readonly docker: DockerControl,
  ) {}
  async verifyRuntime(runscPath: string, sha256: string) {
    if (process.platform !== 'linux') throw new Error('Sandbox nodes require Linux');
    if (
      createHash('sha256')
        .update(await readFile(runscPath))
        .digest('hex') !== sha256
    )
      throw new Error('Unreviewed runsc binary');
    const info = JSON.parse(await this.docker.command(['info', '--format', '{{json .}}'])) as {
      Runtimes: Record<string, { path: string }>;
      CgroupVersion: string;
      SecurityOptions: string[];
    };
    if (info.Runtimes.runsc?.path !== runscPath || info.CgroupVersion !== '2')
      throw new Error('Mandatory runsc/cgroups v2 unavailable');
    if (
      !info.SecurityOptions.some(
        (option) => option.startsWith('name=seccomp') && !option.includes('unconfined'),
      )
    )
      throw new Error('Docker seccomp policy unavailable');
    for (const toolchain of this.catalog.entries) {
      await this.docker.command(['image', 'inspect', toolchain.image]); // digest must already be provisioned; no fallback/pull at request time
      const name = `assessment-version-${randomUUID()}`;
      const command =
        toolchain.language === 'PYTHON'
          ? ['python3', '--version']
          : toolchain.language === 'JAVA'
            ? ['java', '--version']
            : ['g++', '-dumpfullversion'];
      const version = await this.docker.command(
        [
          'run',
          '--rm',
          '--name',
          name,
          '--runtime=runsc',
          '--network=none',
          '--user=10001:10001',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges:true',
          '--pids-limit=256',
          '--memory=1g',
          '--memory-swap=1g',
          '--cpus=1',
          '--label',
          'assessment-sandbox=true',
          '--label',
          `assessment-deadline=${Date.now() + 30000}`,
          toolchain.image,
          ...command,
        ],
        30000,
      );
      if (!version.includes(toolchain.version)) throw new Error('Toolchain version mismatch');
    }
  }
  async compile(input: z.infer<typeof compileSchema>, signal: AbortSignal): Promise<CompileResult> {
    const toolchain = this.catalog.get(input.toolchainId);
    if (Buffer.byteLength(input.sourceCode) > 98304 || input.sourceCode.includes('\0'))
      throw new Error('SOURCE_LIMIT');
    const artifactId = randomUUID(),
      volume = `assessment-artifact-${artifactId}`,
      holder = `assessment-holder-${artifactId}`;
    const compiler = `assessment-compile-${artifactId}`;
    const deadline = Date.now() + 180000;
    this.artifacts.set(artifactId, { toolchain, volume, holder, deadline, active: false });
    try {
      await this.docker.command([
        'volume',
        'create',
        '--driver',
        'local',
        '--opt',
        'type=tmpfs',
        '--opt',
        'device=tmpfs',
        '--opt',
        'o=size=64m,uid=10001,gid=10001,mode=0700',
        '--label',
        'assessment-sandbox=true',
        '--label',
        `assessment-deadline=${deadline}`,
        volume,
      ]);
      // A trusted sleep process keeps the tmpfs mounted. It never executes student code.
      // The compiler is a different sandbox, destroyed before any test can read its artifact.
      await this.docker.command([
        ...securityArgs(holder, toolchain.image, volume, false, 65536, 4, deadline),
        'sleep',
        '180',
      ]);
      await this.docker.command(['start', holder]);
      const file = sourceFilename(toolchain.language);
      await this.docker.command(
        ['cp', '-', `${holder}:/work`],
        10000,
        sourceArchive(file, input.sourceCode),
      );
      await this.docker.command([
        ...securityArgs(compiler, toolchain.image, volume, false, 1048576, 64, deadline),
        ...compilerCommand(toolchain.language),
      ]);
      const result = await this.docker.execute(
        ['start', '-a', '-i', compiler],
        compiler,
        Buffer.alloc(0),
        { cpuMs: 30000, wallMs: 30000, outputBytes: 4096 },
        signal,
      );
      // Failure to remove the whole compiler sandbox fails closed; no surviving compiler
      // descendants may mutate artifacts while runtime sandboxes mount them read-only.
      await this.docker.command(['rm', '-f', compiler]);
      if (result.termination === 'EXITED' && result.exitCode === 0)
        return { artifactId, result, toolchainDigest: toolchainDigest(toolchain.image) };
      await this.cleanup(artifactId);
      return { artifactId: null, result, toolchainDigest: toolchainDigest(toolchain.image) };
    } catch (error) {
      await this.cleanup(artifactId);
      throw error;
    } finally {
      try {
        await this.docker.command(['rm', '-f', compiler]);
      } catch {
        /* independently labelled janitor also retries */
      }
    }
  }
  async run(input: z.infer<typeof runSchema>, signal: AbortSignal): Promise<BrokerResult> {
    const artifact = this.artifacts.get(input.artifactId);
    if (!artifact || artifact.deadline <= Date.now() || artifact.active)
      throw new Error('ARTIFACT_UNAVAILABLE');
    const stdin = Buffer.from(input.stdinBase64, 'base64');
    if (stdin.length > 262144 || stdin.toString('base64') !== input.stdinBase64)
      throw new Error('INPUT_LIMIT');
    artifact.active = true;
    const container = `assessment-run-${randomUUID()}`;
    try {
      const limits = input.limits;
      await this.docker.command([
        ...securityArgs(
          container,
          artifact.toolchain.image,
          artifact.volume,
          true,
          limits.memoryKiB,
          limits.processCount,
          Date.now() + limits.wallTimeMs + 15000,
        ),
        ...runtimeCommand(artifact.toolchain.language, limits.memoryKiB),
      ]);
      return await this.docker.execute(
        ['start', '-a', '-i', container],
        container,
        stdin,
        { cpuMs: limits.cpuTimeMs, wallMs: limits.wallTimeMs, outputBytes: limits.outputBytes },
        signal,
      );
    } finally {
      try {
        await this.docker.command(['rm', '-f', container]);
      } finally {
        artifact.active = false;
      }
    }
  }
  async cleanup(id: string) {
    const artifact = this.artifacts.get(id);
    if (!artifact) return;
    try {
      await this.docker.command(['rm', '-f', artifact.holder]);
    } catch {
      /* janitor retries */
    }
    try {
      await this.docker.command(['volume', 'rm', '-f', artifact.volume]);
    } catch {
      /* janitor retries */
    }
    this.artifacts.delete(id);
  }
  async reap() {
    for (const [id, artifact] of this.artifacts)
      if (artifact.deadline <= Date.now()) await this.cleanup(id);
    for (const kind of ['container', 'volume']) {
      const ids = (
        await this.docker.command(
          kind === 'container'
            ? ['ps', '-aq', '--filter', 'label=assessment-sandbox=true']
            : ['volume', 'ls', '-q', '--filter', 'label=assessment-sandbox=true'],
        )
      )
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        if (!/^(?:[a-f0-9]{12,64}|assessment-artifact-[a-f0-9-]{36})$/.test(id)) continue;
        try {
          const deadline = Number(
            await this.docker.command(
              kind === 'container'
                ? ['inspect', '--format', '{{index .Config.Labels "assessment-deadline"}}', id]
                : ['volume', 'inspect', '--format', '{{index .Labels "assessment-deadline"}}', id],
            ),
          );
          if (deadline > 0 && deadline <= Date.now())
            await this.docker.command(
              kind === 'container' ? ['rm', '-f', id] : ['volume', 'rm', '-f', id],
            );
        } catch {
          /* busy objects are retried by the next bounded janitor pass */
        }
      }
    }
  }
}
