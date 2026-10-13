import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { developmentDatabase } from './development-database';
import { judgeFixtures } from './judge-fixtures';
type StudentCredential = { identifier: string; password: string };
type Fixture = {
  format: 1;
  runId: string;
  databaseName: string;
  assessmentId: string;
  preparedAt: string;
  opensAt: string;
  closesAt: string;
  durationSeconds: number;
  students: StudentCredential[];
  sources: Record<string, Partial<Record<'PYTHON' | 'JAVA' | 'CPP', string>>>;
};
async function main() {
  if (process.env.LOAD_TEST_ACK !== 'DEDICATED_DISPOSABLE_TEST_DATABASE')
    throw new Error('LOAD_TEST_ACK must acknowledge a dedicated disposable test database');
  const count = Number(process.env.LOAD_STUDENT_COUNT ?? 500);
  const assessmentId = process.env.LOAD_ASSESSMENT_ID;
  const file = resolve(process.env.LOAD_FIXTURE_FILE ?? 'sandbox/secrets/load-fixture.local.json');
  if (!Number.isInteger(count) || count < 500 || count > 2000 || !assessmentId)
    throw new Error('An existing assessment ID and 500..2000 students are required');
  const db = developmentDatabase(); // Rejects production and database names without dev/test.
  try {
    const assessment = await db.assessment.findUniqueOrThrow({
      where: { id: assessmentId },
      include: {
        rule: true,
        pool: { include: { questionVersion: { include: { question: true } } } },
      },
    });
    if (
      !['SCHEDULED', 'OPEN'].includes(assessment.status) ||
      !assessment.opensAt ||
      !assessment.closesAt ||
      !assessment.rule?.allowedLanguages.includes('PYTHON')
    )
      throw new Error('Load target must be a published scheduled assessment allowing Python');
    if (
      assessment.rule.durationSeconds !== 10800 ||
      assessment.rule.easyCount !== 2 ||
      assessment.rule.mediumCount !== 1 ||
      assessment.rule.hardCount !== 1
    )
      throw new Error(
        'Benchmark target must use the initial 180-minute, four-question 2/1/1 configuration',
      );
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    let fixture: Fixture;
    if (existsSync(file)) {
      if (process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0)
        throw new Error('Existing fixture file must have mode 0600');
      fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
      if (
        fixture.format !== 1 ||
        fixture.databaseName !== databaseName ||
        fixture.assessmentId !== assessmentId ||
        fixture.students.length !== count
      )
        throw new Error(
          'Existing fixture belongs to a different database/assessment/count; use a new private filename',
        );
    } else {
      const provided = process.env.LOAD_SOURCE_FILE
        ? (JSON.parse(readFileSync(process.env.LOAD_SOURCE_FILE, 'utf8')) as Fixture['sources'])
        : {};
      const sources: Fixture['sources'] = {};
      for (const entry of assessment.pool) {
        const known = judgeFixtures.find((candidate) =>
          entry.questionVersion.question.slug.endsWith(candidate.slug),
        );
        sources[entry.questionVersionId] =
          provided[entry.questionVersionId] ?? (known ? { PYTHON: known.solution } : {});
        if (!sources[entry.questionVersionId]?.PYTHON)
          throw new Error(
            'Provide LOAD_SOURCE_FILE with reviewed reference code for every pool version',
          );
        for (const [language, code] of Object.entries(sources[entry.questionVersionId]!))
          if (
            !['PYTHON', 'JAVA', 'CPP'].includes(language) ||
            typeof code !== 'string' ||
            Buffer.byteLength(code) > 65536 ||
            code.includes('\0')
          )
            throw new Error('Invalid reference source language/size');
      }
      const runId = randomUUID();
      fixture = {
        format: 1,
        runId,
        databaseName,
        assessmentId,
        preparedAt: new Date().toISOString(),
        opensAt: assessment.opensAt.toISOString(),
        closesAt: assessment.closesAt.toISOString(),
        durationSeconds: assessment.rule.durationSeconds,
        students: Array.from({ length: count }, (_, index) => ({
          identifier: `LOAD-${runId.slice(0, 8)}-${String(index + 1).padStart(4, '0')}`,
          password: randomBytes(24).toString('base64url'),
        })),
        sources,
      };
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      // Save credentials before provisioning, allowing interrupted runs to resume safely.
      writeFileSync(file, JSON.stringify(fixture, null, 2), { mode: 0o600, flag: 'wx' });
    }
    for (const credential of fixture.students) {
      const existing = await db.student.findUnique({
        where: { externalId: credential.identifier },
        include: { user: true },
      });
      if (
        existing &&
        (!existing.user.isActive ||
          existing.user.role !== 'STUDENT' ||
          !(await argon2.verify(existing.user.passwordHash, credential.password)))
      )
        throw new Error('Fixture identity mismatch; existing account/credentials were preserved');
      const student =
        existing ??
        (await db.student.create({
          data: {
            externalId: credential.identifier,
            displayName: credential.identifier,
            user: {
              create: {
                email: `${createHash('sha256').update(credential.identifier).digest('hex')}@load-students.example.invalid`,
                role: 'STUDENT',
                passwordHash: await argon2.hash(credential.password, {
                  type: argon2.argon2id,
                  memoryCost: 65536,
                  timeCost: 3,
                  parallelism: 1,
                }),
              },
            },
          },
        }));
      await db.assessmentAssignment.upsert({
        where: { assessmentId_studentId: { assessmentId, studentId: student.id } },
        create: { assessmentId, studentId: student.id },
        update: {},
      });
    }
    console.log(
      `Prepared ${count} real student accounts and assignments. Private fixture: ${file}`,
    );
    console.log(
      'Reruns preserve identities, schedules, revoked assignments and existing attempts. Use a new test assessment/run for fresh start evidence.',
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Load fixture preparation failed. Check test database guard, assessment, reference sources and private file. No credentials were logged.',
  );
  process.exitCode = 1;
});
