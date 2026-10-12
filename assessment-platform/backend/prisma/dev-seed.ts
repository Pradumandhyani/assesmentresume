import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { PrismaClient } from '../src/database/generated/client';
const assessmentId = 'b1400000-0000-4000-8000-000000000001';
const ownerId = 'b1400000-0000-4000-8000-000000000002';
const adminId = 'b1400000-0000-4000-8000-000000000003';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function encrypted(value: string, key: Buffer): Uint8Array<ArrayBuffer> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return new Uint8Array(
    Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]),
  );
}
const fixtures = [
  {
    title: 'Sum of an array',
    difficulty: 'EASY' as const,
    statement: 'Read n integers and print their sum.',
    sample: '3\n1 2 3\n',
    answer: '6\n',
  },
  {
    title: 'Largest element',
    difficulty: 'EASY' as const,
    statement: 'Read n integers and print the largest value.',
    sample: '3\n1 8 3\n',
    answer: '8\n',
  },
  {
    title: 'Longest distinct substring',
    difficulty: 'MEDIUM' as const,
    statement:
      'Read a string and print the length of its longest substring with distinct characters.',
    sample: 'abca\n',
    answer: '3\n',
  },
  {
    title: 'Grid paths',
    difficulty: 'HARD' as const,
    statement:
      'Read n and m, then an n by m grid of dots and hashes. Count right/down paths from the top left to bottom right avoiding hashes, modulo 1000000007.',
    sample: '2 2\n..\n..\n',
    answer: '2\n',
  },
];
/** Development fixture data only. Published fixtures are preserved on rerun. */
export async function seedDevelopmentAssessment(db: PrismaClient, opensAt: Date, key: Buffer) {
  if (key.length !== 32 || !Number.isFinite(opensAt.getTime()))
    throw new Error('Valid UTC schedule and a 32-byte development encryption key are required');
  const disabledOwnerHash = await argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261011, 2)`;
      const assessment = await tx.assessment.findUnique({ where: { id: assessmentId } });
      if (!assessment) {
        await tx.user.create({
          data: {
            id: ownerId,
            email: 'development-seed-owner@example.invalid',
            role: 'ADMIN',
            isActive: false,
            passwordHash: disabledOwnerHash,
            admin: { create: { id: adminId, displayName: 'Development fixture owner' } },
          },
        });
        const versions: { id: string; questionId: string }[] = [];
        for (const [index, fixture] of fixtures.entries()) {
          const question = await tx.question.create({
            data: {
              slug: `development-round-1-${index + 1}`,
              topics: {
                create: {
                  topic:
                    index < 2 ? 'Arrays' : index === 2 ? 'Sliding window' : 'Dynamic programming',
                },
              },
            },
          });
          const version = await tx.questionVersion.create({
            data: {
              questionId: question.id,
              version: 1,
              title: fixture.title,
              difficulty: fixture.difficulty,
              statement: fixture.statement,
              publicExamples: [
                { ordinal: 1, input: fixture.sample, expectedOutput: fixture.answer },
              ],
              explanation:
                'The sample illustrates the input and output format. Implement a general solution for all valid inputs.',
              inputFormat: 'Read from standard input as described in the statement.',
              outputFormat: 'Print the requested value followed by a newline.',
              constraints:
                'Development fixture only; limits must be reviewed before execution is enabled.',
              createdById: adminId,
              templates: {
                create: [
                  {
                    language: 'PYTHON',
                    starterCode: '# Read stdin and write stdout.\n',
                    toolchainId: 'development-unconfigured-python',
                  },
                  {
                    language: 'JAVA',
                    starterCode:
                      'public class Main { public static void main(String[] args) {} }\n',
                    toolchainId: 'development-unconfigured-java',
                  },
                  {
                    language: 'CPP',
                    starterCode: '#include <iostream>\nint main() { return 0; }\n',
                    toolchainId: 'development-unconfigured-cpp',
                  },
                ],
              },
              testCases: {
                create: [1, 2].map((ordinal) => ({
                  ordinal,
                  visibility: ordinal === 1 ? ('PUBLIC' as const) : ('HIDDEN' as const),
                  inputCiphertext: encrypted(fixture.sample, key),
                  expectedOutputCiphertext: encrypted(fixture.answer, key),
                  encryptionKeyId: 'development-fixture-aes256gcm-v1',
                  integrityHash: digest(fixture.sample + fixture.answer),
                })),
              },
            },
          });
          await tx.questionVersion.update({
            where: { id: version.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              contentHash: digest(JSON.stringify(fixture)),
            },
          });
          versions.push({ id: version.id, questionId: question.id });
        }
        await tx.assessment.create({
          data: {
            id: assessmentId,
            title: 'DSA Coding Assessment — Round 1',
            description:
              'A balanced challenge across arrays, strings and dynamic programming. Bring your problem-solving mindset and choose the language you know best.',
            createdById: adminId,
            rule: { create: {} },
            pool: {
              create: versions.map((v) => ({ questionVersionId: v.id, questionId: v.questionId })),
            },
          },
        });
        await tx.assessment.update({
          where: { id: assessmentId },
          data: {
            status: 'SCHEDULED',
            opensAt,
            latestStartAt: new Date(opensAt.getTime() + 1800000),
            closesAt: new Date(opensAt.getTime() + 12600000),
            resultsReleaseAt: new Date(opensAt.getTime() + 16200000),
          },
        });
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
    { timeout: 30000 },
  );
  return db.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
}
