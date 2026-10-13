import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Worker, DelayedError } from 'bullmq';
import pino from 'pino';
import { judgeEnvironmentSchema } from '../../config/worker-environment';
import { workerContext } from '../worker-context';
import { ExecutionQueues, redisConnection } from '../../queues/execution-queues';
import { QUEUE_NAMES, type JudgeJob } from '../../queues/queue.contracts';
import { MtlsBrokerClient } from '../sandbox/broker-client';
import { ToolchainCatalog, toolchainDigest } from '../sandbox/toolchain-catalog';
import { TestcaseKeyring } from './testcase-crypto';
import { JudgeService, JudgeBusyError } from './judge-service';
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
async function main() {
  const env = judgeEnvironmentSchema.parse(process.env);
  if (env.SANDBOX_RUNTIME !== 'gvisor')
    throw new Error('Only the implemented gVisor broker is enabled');
  const context = await workerContext(env.DATABASE_JUDGE_URL, env.DATABASE_JUDGE_POOL_MAX);
  const catalog = ToolchainCatalog.fromFile(env.SANDBOX_TOOLCHAIN_CATALOG);
  const broker = new MtlsBrokerClient(
    env.SANDBOX_BROKER_URL,
    env.SANDBOX_CA_FILE,
    env.SANDBOX_CERT_FILE,
    env.SANDBOX_KEY_FILE,
    env.JUDGE_CONCURRENCY + env.JUDGE_PUBLIC_CONCURRENCY,
  );
  const keys = TestcaseKeyring.fromFile(env.TESTCASE_KEYRING_FILE, env.NODE_ENV === 'production');
  if (
    keys.id('PUBLIC') !== env.PUBLIC_TESTCASE_KMS_KEY_ID ||
    keys.id('HIDDEN') !== env.HIDDEN_TESTCASE_KMS_KEY_ID ||
    keys.id('DIAGNOSTICS') !== env.JUDGE_DIAGNOSTICS_KMS_KEY_ID
  )
    throw new Error('Configured active key IDs do not match the secret keyring');
  const queues = new ExecutionQueues(env.REDIS_QUEUE_URL, env.JUDGE_QUEUE_PREFIX);
  await queues.ready();
  const judge = new JudgeService(context.db, broker, catalog, keys, context.results);
  const id = randomUUID();
  const advertise = async () => {
    const health = await broker.health();
    const toolchainIds = catalog.entries
      .filter((entry) =>
        health.toolchains.some(
          (t) => t.id === entry.id && t.digest === toolchainDigest(entry.image),
        ),
      )
      .map((t) => t.id);
    if (!toolchainIds.length) throw new Error('NO_APPROVED_TOOLCHAINS');
    const now = await context.db.now();
    await context.db.judgeWorkerHeartbeat.upsert({
      where: { id },
      create: { id, toolchainIds, lastSeenAt: now },
      update: { toolchainIds, lastSeenAt: now },
    });
  };
  await advertise();
  const workers = [
    [QUEUE_NAMES.publicRuns, env.JUDGE_PUBLIC_CONCURRENCY],
    [QUEUE_NAMES.submissions, env.JUDGE_CONCURRENCY],
  ].map(
    ([name, concurrency]) =>
      new Worker<JudgeJob>(
        String(name),
        async (job, token) => {
          try {
            await judge.evaluate(job.data.submissionId, job.data.generation);
          } catch (error) {
            if (error instanceof JudgeBusyError && token) {
              await job.moveToDelayed(Date.now() + 10000, token);
              throw new DelayedError();
            }
            // eslint-disable-next-line preserve-caught-error -- preserve only a safe code at the Redis/logging boundary
            throw new Error('JUDGE_TRANSIENT_FAILURE');
          }
        },
        {
          connection: redisConnection(env.REDIS_QUEUE_URL, true),
          prefix: env.JUDGE_QUEUE_PREFIX,
          concurrency: Number(concurrency),
          lockDuration: 30000,
          stalledInterval: 15000,
          maxStalledCount: 2,
        },
      ),
  );
  for (const worker of workers) {
    worker.on('error', () => logger.error({ event: 'judge.queue.error' }));
    worker.on('failed', (job) => {
      if (
        job &&
        (job.attemptsMade >= (job.opts.attempts ?? 3) || job.failedReason.includes('stalled'))
      ) {
        void judge
          .exhaust(job.data.submissionId, job.data.generation)
          .then(() => queues.fail(job.data))
          .catch(() =>
            logger.error({
              event: 'judge.failure.persistence.failed',
              submissionId: job.data.submissionId,
            }),
          );
      }
    });
  }
  let advertising = false;
  const heartbeat = setInterval(() => {
    if (advertising) return;
    advertising = true;
    void advertise()
      .catch(() => logger.warn({ event: 'judge.health.failed' }))
      .finally(() => {
        advertising = false;
      });
  }, 10000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    await Promise.all(workers.map((w) => w.close()));
    await context.db.judgeWorkerHeartbeat.deleteMany({ where: { id } });
    await queues.close();
    broker.close();
    await context.db.onModuleDestroy();
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  logger.info({
    event: 'judge.ready',
    publicConcurrency: env.JUDGE_PUBLIC_CONCURRENCY,
    hiddenConcurrency: env.JUDGE_CONCURRENCY,
  });
}
void main().catch(() => {
  logger.fatal({ event: 'judge.startup.failed' });
  process.exit(1);
});
