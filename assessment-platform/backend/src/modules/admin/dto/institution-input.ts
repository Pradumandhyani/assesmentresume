import { z } from 'zod';
import { ApiException } from '../../../common/http/api-error';

const text = (max: number) => z.string().trim().min(1).max(max);
export const institutionInput = z
  .object({
    institutionId: text(128),
    name: text(200),
    mainFaculty: text(200),
    email: z.string().trim().toLowerCase().email().max(320),
    phone: text(40),
    address: z.string().trim().max(1000).default(''),
  })
  .strict();
export const newStudentInput = z
  .object({
    externalId: text(128),
    displayName: text(200),
    email: z.string().trim().toLowerCase().email().max(320),
    password: z
      .string()
      .min(12)
      .max(1024)
      .refine((v) => Buffer.byteLength(v) <= 1024),
    cohort: z.string().trim().max(100).default(''),
    course: text(100),
  })
  .strict();
export const studentBatchInput = z
  .object({
    students: z.array(newStudentInput).min(1).max(500),
  })
  .strict()
  .superRefine(({ students }, ctx) => {
    for (const field of ['externalId', 'email'] as const) {
      const seen = new Set<string>();
      students.forEach((student, index) => {
        if (seen.has(student[field]))
          ctx.addIssue({
            code: 'custom',
            path: ['students', index, field],
            message: `Duplicate ${field} in file`,
          });
        seen.add(student[field]);
      });
    }
  });
export type InstitutionInput = z.infer<typeof institutionInput>;
export type NewStudentInput = z.infer<typeof newStudentInput>;
export function parseInstitutionInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const row =
      issue.path[0] === 'students' && typeof issue.path[1] === 'number'
        ? `Student row ${issue.path[1] + 1}, `
        : '';
    const field = String(issue.path.at(-1) ?? 'input');
    throw new ApiException(400, 'VALIDATION_FAILED', `${row}${field}: ${issue.message}`);
  }
  return parsed.data;
}
