import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '../src/queues/queue.contracts';
async function main() {
  const database = process.env.DATABASE_METRICS_URL;
  const redisUrl = process.env.REDIS_METRICS_URL;
  const assessment = process.env.LOAD_ASSESSMENT_ID;
  const prefix = process.env.JUDGE_QUEUE_PREFIX;
  const since = process.env.LOAD_METRICS_SINCE;
  if (
    process.env.LOAD_TEST_ACK !== 'DEDICATED_ISOLATED_LOAD_ENVIRONMENT' ||
    !database ||
    !redisUrl ||
    !assessment ||
    !/^[0-9a-f-]{36}$/.test(assessment) ||
    !prefix ||
    !/^[a-z0-9-]+$/.test(prefix) ||
    !since ||
    !Number.isFinite(Date.parse(since)) ||
    !/(^|[_-])(dev|test)([_-]|$)/i.test(new URL(database).pathname.slice(1))
  )
    throw new Error(
      'Explicit isolated test DB, read-only Redis/DB identities, assessment, queue prefix and UTC since timestamp required',
    );
  const output = resolve(
    process.env.LOAD_SERVER_METRICS_FILE ?? '../artifacts/load/server-metrics.jsonl',
  );
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const pool = new Pool({
    connectionString: database,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const redisProtocol = new URL(redisUrl).protocol;
  if (!['redis:', 'rediss:'].includes(redisProtocol)) throw new Error('Invalid Redis protocol');
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    commandTimeout: 4000,
    ...(redisProtocol === 'rediss:' ? { tls: { rejectUnauthorized: true } } : {}),
  });
  redis.on('error', () => {});
  let stopped = false;
  process.once('SIGINT', () => {
    stopped = true;
  });
  process.once('SIGTERM', () => {
    stopped = true;
  });
  let completedBefore = 0;
  let sampledBefore = Date.now();
  try {
    await redis.connect();
    while (!stopped) {
      const client = await pool.connect();
      let record;
      try {
        await client.query('BEGIN READ ONLY');
        const databaseMetrics = await client.query(
          `SELECT
          clock_timestamp() AS sampled_at,
          (SELECT count(*) FROM pg_stat_activity) AS connections,
          (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS maximum_connections,
          (SELECT count(*) FROM judge_worker_heartbeats WHERE last_seen_at > clock_timestamp() - interval '30 seconds') AS fresh_judge_workers,
          (SELECT count(*) FROM outbox_events WHERE status='PENDING') AS pending_outbox,
          (SELECT count(*) FROM assessment_attempts WHERE assessment_id=$1 AND status='FINALIZING') AS finalizing_attempts`,
          [assessment],
        );
        const submissions = await client.query(
          `SELECT purpose,status,count(*)::int AS count,
          max(extract(epoch FROM (clock_timestamp()-accepted_at))) FILTER (WHERE status IN ('PENDING','QUEUED')) AS oldest_pending_seconds,
          percentile_cont(ARRAY[0.50,0.95,0.99]) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at-accepted_at))) FILTER (WHERE status='COMPLETED') AS completion_percentiles_seconds
          FROM submissions s JOIN attempt_questions aq ON aq.id=s.attempt_question_id
          WHERE aq.assessment_id=$1 AND s.accepted_at >= $2::timestamptz GROUP BY purpose,status`,
          [assessment, since],
        );
        await client.query('COMMIT');
        const completed = submissions.rows
          .filter((row) => row.status === 'COMPLETED')
          .reduce((count, row) => count + Number(row.count), 0);
        const now = Date.now();
        record = {
          ...databaseMetrics.rows[0],
          submissions: submissions.rows,
          completed_jobs_per_second:
            Math.max(0, completed - completedBefore) / Math.max(1, (now - sampledBefore) / 1000),
        };
        completedBefore = completed;
        sampledBefore = now;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      const queues: Record<
        string,
        { waiting: number; active: number; delayed: number; prioritized: number }
      > = {};
      for (const name of [
        QUEUE_NAMES.publicRuns,
        QUEUE_NAMES.submissions,
        QUEUE_NAMES.deadLetter,
      ]) {
        const key = `${prefix}:${name}`;
        const counts = await Promise.all([
          redis.llen(`${key}:wait`),
          redis.llen(`${key}:active`),
          redis.zcard(`${key}:delayed`),
          redis.zcard(`${key}:prioritized`),
        ]);
        queues[name] = {
          waiting: counts[0]!,
          active: counts[1]!,
          delayed: counts[2]!,
          prioritized: counts[3]!,
        };
      }
      appendFileSync(output, `${JSON.stringify({ ...record, queues })}\n`, { mode: 0o600 });
      await new Promise((done) => setTimeout(done, 5000));
    }
  } finally {
    redis.disconnect();
    await pool.end();
  }
}
void main().catch(() => {
  console.error(
    'Trusted load metrics collection failed; no credentials or database error details logged.',
  );
  process.exitCode = 1;
});
