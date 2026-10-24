import { randomUUID } from 'node:crypto';
import { developmentDatabase } from './development-database';
import { TestcaseKeyring, caseAad } from '../src/workers/judge/testcase-crypto';

/** Reuse published fixtures; never alter old schedules, attempts, accounts or ciphertext. */
export async function ensureLocalPractice() {
  const db = developmentDatabase();
  try {
    const source = await db.assessment.findUniqueOrThrow({
      where: { id: 'b2400000-0000-4000-8000-000000000001' },
      include: { pool: true },
    });
    const keys = TestcaseKeyring.fromFile(process.env.TESTCASE_KEYRING_FILE!);
    const cases = await db.testCase.findMany({
      where: { questionVersionId: { in: source.pool.map((p) => p.questionVersionId) } },
    });
    for (const test of cases) {
      keys.decrypt(
        test.inputCiphertext,
        test.encryptionKeyId,
        test.visibility,
        caseAad(test.questionVersionId, test.ordinal, test.visibility, 'input'),
      );
      keys.decrypt(
        test.expectedOutputCiphertext,
        test.encryptionKeyId,
        test.visibility,
        caseAad(test.questionVersionId, test.ordinal, test.visibility, 'expected'),
      );
    }
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261016, 1)`;
        const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
        const students = await tx.student.findMany({
          where: { user: { isActive: true, role: 'STUDENT' } },
        });
        let practice = await tx.assessment.findFirst({
          where: {
            title: { startsWith: 'Local practice - ' },
            status: { in: ['SCHEDULED', 'OPEN'] },
            opensAt: { lte: now },
            latestStartAt: { gt: new Date(now.getTime() + 300000) },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!practice) {
          const draft = await tx.assessment.create({
            data: {
              title: `Local practice - ${now.toISOString()} - ${randomUUID().slice(0, 8)}`,
              description:
                'Local development round. Execution requires the separately validated isolated judge.',
              createdById: source.createdById,
              rule: {
                create: {
                  gradingPolicyVersion: 'v2-best-hidden-weighted',
                  submissionSelection: 'BEST_VALID',
                  partialScoring: true,
                },
              },
              pool: {
                create: source.pool.map((p) => ({
                  questionId: p.questionId,
                  questionVersionId: p.questionVersionId,
                })),
              },
            },
          });
          practice = await tx.assessment.update({
            where: { id: draft.id },
            data: {
              status: 'SCHEDULED',
              opensAt: new Date(now.getTime() - 60000),
              latestStartAt: new Date(now.getTime() + 86400000),
              closesAt: new Date(now.getTime() + 97200000),
              resultsReleaseAt: new Date(now.getTime() + 97200000),
            },
          });
          console.log('Created an open local practice round; historical schedules were preserved.');
        } else console.log('Reused the existing open local practice round.');
        for (const student of students)
          await tx.assessmentAssignment.upsert({
            where: { assessmentId_studentId: { assessmentId: practice.id, studentId: student.id } },
            create: { assessmentId: practice.id, studentId: student.id },
            update: {},
          });
      },
      { timeout: 30000 },
    );
  } finally {
    await db.$disconnect();
  }
}
void ensureLocalPractice().catch(() => {
  console.error(
    'Local practice setup failed. Check preserved keys, encrypted fixtures and the local database. No existing records were reset.',
  );
  process.exitCode = 1;
});
