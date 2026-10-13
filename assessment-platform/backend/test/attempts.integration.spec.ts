import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { validateEnvironment } from '../src/config/environment';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AttemptsModule } from '../src/modules/attempts/attempts.module';
import { AttemptsService } from '../src/modules/attempts/attempts.service';
import { SessionGuard } from '../src/common/guards/session.guard';
import { ApiExceptionFilter, ApiResponseInterceptor } from '../src/common/http/api-response';
import { seedDevelopmentAssessment } from '../prisma/dev-seed';
import type { components } from '../../contracts/generated/api';
type Attempt = components['schemas']['AttemptResponse'];
type Envelope<T> = { data: T; meta: { serverNow: string } };
describe('Step 3 real HTTP / PostgreSQL attempt lifecycle', () => {
  let app: INestApplication,
    db: PGlite,
    socket: PGLiteSocketServer,
    prisma: PrismaService,
    base: string,
    assessmentId: string,
    attempt: Attempt,
    owner: string;
  let cookie = '',
    csrf = '';
  async function request(path: string, method = 'GET', body?: unknown, key?: string) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost:3000',
        ...(body !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function signIn(identifier: string) {
    cookie = '';
    const pre = await request('/auth/csrf');
    cookie = pre.headers
      .getSetCookie()
      .map((s) => s.split(';')[0]!)
      .join('; ');
    csrf = ((await pre.json()) as Envelope<{ csrfToken: string }>).data.csrfToken;
    const login = await request('/auth/login', 'POST', {
      identifier,
      password: 'Integration-only-password!',
    });
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((s) => s.split(';')[0]!)
      .join('; ');
    csrf = ((await (await request('/auth/csrf')).json()) as Envelope<{ csrfToken: string }>).data
      .csrfToken;
  }
  async function body<T>(response: Response) {
    return (await response.json()) as Envelope<T>;
  }
  beforeAll(async () => {
    db = await PGlite.create();
    for (const name of [
      '20261011000000_new_install_only',
      '20261011010000_student_dashboard',
      '20261012000000_public_question_examples',
      '20261012010000_execution_lifecycle',
    '20261013000000_admin_management',
    ])
      await db.exec(
        readFileSync(resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8'),
      );
    socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
    await socket.start();
    const environment = validateEnvironment({
      ...parse(readFileSync(resolve(__dirname, '../.env.example'))),
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
      DATABASE_POOL_MAX: '1',
      CSRF_SIGNING_KEY: randomBytes(32).toString('hex'),
      ARGON2_MEMORY_KIB: '19456',
      ARGON2_TIME_COST: '2',
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => environment],
        }),
        DatabaseModule,
        AuthModule,
        AttemptsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    prisma = app.get(PrismaService);
    const passwordHash = await argon2.hash('Integration-only-password!', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    for (const externalId of [
      'ATTEMPT-OWNER',
      'ATTEMPT-OTHER',
      'ATTEMPT-EXPIRED',
      'ATTEMPT-RECONCILE',
      'ATTEMPT-VOID',
    ])
      await prisma.user.create({
        data: {
          email: `${externalId}@test.invalid`,
          role: 'STUDENT',
          passwordHash,
          student: { create: { externalId, displayName: externalId } },
        },
      });
    const assessment = await seedDevelopmentAssessment(
      prisma,
      new Date((await prisma.now()).getTime() - 60000),
      randomBytes(32),
    );
    assessmentId = assessment.id;
    owner = (await prisma.student.findUniqueOrThrow({ where: { externalId: 'ATTEMPT-OWNER' } })).id;
    await signIn('ATTEMPT-OWNER');
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await socket?.stop();
    await db?.close();
  }, 30000);
  it('rejects an unauthenticated attempt read and start', async () => {
    const previous = cookie;
    cookie = '';
    expect((await request(`/attempts/${randomUUID()}`)).status).toBe(401);
    expect(
      (await request(`/assessments/${assessmentId}/start`, 'POST', {}, randomUUID())).status,
    ).toBe(401);
    cookie = previous;
  });
  it('deduplicates concurrent starts even with different keys and pins the exact question mix', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      request(`/assessments/${assessmentId}/start`, 'POST', {}, key),
      request(`/assessments/${assessmentId}/start`, 'POST', {}, randomUUID()),
      request(`/student/assessments/${assessmentId}/attempts`, 'POST', {}, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const rows = await Promise.all(responses.map((r) => body<Attempt>(r)));
    attempt = rows[0]!.data;
    expect(new Set(rows.map((r) => r.data.id)).size).toBe(1);
    expect(attempt.questions).toHaveLength(4);
    expect(attempt.questions.filter((q) => q.difficulty === 'EASY')).toHaveLength(2);
    expect(attempt.questions.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(1);
    expect(attempt.questions.filter((q) => q.difficulty === 'HARD')).toHaveLength(1);
    expect(Date.parse(attempt.expiresAt) - Date.parse(attempt.startedAt)).toBe(10800000);
    expect(await prisma.assessmentAttempt.count({ where: { studentId: owner } })).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: attempt.id, eventType: 'attempt.expiry' },
      }),
    ).toBe(1);
  });
  it('restores the same assignments and timer on refresh; public question projection excludes hidden cases', async () => {
    const restored = (await body<Attempt>(await request(`/attempts/${attempt.id}`))).data;
    expect(restored.questions).toEqual(attempt.questions);
    expect(restored.expiresAt).toBe(attempt.expiresAt);
    const response = await request(`/attempts/${attempt.id}/questions/${attempt.questions[0]!.id}`);
    expect(response.status).toBe(200);
    const publicQuestion = await body<components['schemas']['QuestionPublic']>(response);
    expect(publicQuestion.data.publicTestCases).toHaveLength(1);
    expect(typeof publicQuestion.data.maxScore).toBe('string');
    await expect(
      prisma.questionVersion.update({
        where: { id: publicQuestion.data.questionVersionId },
        data: { publicExamples: [] },
      }),
    ).rejects.toThrow('Published question versions are immutable');
    expect(publicQuestion.data.templates.map((t) => t.language).sort()).toEqual([
      'CPP',
      'JAVA',
      'PYTHON',
    ]);
    expect(JSON.stringify(publicQuestion)).not.toMatch(
      /Ciphertext|encryptionKey|integrityHash|hiddenTest|passwordHash/,
    );
    expect((await request(`/attempts/${attempt.id}/questions/${randomUUID()}`)).status).toBe(404);
  });
  it('preserves per-language drafts, detects stale writes, and handles a lost-response retry', async () => {
    const q = attempt.questions[0]!.id;
    const save = (language: string, code: string, revision: number) =>
      request(`/attempts/${attempt.id}/drafts/${q}/${language}`, 'PUT', {
        sourceCode: code,
        expectedRevision: revision,
      });
    const first = await save('PYTHON', 'print(42)\n', 0);
    expect(first.status).toBe(200);
    expect((await body<components['schemas']['DraftResponse']>(first)).data.revision).toBe(1);
    const replay = await save('PYTHON', 'print(42)\n', 0);
    expect(replay.status).toBe(200);
    expect((await body<components['schemas']['DraftResponse']>(replay)).data.revision).toBe(1);
    expect((await save('PYTHON', 'print(99)', 0)).status).toBe(409);
    expect((await save('JAVA', 'class Main {}', 0)).status).toBe(200);
    expect((await save('CPP', '#include <iostream>', 0)).status).toBe(200);
    const drafts = (
      await body<{ items: components['schemas']['DraftResponse'][] }>(
        await request(`/attempts/${attempt.id}/drafts`),
      )
    ).data.items;
    expect(drafts.map((d) => d.language).sort()).toEqual(['CPP', 'JAVA', 'PYTHON']);
    expect(drafts.find((d) => d.language === 'PYTHON')?.sourceCode).toBe('print(42)\n');
  });
  it('serializes competing draft saves and rejects foreign questions, unknown languages and oversized UTF-8 source', async () => {
    const q = attempt.questions[1]!.id,
      path = `/attempts/${attempt.id}/drafts/${q}/PYTHON`;
    const responses = await Promise.all([
      request(path, 'PUT', { sourceCode: 'first', expectedRevision: 0 }),
      request(path, 'PUT', { sourceCode: 'second', expectedRevision: 0 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await request(`/attempts/${attempt.id}/drafts/${randomUUID()}/PYTHON`, 'PUT', {
          sourceCode: '',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/attempts/${attempt.id}/drafts/${q}/JAVASCRIPT`, 'PUT', {
          sourceCode: '',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/attempts/${attempt.id}/drafts/${q}/JAVA`, 'PUT', {
          sourceCode: 'é'.repeat(32769),
          expectedRevision: 0,
        })
      ).status,
    ).toBe(400);
  });
  it('persists active language under a state version check without overwriting other language drafts', async () => {
    const q = attempt.questions[0]!.id;
    const selected = await request(`/attempts/${attempt.id}/questions/${q}/language`, 'PATCH', {
      language: 'JAVA',
      expectedStateVersion: 1,
    });
    expect(selected.status).toBe(200);
    attempt = (await body<Attempt>(selected)).data;
    expect(attempt.questions[0]!.selectedLanguage).toBe('JAVA');
    expect(attempt.stateVersion).toBe(2);
    expect(
      (
        await request(`/attempts/${attempt.id}/questions/${q}/language`, 'PATCH', {
          language: 'CPP',
          expectedStateVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(attempt.drafts.find((d) => d.language === 'PYTHON')?.sourceCode).toBe('print(42)\n');
  });
  it('denies another student access to attempts, drafts, question content and history', async () => {
    await signIn('ATTEMPT-OTHER');
    for (const path of [
      `/attempts/${attempt.id}`,
      `/attempts/${attempt.id}/drafts`,
      `/attempts/${attempt.id}/questions/${attempt.questions[0]!.id}`,
      `/attempts/${attempt.id}/history`,
    ])
      expect((await request(path)).status).toBe(404);
    expect(
      (
        await request(`/attempts/${attempt.id}/drafts/${attempt.questions[0]!.id}/PYTHON`, 'PUT', {
          sourceCode: 'stolen',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(404);
    await signIn('ATTEMPT-OWNER');
  });
  it('finalizes once, snapshots selected drafts or pinned starters, and leaves grading pending', async () => {
    const key = randomUUID(),
      input = { expectedStateVersion: attempt.stateVersion };
    const responses = await Promise.all([
      request(`/attempts/${attempt.id}/finalization`, 'POST', input, key),
      request(`/attempts/${attempt.id}/finalization`, 'POST', input, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    expect((await body<Attempt>(responses[0]!)).data.status).toBe('FINALIZING');
    const snapshots = await prisma.submission.findMany({ where: { attemptId: attempt.id } });
    expect(snapshots).toHaveLength(4);
    expect(
      snapshots.find((s) => s.attemptQuestionId === attempt.questions[0]!.id)?.sourceCode,
    ).toBe('class Main {}');
    expect(snapshots.every((s) => s.status === 'PENDING' && s.purpose === 'FINAL')).toBe(true);
    expect(await prisma.submissionResult.count()).toBe(0);
    expect(await prisma.assessmentResult.count()).toBe(0);
    expect(
      (
        await request(`/attempts/${attempt.id}/drafts/${attempt.questions[0]!.id}/JAVA`, 'PUT', {
          sourceCode: 'changed',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(410);
    expect(
      (
        await request(
          `/attempts/${attempt.id}/finalization`,
          'POST',
          { expectedStateVersion: 99 },
          key,
        )
      ).status,
    ).toBe(409);
    const history = await body<{ items: unknown[] }>(
      await request(`/attempts/${attempt.id}/history`),
    );
    expect(history.data.items).toHaveLength(4);
  });
  async function expiredFixture(identifier: string, expired: boolean) {
    const student = await prisma.student.findUniqueOrThrow({ where: { externalId: identifier } });
    const assignment = await prisma.assessmentAssignment.findUniqueOrThrow({
      where: { assessmentId_studentId: { assessmentId, studentId: student.id } },
    });
    const pool = await prisma.assessmentPoolQuestion.findMany({ where: { assessmentId } });
    const now = await prisma.now();
    const startedAt = new Date(now.getTime() - (expired ? 10801000 : 1000));
    return prisma.$transaction(async (tx) => {
      const row = await tx.assessmentAttempt.create({
        data: {
          assignmentId: assignment.id,
          studentId: student.id,
          assessmentId,
          startedAt,
          expiresAt: new Date(startedAt.getTime() + 10800000),
          ruleSnapshot: attempt.rules,
          allocationManifestHash: 'a'.repeat(64),
        },
      });
      await tx.attemptQuestion.createMany({
        data: pool.map((p, i) => ({
          attemptId: row.id,
          assessmentId,
          questionId: p.questionId,
          questionVersionId: p.questionVersionId,
          position: i + 1,
        })),
      });
      return tx.assessmentAttempt.findUniqueOrThrow({
        where: { id: row.id },
        include: { questions: true },
      });
    });
  }
  it('rejects a delayed save at expiry while committing backend finalization', async () => {
    const expired = await expiredFixture('ATTEMPT-EXPIRED', true);
    await signIn('ATTEMPT-EXPIRED');
    expect(
      (
        await request(`/attempts/${expired.id}/drafts/${expired.questions[0]!.id}/PYTHON`, 'PUT', {
          sourceCode: 'too late',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(410);
    expect(
      (await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: expired.id } })).status,
    ).toBe('FINALIZING');
    expect(await prisma.codeDraft.count({ where: { attemptId: expired.id } })).toBe(0);
    expect(await prisma.submission.count({ where: { attemptId: expired.id } })).toBe(4);
  });
  it('reconciles expiry without a browser and remains idempotent', async () => {
    const expired = await expiredFixture('ATTEMPT-RECONCILE', true);
    await app.get(AttemptsService).reconcile();
    await app.get(AttemptsService).reconcile();
    expect(
      (await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: expired.id } }))
        .finalizationReason,
    ).toBe('EXPIRED');
    expect(await prisma.submission.count({ where: { attemptId: expired.id } })).toBe(4);
  });
  it('freezes revoked assignments and rejects further changes', async () => {
    const row = await expiredFixture('ATTEMPT-VOID', false);
    await signIn('ATTEMPT-VOID');
    await prisma.assessmentAssignment.update({
      where: { id: row.assignmentId },
      data: { status: 'REVOKED' },
    });
    expect(
      (
        await request(`/attempts/${row.id}/drafts/${row.questions[0]!.id}/PYTHON`, 'PUT', {
          sourceCode: 'invalid',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(410);
    expect(
      (await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('VOIDED');
  });
});
