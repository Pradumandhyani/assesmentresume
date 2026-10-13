import type { PrismaService } from '../../database/prisma.service';
import { ExecutionQueues, judgeJobId } from '../../queues/execution-queues';
import type { JudgeJob } from '../../queues/queue.contracts';
import type { JudgeService } from '../judge/judge-service';
export class OutboxDispatcher {
  constructor(
    private readonly db: PrismaService,
    private readonly queues: ExecutionQueues,
    private readonly maximumWaiting = 5000,
  ) {}
  async dispatchBatch(limit = 50): Promise<number> {
    let count = 0;
    for (let index = 0; index < limit; index++) {
      const handled = await this.db.$transaction(
        async (tx) => {
          const [item] = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM outbox_events WHERE status = 'PENDING'
          AND available_at <= clock_timestamp() ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
          if (!item) return 0;
          const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: item.id } });
          if (event.eventType === 'submission.judge') {
            const submission = await tx.submission.findUnique({ where: { id: event.aggregateId } });
            if (submission && ['PENDING', 'QUEUED', 'RUNNING'].includes(submission.status)) {
              const queue =
                submission.purpose === 'RUN_PUBLIC' ? this.queues.publicRuns : this.queues.hidden;
              const counts = await queue.getJobCounts(
                'waiting',
                'active',
                'delayed',
                'prioritized',
              );
              if (Object.values(counts).reduce((n, value) => n + value, 0) >= this.maximumWaiting) {
                const now = (
                  await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
                )[0]!.now;
                await tx.outboxEvent.update({
                  where: { id: event.id },
                  data: { availableAt: new Date(now.getTime() + 5000) },
                });
                return -1; // defer only this queue; do not block final snapshots behind a busy public queue
              }
              await this.queues.addJudge(submission.purpose, {
                submissionId: submission.id,
                generation: submission.judgeGeneration,
                requestId: event.id,
              });
              await tx.submission.updateMany({
                where: { id: submission.id, status: 'PENDING' },
                data: { status: 'QUEUED', stateVersion: { increment: 1 } },
              });
            }
          } else if (event.eventType === 'attempt.expiry') {
            const attempt = await tx.assessmentAttempt.findUnique({
              where: { id: event.aggregateId },
              select: { expiresAt: true },
            });
            if (attempt)
              await this.queues.finalization.add(
                'expire',
                {
                  attemptId: event.aggregateId,
                  expectedExpiresAt: attempt.expiresAt.toISOString(),
                },
                { jobId: `expire-${event.aggregateId}` },
              );
          } else throw new Error('UNKNOWN_OUTBOX_EVENT');
          const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
            .now;
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'DISPATCHED', dispatchedAt: now },
          });
          return 1;
        },
        { timeout: 10000 },
      );
      if (!handled) break;
      if (handled === 1) count++;
    }
    return count;
  }
  async recover(judge: Pick<JudgeService, 'exhaust'>) {
    const now = await this.db.now();
    const rows = await this.db.submission.findMany({
      where: {
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
        acceptedAt: { lt: new Date(now.getTime() - 60000) },
      },
      orderBy: { acceptedAt: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      if (row.status === 'RUNNING' && row.leaseExpiresAt && row.leaseExpiresAt > now) continue;
      const queue = row.purpose === 'RUN_PUBLIC' ? this.queues.publicRuns : this.queues.hidden;
      const job = await queue.getJob(judgeJobId(row.id, row.judgeGeneration));
      const state = job ? await job.getState() : null;
      const payload: JudgeJob = {
        submissionId: row.id,
        generation: row.judgeGeneration,
        requestId: row.id,
      };
      if (row.judgeAttempts >= 3 || state === 'failed') {
        await judge.exhaust(row.id, row.judgeGeneration);
        await this.queues.fail(payload);
        continue;
      }
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized'
      )
        continue;
      if (job) await job.remove();
      if (row.status === 'RUNNING')
        await this.db.submission.updateMany({
          where: {
            id: row.id,
            status: 'RUNNING',
            judgeLeaseToken: row.judgeLeaseToken,
            leaseExpiresAt: { lte: now },
          },
          data: {
            status: 'QUEUED',
            judgeLeaseToken: null,
            leaseExpiresAt: null,
            stateVersion: { increment: 1 },
          },
        });
      await this.queues.addJudge(row.purpose, payload);
    }
  }
}
