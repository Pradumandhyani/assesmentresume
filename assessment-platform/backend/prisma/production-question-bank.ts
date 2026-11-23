import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/database/generated/client';
import { Prisma } from '../src/database/generated/client';
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

/** Fill only untouched source-import drafts; preserve edits, publication and deletions. */
export async function configureImportedDraftToolchains(
  db: PrismaClient,
  entries: QuestionInput[],
  apply = false,
) {
  if (entries.some((entry) => entry.templates.length !== 3))
    throw new Error('Three pinned templates are required for every source question');
  return db.$transaction(
    async (tx) => {
      if (apply)
        await tx.$queryRaw`SELECT id FROM questions WHERE slug IN (${Prisma.join(entries.map((entry) => entry.slug))}) ORDER BY id FOR UPDATE`;
      const questions = await tx.question.findMany({
        where: { slug: { in: entries.map((entry) => entry.slug) } },
        include: {
          versions: { orderBy: { version: 'desc' }, take: 1, include: { templates: true } },
        },
      });
      const inputs = new Map(entries.map((entry) => [entry.slug, entry]));
      const eligible = questions.filter((question) => {
        const version = question.versions[0];
        const source = { ...inputs.get(question.slug)!, templates: [] };
        return (
          !question.archivedAt &&
          version?.status === 'DRAFT' &&
          version.revision === 1 &&
          !version.templates.length &&
          version.contentHash === digest({ source, stage: 'DRAFT_IMPORT' })
        );
      });
      if (apply && eligible.length) {
        const actor = await tx.admin.findFirst({
          where: { user: { isActive: true, role: 'ADMIN' } },
          orderBy: { createdAt: 'asc' },
          select: { userId: true },
        });
        if (!actor) throw new Error('An active administrator is required');
        await tx.questionTemplate.createMany({
          data: eligible.flatMap((question) =>
            inputs.get(question.slug)!.templates.map((template) => ({
              questionVersionId: question.versions[0]!.id,
              ...template,
              executionAdapter: template.executionAdapter ?? { kind: 'STDIO' },
            })),
          ),
        });
        await tx.questionVersion.updateMany({
          where: { id: { in: eligible.map((question) => question.versions[0]!.id) } },
          data: { revision: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'question.bank_toolchains_configured',
            entityType: 'QuestionBank',
            requestId: randomUUID(),
            metadata: {
              questions: eligible.length,
              toolchainIds: [
                ...new Set(
                  entries.flatMap((entry) =>
                    entry.templates.map((template) => template.toolchainId),
                  ),
                ),
              ],
              questionIds: eligible.map((question) => question.id),
            },
          },
        });
      }
      return {
        eligible: eligible.length,
        configured: apply ? eligible.length : 0,
        preserved: questions.length - eligible.length,
        status: 'DRAFT',
      };
    },
    { maxWait: 30000, timeout: 60000 },
  );
}
