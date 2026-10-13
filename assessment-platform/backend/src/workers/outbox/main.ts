import 'reflect-metadata';
import { Worker } from 'bullmq';
import pino from 'pino';
import { maintenanceEnvironmentSchema } from '../../config/worker-environment';
import { workerContext } from '../worker-context';
import { ExecutionQueues, redisConnection } from '../../queues/execution-queues';
import { QUEUE_NAMES, type FinalizeJob } from '../../queues/queue.contracts';
import { OutboxDispatcher } from './outbox-dispatcher';
import { expireGrading } from './grading-cutoff';
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
async function main() {
  const env = maintenanceEnvironmentSchema.parse(process.env);
  const context = await workerContext(
    env.DATABASE_MAINTENANCE_URL,
    env.DATABASE_MAINTENANCE_POOL_MAX,
  );
  const queues = new ExecutionQueues(env.REDIS_QUEUE_URL, env.JUDGE_QUEUE_PREFIX);
  await queues.ready();
  const dispatcher = new OutboxDispatcher(context.db, queues, env.QUEUE_MAX_WAITING);
  // Recovery needs only terminal-state persistence, never testcase keys or a sandbox connection.
  const exhaust = async (submissionId: string, generation: number) => {
    const now = await context.db.now();
    const row = await context.db.submission.findUnique({
      where: { id: submissionId },
      select: { attemptId: true },
    });
    if (!row) return;
    await context.db.submission.updateMany({
      where: {
        id: submissionId,
        judgeGeneration: generation,
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      },
      data: {
        status: 'INFRASTRUCTURE_FAILED',
        completedAt: now,
        judgeLeaseToken: null,
        leaseExpiresAt: null,
        lastJudgeErrorCode: 'JUDGE_RETRY_EXHAUSTED',
      },
    });
    await context.results.settle(row.attemptId);
  };
  const worker = new Worker<FinalizeJob>(
    QUEUE_NAMES.finalization,
    async (job) => {
      const row = await context.db.assessmentAttempt.findUnique({
        where: { id: job.data.attemptId },
        select: { expiresAt: true },
      });
      if (row && row.expiresAt.toISOString() === job.data.expectedExpiresAt)
        await context.attempts.reconcile();
      await context.results.settle(job.data.attemptId);
    },
    {
      connection: redisConnection(env.REDIS_QUEUE_URL, true),
      prefix: env.JUDGE_QUEUE_PREFIX,
      concurrency: 2,
    },
  );
  worker.on('error', () => logger.error({ event: 'maintenance.queue.error' }));
  let busy = false,
    stopping = false;
  const reconcile = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      await context.attempts.reconcile();
      await context.results.reconcile();
      await expireGrading(context.db, context.results);
      await dispatcher.dispatchBatch(env.OUTBOX_BATCH_SIZE);
      await dispatcher.recover({ exhaust });
    } catch {
      logger.error({ event: 'maintenance.reconcile.failed' });
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => {
    void reconcile();
  }, env.EXPIRY_RECONCILE_INTERVAL_MS);
  await reconcile();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    await worker.close();
    while (busy) await new Promise((resolve) => setTimeout(resolve, 50));
    await queues.close();
    await context.db.onModuleDestroy();
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  logger.info({ event: 'maintenance.ready' });
}
void main().catch(() => {
  logger.fatal({ event: 'maintenance.startup.failed' });
  process.exit(1);
});
