import { z } from 'zod';
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1']).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(20),
    ADMIN_DATABASE_URL: z.string().startsWith('postgresql://').optional(),
    ADMIN_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    QUESTION_KEYRING_FILE: z.string().min(1).optional(),
    SANDBOX_TOOLCHAIN_CATALOG: z.string().min(1).optional(),
    REDIS_QUEUE_URL: z
      .string()
      .url()
      .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol)),
    REDIS_SESSION_URL: z
      .string()
      .url()
      .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol)),
    APP_ORIGINS: z
      .string()
      .min(1)
      .transform((value) =>
        value.split(',').map((origin) => z.string().url().parse(origin.trim())),
      ),
    ADMIN_ORIGINS: z
      .string()
      .min(1)
      .optional()
      .transform((value) =>
        value ? value.split(',').map((origin) => z.string().url().parse(origin.trim())) : [],
      ),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('assessment_session_dev'),
    SESSION_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(10800).max(2592000).default(43200),
    SESSION_REMEMBER_TTL_SECONDS: z.coerce.number().int().min(10800).max(2592000).default(604800),
    CSRF_SIGNING_KEY: z.string().min(32).optional(),
    LOGIN_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    LOGIN_IP_LIMIT: z.coerce.number().int().min(1).max(10000).default(1000),
    LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).max(262144).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
    JUDGE_QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]+$/),
    PUBLIC_TESTCASE_KMS_KEY_ID: z.string().min(1),
    EXECUTION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EXECUTION_MAX_PENDING_PUBLIC: z.coerce.number().int().min(1).max(10000).default(1500),
    EXECUTION_MAX_PENDING_HIDDEN: z.coerce.number().int().min(1).max(10000).default(1500),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.CSRF_SIGNING_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'Production requires a shared CSRF_SIGNING_KEY of at least 32 characters',
      });
    }
    if (
      [...env.APP_ORIGINS, ...env.ADMIN_ORIGINS].some((origin) => new URL(origin).origin !== origin)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'APP_ORIGINS and ADMIN_ORIGINS must contain exact origins without paths or trailing slashes',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      (!env.SESSION_SECURE || env.SESSION_COOKIE_NAME !== '__Host-assessment_session')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Production requires a Secure __Host-assessment_session cookie',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      [...env.APP_ORIGINS, ...env.ADMIN_ORIGINS].some(
        (origin) => new URL(origin).protocol !== 'https:',
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Production browser origins require HTTPS' });
    }
  })
  .transform((env) => ({
    ...env,
    APP_ORIGINS: [...new Set([...env.APP_ORIGINS, ...env.ADMIN_ORIGINS])],
  }));
export type Environment = z.infer<typeof environmentSchema>;
export const validateEnvironment = (input: Record<string, unknown>): Environment =>
  environmentSchema.parse(input);
