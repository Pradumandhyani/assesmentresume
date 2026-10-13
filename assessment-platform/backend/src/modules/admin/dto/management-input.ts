import { z } from 'zod';
import { ApiException } from '../../../common/http/api-error';
const score = z
  .string()
  .regex(/^\d{1,6}(?:\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0);
const language = z.enum(['PYTHON', 'JAVA', 'CPP']);
const topic = z.string().trim().min(1).max(100);
const source = z
  .string()
  .max(65536)
  .refine((v) => Buffer.byteLength(v) <= 65536 && !v.includes('\0'));
const utc = z
  .string()
  .datetime()
  .refine((v) => v.endsWith('Z'), 'UTC timestamps must end in Z');
export const revisionInput = z.object({ revision: z.number().int().min(1) }).strict();
export const pageInput = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(128).optional(),
    active: z.enum(['true', 'false']).optional(),
    status: z.string().max(50).optional(),
    assessmentId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
  })
  .strict();
export const studentInput = z
  .object({ active: z.boolean().optional(), cohort: topic.nullable().optional() })
  .strict()
  .refine((v) => v.active !== undefined || v.cohort !== undefined);
export const assignmentInput = z
  .object({
    studentIds: z.array(z.string().uuid()).max(5000).default([]),
    cohorts: z.array(topic).max(100).default([]),
    revoke: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.studentIds.length + v.cohorts.length > 0);
export const assessmentInput = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().max(20000).default(''),
    opensAt: utc,
    latestStartAt: utc,
    closesAt: utc,
    resultsReleaseAt: utc.nullable(),
    revision: z.number().int().min(1).optional(),
    rule: z
      .object({
        durationSeconds: z.number().int().min(900).max(21600),
        easyCount: z.number().int().min(0).max(20),
        mediumCount: z.number().int().min(0).max(20),
        hardCount: z.number().int().min(0).max(20),
        allowedLanguages: z
          .array(language)
          .min(1)
          .max(3)
          .refine((v) => new Set(v).size === v.length),
        allowedTopics: z.array(topic).max(50),
        marks: z.object({ EASY: score, MEDIUM: score, HARD: score }).strict(),
        submissionSelection: z.enum(['FINAL_SNAPSHOT', 'BEST_VALID', 'LATEST_VALID']),
        partialScoring: z.boolean(),
        hiddenFeedbackImmediate: z.boolean(),
      })
      .strict(),
    questionVersionIds: z
      .array(z.string().uuid())
      .max(500)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict()
  .superRefine((v, ctx) => {
    const r = v.rule,
      n = r.easyCount + r.mediumCount + r.hardCount;
    if (n < 1 || n > 20) ctx.addIssue({ code: 'custom', message: 'Question total must be 1..20' });
    if (
      Date.parse(v.latestStartAt) < Date.parse(v.opensAt) ||
      Date.parse(v.latestStartAt) + r.durationSeconds * 1000 > Date.parse(v.closesAt)
    )
      ctx.addIssue({ code: 'custom', message: 'Schedule must admit the full duration' });
    if (v.resultsReleaseAt && Date.parse(v.resultsReleaseAt) < Date.parse(v.closesAt))
      ctx.addIssue({ code: 'custom', message: 'Results cannot release before closing' });
  });
export const questionInput = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(200),
    title: z.string().trim().min(3).max(200),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    topics: z.array(topic).min(1).max(20),
    tags: z.array(topic).max(30),
    statement: z.string().min(10).max(100000),
    inputFormat: z.string().min(1).max(20000),
    outputFormat: z.string().min(1).max(20000),
    constraints: z.string().min(1).max(20000),
    explanation: z.string().max(20000).default(''),
    publicExamples: z
      .array(
        z
          .object({
            ordinal: z.number().int().min(1),
            input: z.string().max(65536),
            expectedOutput: z.string().max(65536),
          })
          .strict(),
      )
      .max(32),
    maxScore: score,
    cpuTimeMs: z.number().int().min(1).max(10000),
    wallTimeMs: z.number().int().min(1).max(30000),
    memoryLimitKiB: z.number().int().min(16384).max(1048576),
    outputLimitBytes: z.number().int().min(1024).max(65536),
    processLimit: z.number().int().min(1).max(64),
    outputComparison: z.enum(['TOKENS', 'EXACT']),
    templates: z
      .array(
        z
          .object({
            language,
            starterCode: source,
            toolchainId: z.string().regex(/^[a-z0-9-]{1,128}$/),
            executionAdapter: z
              .discriminatedUnion('kind', [
                z.object({ kind: z.literal('STDIO') }).strict(),
                z
                  .object({
                    kind: z.literal('SOURCE_WRAPPER'),
                    prefix: z.string().max(16384),
                    suffix: z.string().max(16384),
                  })
                  .strict(),
              ])
              .optional(),
          })
          .strict(),
      )
      .length(3),
    testCases: z
      .array(
        z
          .object({
            ordinal: z.number().int().min(1).max(64),
            visibility: z.enum(['PUBLIC', 'HIDDEN']),
            input: z
              .string()
              .max(262144)
              .refine((v) => Buffer.byteLength(v) <= 262144),
            expectedOutput: z
              .string()
              .max(65536)
              .refine((v) => Buffer.byteLength(v) <= 65536),
            weight: score,
          })
          .strict(),
      )
      .min(2)
      .max(64),
    revision: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.wallTimeMs < v.cpuTimeMs)
      ctx.addIssue({ code: 'custom', message: 'Wall limit must cover CPU limit' });
    if (v.testCases.some((c) => Buffer.byteLength(c.expectedOutput) > v.outputLimitBytes))
      ctx.addIssue({
        code: 'custom',
        message: 'Expected outputs must fit the configured output limit',
      });
    if (
      v.testCases.reduce(
        (n, c) => n + Buffer.byteLength(c.input) + Buffer.byteLength(c.expectedOutput),
        0,
      ) > 1048576
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Combined testcase plaintext must not exceed 1 MiB',
      });
    if (new Set(v.templates.map((t) => t.language)).size !== 3)
      ctx.addIssue({ code: 'custom', message: 'Exactly three supported templates required' });
    if (new Set(v.testCases.map((t) => t.ordinal)).size !== v.testCases.length)
      ctx.addIssue({ code: 'custom', message: 'Test ordinals must be unique' });
    for (const visibility of ['PUBLIC', 'HIDDEN']) {
      const n = v.testCases.filter((c) => c.visibility === visibility).length;
      if (!n || n > 32 || n * v.wallTimeMs + 30000 > 120000)
        ctx.addIssue({ code: 'custom', message: 'Test count exceeds bounded evaluation budget' });
    }
  });
export type AssessmentInput = z.infer<typeof assessmentInput>;
export type QuestionInput = z.infer<typeof questionInput>;
export type PageInput = z.infer<typeof pageInput>;
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiException(
      400,
      'VALIDATION_FAILED',
      'Check the configuration fields and resource limits.',
    );
  return result.data;
}
