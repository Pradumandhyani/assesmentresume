// Trusted test helper. Processes identifiers only and deliberately dies while holding a BullMQ lock.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- directly launched by Node without a TS transform
const { Worker } = require('bullmq');
const url = new URL(process.env.JUDGE_GATE_REDIS_URL);
const worker = new Worker(
  'judge-submissions-v1',
  async () => {
    if (process.send) process.send('claimed');
    process.exit(17);
  },
  {
    prefix: process.env.JUDGE_GATE_PREFIX,
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      db: Number(url.pathname.slice(1) || 0),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === 'rediss:' ? { tls: { rejectUnauthorized: true } } : {}),
      maxRetriesPerRequest: null,
    },
    lockDuration: 2000,
    stalledInterval: 1000,
  },
);
worker.on('error', () => process.exit(18));
