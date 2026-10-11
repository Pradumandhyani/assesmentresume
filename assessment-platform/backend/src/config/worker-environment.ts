import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  REDIS_QUEUE_URL: z.string().url(),
  JUDGE_QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]+$/),
});

export const judgeEnvironmentSchema = base.extend({
  DATABASE_JUDGE_URL: z.string().startsWith('postgresql://'),
  DATABASE_JUDGE_POOL_MAX: z.coerce.number().int().min(1).max(16).default(4),
  JUDGE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  SANDBOX_RUNTIME: z.enum(['gvisor', 'firecracker']),
  SANDBOX_BROKER_URL: z.string().url().startsWith('https://'),
  PUBLIC_TESTCASE_KMS_KEY_ID: z.string().min(1),
  HIDDEN_TESTCASE_KMS_KEY_ID: z.string().min(1),
  JUDGE_DIAGNOSTICS_KMS_KEY_ID: z.string().min(1),
});

export const maintenanceEnvironmentSchema = base.extend({
  DATABASE_MAINTENANCE_URL: z.string().startsWith('postgresql://'),
  DATABASE_MAINTENANCE_POOL_MAX: z.coerce.number().int().min(1).max(16).default(4),
  EXPIRY_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
});

export type JudgeEnvironment = z.infer<typeof judgeEnvironmentSchema>;
export type MaintenanceEnvironment = z.infer<typeof maintenanceEnvironmentSchema>;

// Configuration schemas only; they do not create database clients, consumers or sandbox processes.
