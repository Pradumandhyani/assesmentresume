import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { PrismaClient, Language } from '../src/database/generated/client';
import { TestcaseKeyring, caseAad, caseHash } from '../src/workers/judge/testcase-crypto';
import { judgeFixtures, starterTemplate } from './judge-fixtures';
const assessmentId = 'b2400000-0000-4000-8000-000000000001';
const ownerId = 'b2400000-0000-4000-8000-000000000002';
const adminId = 'b2400000-0000-4000-8000-000000000003';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export async function seedJudgeAssessment(
  db: PrismaClient,
  opensAt: Date,
  keys: TestcaseKeyring,
  toolchains: Record<Language, string>,
) {
  if (!Number.isFinite(opensAt.getTime())) throw new Error('Valid UTC schedule required');
  const disabledHash = await argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261012, 5)`;
      if (!(await tx.assessment.findUnique({ where: { id: assessmentId } }))) {
        await tx.user.create({
          data: {
            id: ownerId,
            email: 'development-judge-owner@example.invalid',
            role: 'ADMIN',
            isActive: false,
            passwordHash: disabledHash,
            admin: { create: { id: adminId, displayName: 'Execution fixture owner' } },
          },
        });
        const pool: { questionVersionId: string; questionId: string }[] = [];
        for (const fixture of judgeFixtures) {
          const question = await tx.question.create({
            data: {
              slug: `development-execution-${fixture.slug}`,
              topics: { create: { topic: fixture.topic } },
            },
          });
          const version = await tx.questionVersion.create({
            data: {
              questionId: question.id,
              version: 1,
              title: fixture.title,
              difficulty: fixture.difficulty,
              statement: fixture.statement,
              inputFormat: fixture.inputFormat,
              outputFormat: 'Print the required value followed by a newline.',
              constraints: fixture.constraints,
              explanation:
                'The public examples illustrate the contract. The same contract applies to all valid inputs.',
              createdById: adminId,
              topicSnapshot: [fixture.topic],
              tags: [fixture.topic.toLowerCase().replaceAll(' ', '-')],
              maxScore:
                fixture.difficulty === 'EASY'
                  ? '10.00'
                  : fixture.difficulty === 'MEDIUM'
                    ? '20.00'
                    : '30.00',
              cpuTimeMs: 2000,
              wallTimeMs: 10000,
              memoryLimitKiB: 262144,
              outputLimitBytes: 65536,
              publicExamples: fixture.cases
                .slice(0, 2)
                .map((c, index) => ({
                  ordinal: index + 1,
                  input: c.input,
                  expectedOutput: c.output,
                })),
            },
          });
          for (const language of ['PYTHON', 'JAVA', 'CPP'] as const)
            await tx.questionTemplate.create({
              data: {
                questionVersionId: version.id,
                language,
                toolchainId: toolchains[language],
                ...starterTemplate(language, fixture.functionAdapter),
              },
            });
          for (const [index, test] of fixture.cases.entries()) {
            const visibility = index < 2 ? 'PUBLIC' : 'HIDDEN',
              ordinal = index + 1,
              keyId = keys.id(visibility);
            await tx.testCase.create({
              data: {
                questionVersionId: version.id,
                ordinal,
                visibility,
                inputCiphertext: keys.encrypt(
                  test.input,
                  keyId,
                  visibility,
                  caseAad(version.id, ordinal, visibility, 'input'),
                ),
                expectedOutputCiphertext: keys.encrypt(
                  test.output,
                  keyId,
                  visibility,
                  caseAad(version.id, ordinal, visibility, 'expected'),
                ),
                encryptionKeyId: keyId,
                integrityHash: caseHash(test.input, test.output),
                weight: index < 2 ? 1 : index - 1,
              },
            });
          }
          await tx.questionVersion.update({
            where: { id: version.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              contentHash: digest(
                JSON.stringify({
                  fixture,
                  toolchains,
                  format: 'case-v1',
                  publicKeyId: keys.id('PUBLIC'),
                  hiddenKeyId: keys.id('HIDDEN'),
                }),
              ),
            },
          });
          pool.push({ questionVersionId: version.id, questionId: question.id });
        }
        await tx.assessment.create({
          data: {
            id: assessmentId,
            title: 'DSA Coding Assessment — Execution Round',
            description:
              'Eight published questions, four fixed assignments per student and a 70-mark grading policy.',
            createdById: adminId,
            rule: {
              create: {
                gradingPolicyVersion: 'v2-best-hidden-weighted',
                submissionSelection: 'BEST_VALID',
                partialScoring: true,
              },
            },
            pool: { create: pool },
          },
        });
        await tx.assessment.update({
          where: { id: assessmentId },
          data: {
            status: 'SCHEDULED',
            opensAt,
            latestStartAt: new Date(opensAt.getTime() + 1800000),
            closesAt: new Date(opensAt.getTime() + 12600000),
            resultsReleaseAt: new Date(opensAt.getTime() + 12600000),
          },
        });
      } else {
        // Fail rather than replacing a keyring or modifying immutable published fixture ciphertext.
        const cases = await tx.testCase.findMany({
          where: { questionVersion: { poolEntries: { some: { assessmentId } } } },
        });
        for (const test of cases)
          keys.decrypt(
            test.inputCiphertext,
            test.encryptionKeyId,
            test.visibility,
            caseAad(test.questionVersionId, test.ordinal, test.visibility, 'input'),
          );
      }
      const students = await tx.student.findMany({
        where: { user: { isActive: true, role: 'STUDENT' } },
        select: { id: true },
      });
      for (const student of students)
        await tx.assessmentAssignment.upsert({
          where: { assessmentId_studentId: { assessmentId, studentId: student.id } },
          create: { assessmentId, studentId: student.id },
          update: {},
        });
    },
    { timeout: 60000 },
  );
  return db.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
}
