import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/database/generated/client';
import type { QuestionInput } from '../src/modules/admin/dto/management-input';
import { digest } from '../src/modules/admin/repositories/management.repository';
import { TestcaseKeyring, caseAad, caseHash } from '../src/workers/judge/testcase-crypto';

/** Add draft identities atomically. Existing bank entries and student work are never rewritten. */
export async function importProductionQuestionDrafts(
  db: PrismaClient,
  entries: QuestionInput[],
  keys: TestcaseKeyring,
) {
  if (entries.some((entry) => entry.templates.length))
    throw new Error('This importer only accepts drafts without toolchain templates');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261123, 417)`;
      const actor = await tx.admin.findFirst({
        where: { user: { role: 'ADMIN', isActive: true } },
        select: { id: true, userId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!actor) throw new Error('An existing active production administrator is required');
      const existing = await tx.question.findMany({
        where: { slug: { in: entries.map((entry) => entry.slug) } },
        select: { slug: true },
      });
      const known = new Set(existing.map((question) => question.slug));
      const fresh = entries
        .filter((entry) => !known.has(entry.slug))
        .map((input) => ({
          input,
          questionId: randomUUID(),
          versionId: randomUUID(),
        }));
      if (!fresh.length) return { created: 0, preserved: entries.length, status: 'DRAFT' };
      await tx.question.createMany({
        data: fresh.map(({ input, questionId }) => ({ id: questionId, slug: input.slug })),
      });
      await tx.questionTopic.createMany({
        data: fresh.flatMap(({ input, questionId }) =>
          input.topics.map((topic) => ({ questionId, topic })),
        ),
      });
      await tx.questionVersion.createMany({
        data: fresh.map(({ input, questionId, versionId }) => ({
          id: versionId,
          questionId,
          version: 1,
          createdById: actor.id,
          title: input.title,
          difficulty: input.difficulty,
          statement: input.statement,
          inputFormat: input.inputFormat,
          outputFormat: input.outputFormat,
          constraints: input.constraints,
          explanation: input.explanation,
          tags: input.tags,
          topicSnapshot: input.topics,
          publicExamples: input.publicExamples,
          maxScore: input.maxScore,
          cpuTimeMs: input.cpuTimeMs,
          wallTimeMs: input.wallTimeMs,
          memoryLimitKiB: input.memoryLimitKiB,
          outputLimitBytes: input.outputLimitBytes,
          processLimit: input.processLimit,
          outputComparison: input.outputComparison,
          contentHash: digest({ source: input, stage: 'DRAFT_IMPORT' }),
        })),
      });
      const cases = fresh.flatMap(({ input, versionId }) =>
        input.testCases.map((test) => {
          const keyId = keys.id(test.visibility);
          return {
            questionVersionId: versionId,
            ordinal: test.ordinal,
            visibility: test.visibility,
            weight: test.weight,
            encryptionKeyId: keyId,
            integrityHash: caseHash(test.input, test.expectedOutput),
            inputCiphertext: keys.encrypt(
              test.input,
              keyId,
              test.visibility,
              caseAad(versionId, test.ordinal, test.visibility, 'input'),
            ),
            expectedOutputCiphertext: keys.encrypt(
              test.expectedOutput,
              keyId,
              test.visibility,
              caseAad(versionId, test.ordinal, test.visibility, 'expected'),
            ),
          };
        }),
      );
      for (let offset = 0; offset < cases.length; offset += 300)
        await tx.testCase.createMany({ data: cases.slice(offset, offset + 300) });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: 'question.bank_drafts_imported',
          entityType: 'QuestionBank',
          requestId: randomUUID(),
          metadata: {
            source: 'Questions/question_bank.json',
            created: fresh.length,
            preserved: existing.length,
            questionIds: fresh.map((question) => question.questionId),
            status: 'DRAFT',
          },
        },
      });
      return { created: fresh.length, preserved: existing.length, status: 'DRAFT' };
    },
    { maxWait: 30000, timeout: 120000 },
  );
}
