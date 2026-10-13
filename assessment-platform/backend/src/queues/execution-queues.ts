import { Queue, type ConnectionOptions } from 'bullmq';
import { QUEUE_DEFAULTS, QUEUE_NAMES, type JudgeJob, type FinalizeJob } from './queue.contracts';
export function redisConnection(url: string, worker = false): ConnectionOptions {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('Unsupported Redis transport');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: { rejectUnauthorized: true } } : {}),
    ...(!worker ? { commandTimeout: 4000 } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 3000,
  };
}
export const judgeJobId = (id: string, generation: number) => `judge-${id}-g${generation}`;
export class ExecutionQueues {
  readonly publicRuns: Queue<JudgeJob>;
  readonly hidden: Queue<JudgeJob>;
  readonly finalization: Queue<FinalizeJob>;
  readonly deadLetter: Queue<JudgeJob>;
  constructor(url: string, prefix: string) {
    const options = { connection: redisConnection(url), prefix, defaultJobOptions: QUEUE_DEFAULTS };
    this.publicRuns = new Queue<JudgeJob>(QUEUE_NAMES.publicRuns, options);
    this.hidden = new Queue<JudgeJob>(QUEUE_NAMES.submissions, options);
    this.finalization = new Queue<FinalizeJob>(QUEUE_NAMES.finalization, options);
    this.deadLetter = new Queue<JudgeJob>(QUEUE_NAMES.deadLetter, {
      ...options,
      defaultJobOptions: { ...QUEUE_DEFAULTS, attempts: 1 },
    });
    for (const queue of [this.publicRuns, this.hidden, this.finalization, this.deadLetter])
      queue.on('error', () => {});
  }
  async ready() {
    await Promise.race([
      Promise.all(
        [this.publicRuns, this.hidden, this.finalization, this.deadLetter].map((q) =>
          q.waitUntilReady(),
        ),
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('REDIS_UNAVAILABLE')), 5000);
        timer.unref();
      }),
    ]);
  }
  async addJudge(purpose: string, job: JudgeJob) {
    const queue = purpose === 'RUN_PUBLIC' ? this.publicRuns : this.hidden;
    return queue.add('evaluate', job, {
      jobId: judgeJobId(job.submissionId, job.generation),
      priority: purpose === 'FINAL' ? 1 : 10,
    });
  }
  async fail(job: JudgeJob) {
    await this.deadLetter.add('retry-exhausted', job, {
      jobId: judgeJobId(job.submissionId, job.generation),
    });
  }
  async close() {
    await Promise.all(
      [this.publicRuns, this.hidden, this.finalization, this.deadLetter].map((q) => q.close()),
    );
  }
}
