import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { Worker, QueueEvents } from 'bullmq';
import { MtlsBrokerClient } from '../../src/workers/sandbox/broker-client';
import { ToolchainCatalog, toolchainDigest } from '../../src/workers/sandbox/toolchain-catalog';
import { DockerCliControl, GvisorSandboxEngine } from '../../src/workers/sandbox/docker-engine';
import { TestcaseKeyring } from '../../src/workers/judge/testcase-crypto';
import { JudgeService } from '../../src/workers/judge/judge-service';
import { ExecutionQueues, redisConnection, judgeJobId } from '../../src/queues/execution-queues';
import { QUEUE_NAMES, type JudgeJob } from '../../src/queues/queue.contracts';
import { OutboxDispatcher } from '../../src/workers/outbox/outbox-dispatcher';
import { ResultsService } from '../../src/modules/results/results.service';
import { step4Context, envelope, type Submission } from '../support/step4-context';
import { judgeFixtures } from '../../prisma/judge-fixtures';
import { adaptSource } from '../../src/workers/judge/source-adapter';
import { outputMatches } from '../../src/modules/execution/grading';

// This suite never skips a missing dependency and never substitutes a mock judge.
// Run only on a disposable dedicated Linux sandbox node, using its isolated Redis.
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Real judge gate requires ${name}`);
  return value;
};
const limits = {
  cpuTimeMs: 2000,
  wallTimeMs: 10000,
  memoryKiB: 262144,
  outputBytes: 65536,
  processCount: 32,
  workspaceBytes: 67108864 as const,
};
describe('mandatory real gVisor / mTLS / Redis release gate', () => {
  let broker: MtlsBrokerClient, catalog: ToolchainCatalog, docker: DockerCliControl;
  let context: Awaited<ReturnType<typeof step4Context>>, queues: ExecutionQueues;
  const artifacts = new Set<string>();
  const languageId = (language: string) =>
    [...catalog.entries].reverse().find((t) => t.language === language)!.id;
  const compile = async (language: string, sourceCode: string) => {
    const result = await broker.compile(
      { executionId: randomUUID(), toolchainId: languageId(language), sourceCode },
      AbortSignal.timeout(35000),
    );
    if (result.artifactId) artifacts.add(result.artifactId);
    return result;
  };
  const execute = async (
    language: string,
    source: string,
    stdin = '',
    override: Partial<typeof limits> = {},
  ) => {
    const compiled = await compile(language, source);
    expect(compiled.result.termination).toBe('EXITED');
    expect(compiled.result.exitCode).toBe(0);
    expect(compiled.artifactId).not.toBeNull();
    try {
      return await broker.run(
        {
          artifactId: compiled.artifactId!,
          stdinBase64: Buffer.from(stdin).toString('base64'),
          limits: { ...limits, ...override },
        },
        AbortSignal.timeout(35000),
      );
    } finally {
      await broker.cleanup(compiled.artifactId!);
      artifacts.delete(compiled.artifactId!);
    }
  };
  beforeAll(async () => {
    if (process.platform !== 'linux' || required('JUDGE_GATE_ACK') !== 'DEDICATED_DISPOSABLE_LINUX')
      throw new Error(
        'Real judge gate requires an explicitly acknowledged dedicated Linux test node',
      );
    catalog = ToolchainCatalog.fromFile(required('SANDBOX_TOOLCHAIN_CATALOG'));
    docker = new DockerCliControl(process.env.SANDBOX_DOCKER_SOCKET ?? '/var/run/docker.sock');
    await new GvisorSandboxEngine(catalog, docker).verifyRuntime(
      required('SANDBOX_RUNSC_PATH'),
      required('SANDBOX_RUNSC_SHA256'),
    );
    broker = new MtlsBrokerClient(
      required('SANDBOX_BROKER_URL'),
      required('SANDBOX_CA_FILE'),
      required('SANDBOX_CERT_FILE'),
      required('SANDBOX_KEY_FILE'),
    );
    const health = await broker.health();
    for (const toolchain of catalog.entries)
      expect(health.toolchains).toContainEqual({
        id: toolchain.id,
        digest: toolchainDigest(toolchain.image),
      });
    queues = new ExecutionQueues(
      required('JUDGE_GATE_REDIS_URL'),
      `assessment-gate-${randomUUID()}`,
    );
    await queues.ready();
    context = await step4Context(
      catalog,
      TestcaseKeyring.fromFile(required('TESTCASE_KEYRING_FILE')),
    );
  });
  afterEach(async () => {
    if (!broker || !docker) return; // retain the prerequisite failure, rather than a teardown TypeError
    for (const id of artifacts) await broker.cleanup(id);
    artifacts.clear();
    // Only this suite's remote artifacts are removed; successful cleanup must leave no compiler descendants.
    const leftovers = await docker.command([
      'ps',
      '-aq',
      '--filter',
      'label=assessment-sandbox=true',
    ]);
    expect(leftovers).toBe('');
  });
  afterAll(async () => {
    if (queues) {
      for (const queue of [
        queues.publicRuns,
        queues.hidden,
        queues.finalization,
        queues.deadLetter,
      ])
        await queue.obliterate({ force: true });
      await queues.close();
    }
    await context?.close();
    broker?.close();
  });
  it.each([
    ['PYTHON', 'a,b=map(int,input().split())\nprint(a+b)\n'],
    [
      'JAVA',
      'import java.util.*; public class Main { public static void main(String[] a) { Scanner s=new Scanner(System.in); System.out.println(s.nextLong()+s.nextLong()); } }',
    ],
    ['CPP', '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}'],
  ])('compiles and executes pinned %s with real stdin', async (language, source) => {
    const result = await execute(language, source, '17 25\n');
    expect(result.termination).toBe('EXITED');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('42');
    expect(result.wallTimeMs).toBeGreaterThan(0);
  });
  it.each(['PYTHON', 'JAVA', 'CPP'])(
    'returns bounded real compilation errors for %s',
    async (language) => {
      const result = await compile(language, 'this is not valid source ???');
      expect(result.artifactId).toBeNull();
      expect(result.result.exitCode).not.toBe(0);
      expect(Buffer.byteLength(result.result.stderr)).toBeLessThanOrEqual(4096);
    },
  );
  it('terminates an infinite loop by CPU or wall budget', async () => {
    const result = await execute('PYTHON', 'while True: pass\n', '', {
      cpuTimeMs: 500,
      wallTimeMs: 3000,
    });
    expect(['CPU_LIMIT', 'WALL_LIMIT']).toContain(result.termination);
    expect(result.wallTimeMs).toBeLessThan(6500);
  });
  it('terminates excessive memory allocation without grading it as a wrong answer', async () => {
    const result = await execute(
      'JAVA',
      'public class Main { public static void main(String[] a) { byte[] huge=new byte[1024*1024*1024]; System.out.println(huge.length); } }',
    );
    expect(result.termination).toBe('MEMORY_LIMIT');
  });
  it('bounds output and preserves runtime errors', async () => {
    const flood = await execute('PYTHON', 'print("x"*1000000)\n', '', { outputBytes: 1024 });
    expect(flood.termination).toBe('OUTPUT_LIMIT');
    expect(Buffer.byteLength(flood.stdout)).toBeLessThanOrEqual(1024);
    const runtime = await execute('PYTHON', 'raise ValueError("public-error")\n');
    expect(runtime.termination).toBe('EXITED');
    expect(runtime.exitCode).not.toBe(0);
    expect(runtime.stderr).toContain('public-error');
  });
  it('has no outbound network, root privileges, application secrets, socket or writable root/artifact filesystem', async () => {
    const result = await execute(
      'PYTHON',
      `import os,socket,json
r={'uid':os.getuid(),'secrets':any(k.startswith(('DATABASE','REDIS','TESTCASE','SANDBOX')) for k in os.environ),'socket':os.path.exists('/var/run/docker.sock')}
for name,path in [('root','/root/canary'),('artifact','/work/tamper')]:
 try:
  open(path,'w').write('bad');r[name]=True
 except OSError:r[name]=False
try:
 s=socket.socket();s.settimeout(1);s.connect(('1.1.1.1',443));r['network']=True
except OSError:r['network']=False
print(json.dumps(r))
`,
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      uid: 10001,
      secrets: false,
      socket: false,
      root: false,
      artifact: false,
      network: false,
    });
  });
  it('enforces process limits and removes forked descendants', async () => {
    const result = await execute(
      'CPP',
      `#include <unistd.h>
#include <signal.h>
#include <iostream>
int main(){int n=0;pid_t p[100];for(;n<100;n++){pid_t id=fork();if(id<0)break;if(!id){sleep(20);_exit(0);}p[n]=id;}std::cout<<n<<std::endl;for(int i=0;i<n;i++)kill(p[i],SIGKILL);}
`,
      '',
      { processCount: 8 },
    );
    expect(result.exitCode).toBe(0);
    expect(Number(result.stdout.trim())).toBeLessThan(8);
  });
  it('checks all eight fixture reference solutions and their distinct I/O adapters against the real toolchain', async () => {
    for (const fixture of judgeFixtures) {
      const template = await context.prisma.questionTemplate.findFirstOrThrow({
        where: {
          language: 'PYTHON',
          questionVersion: { question: { slug: `development-execution-${fixture.slug}` } },
        },
      });
      const compiled = await compile(
        'PYTHON',
        adaptSource(fixture.solution, template.executionAdapter),
      );
      expect(compiled.artifactId).not.toBeNull();
      expect(compiled.result.exitCode).toBe(0);
      try {
        for (const test of fixture.cases) {
          const result = await broker.run(
            {
              artifactId: compiled.artifactId!,
              stdinBase64: Buffer.from(test.input).toString('base64'),
              limits,
            },
            AbortSignal.timeout(35000),
          );
          expect(result.termination).toBe('EXITED');
          expect(result.exitCode).toBe(0);
          expect(outputMatches(result.stdout, test.output, 'TOKENS')).toBe(true);
        }
      } finally {
        await broker.cleanup(compiled.artifactId!);
        artifacts.delete(compiled.artifactId!);
      }
    }
  });
  it('evaluates assigned reference solutions through the actual worker, without exposing hidden echo output', async () => {
    const attempt = await context.start();
    const judge = new JudgeService(
      context.prisma,
      broker,
      catalog,
      context.keys,
      context.app.get(ResultsService),
    );
    for (const q of attempt.questions) {
      const row = await context.prisma.questionVersion.findUniqueOrThrow({
        where: { id: q.questionVersionId },
        include: { question: true },
      });
      const fixture = judgeFixtures.find((f) => row.question.slug.endsWith(f.slug))!;
      await context.prisma.judgeWorkerHeartbeat.updateMany({
        data: { lastSeenAt: await context.prisma.now() },
      });
      const response = await context.request(
        `/attempts/${attempt.id}/submit-solution`,
        'POST',
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: fixture.solution },
        randomUUID(),
      );
      expect(response.status).toBe(202);
      const submitted = (await envelope<Submission>(response)).data;
      await judge.evaluate(submitted.id, 1);
      const stored = await context.prisma.submissionResult.findUniqueOrThrow({
        where: { submissionId: submitted.id },
      });
      expect(stored.verdict).toBe('ACCEPTED');
      expect(stored.passedCount).toBe(4);
      expect(stored.score.toString()).toBe(row.maxScore.toString());
      const poll = (
        await envelope<Submission>(await context.request(`/submissions/${submitted.id}`))
      ).data;
      expect(poll.result).toBeNull();
      expect(JSON.stringify(poll)).not.toMatch(/stdout|stderr|expectedOutput|Ciphertext/);
      const draft = await context.request(`/attempts/${attempt.id}/drafts/${q.id}/PYTHON`, 'PUT', {
        sourceCode: fixture.solution,
        expectedRevision: 0,
      });
      expect(draft.status).toBe(200);
    }
    const finalized = await context.request(
      `/attempts/${attempt.id}/finalize`,
      'POST',
      { expectedStateVersion: attempt.stateVersion },
      randomUUID(),
    );
    expect(finalized.status).toBe(202);
    for (const snapshot of await context.prisma.submission.findMany({
      where: { attemptId: attempt.id, purpose: 'FINAL' },
    }))
      await judge.evaluate(snapshot.id, 1);
    const result = await context.prisma.assessmentResult.findUniqueOrThrow({
      where: { attemptId: attempt.id },
    });
    expect(result.status).toBe('COMPLETE');
    expect(result.totalScore?.toString()).toBe('70');
    // Real malicious echo of a private case: only encrypted diagnostics retain that stdout.
    const other = await context.start('STEP4-OTHER'),
      q = other.questions.find((item) => item.difficulty === 'MEDIUM')!;
    await context.prisma.judgeWorkerHeartbeat.updateMany({
      data: { lastSeenAt: await context.prisma.now() },
    });
    const response = await context.request(
      `/attempts/${other.id}/submit-solution`,
      'POST',
      {
        attemptQuestionId: q.id,
        language: 'PYTHON',
        sourceCode: 'import sys\ns=sys.stdin.read();print(s);print(s,file=sys.stderr)\n',
      },
      randomUUID(),
    );
    expect(response.status).toBe(202);
    const submitted = (await envelope<Submission>(response)).data;
    await judge.evaluate(submitted.id, 1);
    const stored = await context.prisma.submissionResult.findUniqueOrThrow({
      where: { submissionId: submitted.id },
    });
    expect(stored.publicCaseResults).toBeNull();
    expect(stored.internalDiagnosticsCiphertext).not.toBeNull();
    const poll = await context.request(`/submissions/${submitted.id}`);
    expect(await poll.text()).not.toMatch(/stdout|stderr|expectedOutput|inputCiphertext/);
  });
  it('persists a real API run through outbox, Redis, actual JudgeService and the mTLS sandbox', async () => {
    const attempt = await context.start('STEP4-LATEST'),
      q = attempt.questions[0]!;
    const version = await context.prisma.questionVersion.findUniqueOrThrow({
      where: { id: q.questionVersionId },
      include: { question: true },
    });
    const fixture = judgeFixtures.find((f) => version.question.slug.endsWith(f.slug))!;
    await context.prisma.judgeWorkerHeartbeat.updateMany({
      data: { lastSeenAt: await context.prisma.now() },
    });
    const events = new QueueEvents(QUEUE_NAMES.publicRuns, {
      connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
      prefix: queues.publicRuns.opts.prefix!,
    });
    await events.waitUntilReady();
    const judge = new JudgeService(
      context.prisma,
      broker,
      catalog,
      context.keys,
      context.app.get(ResultsService),
    );
    const worker = new Worker<JudgeJob>(
      QUEUE_NAMES.publicRuns,
      async (job) => judge.evaluate(job.data.submissionId, job.data.generation),
      {
        connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
        prefix: queues.publicRuns.opts.prefix!,
        concurrency: 1,
      },
    );
    try {
      await worker.waitUntilReady();
      const response = await context.request(
        `/attempts/${attempt.id}/run`,
        'POST',
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: fixture.solution },
        randomUUID(),
      );
      expect(response.status).toBe(202);
      const accepted = (await envelope<Submission>(response)).data;
      await new OutboxDispatcher(context.prisma, queues).dispatchBatch(100);
      const job = await queues.publicRuns.getJob(judgeJobId(accepted.id, 1));
      expect(job).toBeDefined();
      await job!.waitUntilFinished(events, 120000);
      const polled = (
        await envelope<Submission>(await context.request(`/submissions/${accepted.id}`))
      ).data;
      expect(polled.status).toBe('COMPLETED');
      expect(polled.result?.verdict).toBe('ACCEPTED');
      expect(polled.result?.passedCount).toBe(2);
      expect(polled.result?.publicCaseResults).toHaveLength(2);
    } finally {
      await worker.close();
      await events.close();
    }
  });
  it('uses real Redis retries, deterministic IDs and identifier-only payloads', async () => {
    const events = new QueueEvents(QUEUE_NAMES.publicRuns, {
      connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
      prefix: queues.publicRuns.opts.prefix!,
    });
    await events.waitUntilReady();
    let attempts = 0;
    const worker = new Worker<JudgeJob>(
      QUEUE_NAMES.publicRuns,
      async (job) => {
        expect(Object.keys(job.data).sort()).toEqual(['generation', 'requestId', 'submissionId']);
        if (++attempts < 3) throw new Error('sanitized-transient-failure');
        return { recovered: true };
      },
      {
        connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
        prefix: queues.publicRuns.opts.prefix!,
        concurrency: 1,
      },
    );
    try {
      const payload = { submissionId: randomUUID(), generation: 1, requestId: randomUUID() };
      const job = await queues.addJudge('RUN_PUBLIC', payload),
        duplicate = await queues.addJudge('RUN_PUBLIC', payload);
      expect(job.id).toBe(duplicate.id);
      await job.waitUntilFinished(events, 20000);
      expect(attempts).toBe(3);
      // Durable accepted API snapshots enter the same real queues through the transactional outbox.
      await new OutboxDispatcher(context.prisma, queues).dispatchBatch(100);
    } finally {
      await worker.close();
      await events.close();
    }
  });
  it('recovers a real worker process crash through stalled-job detection', async () => {
    // Use only this gate's random namespace; no shared worker is started or interrupted.
    await queues.hidden.drain(true);
    const prefix = queues.hidden.opts.prefix!;
    const events = new QueueEvents(QUEUE_NAMES.submissions, {
      connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
      prefix,
    });
    await events.waitUntilReady();
    const child = fork(join(__dirname, 'crash-worker.cjs'), [], {
      env: { ...process.env, JUDGE_GATE_PREFIX: prefix },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('CRASH_HELPER_TIMEOUT'));
      }, 15000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    const job = await queues.addJudge('FINAL', {
      submissionId: randomUUID(),
      generation: 1,
      requestId: randomUUID(),
    });
    expect(await exited).toBe(17);
    const recovered = new Worker<JudgeJob>(
      QUEUE_NAMES.submissions,
      async () => ({ recovered: true }),
      {
        connection: redisConnection(required('JUDGE_GATE_REDIS_URL'), true),
        prefix,
        lockDuration: 2000,
        stalledInterval: 1000,
        maxStalledCount: 2,
      },
    );
    try {
      expect(await job.waitUntilFinished(events, 20000)).toEqual({ recovered: true });
    } finally {
      await recovered.close();
      await events.close();
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
});
