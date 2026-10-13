import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { validateEnvironment } from '../../src/config/environment';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AttemptsModule } from '../../src/modules/attempts/attempts.module';
import { SubmissionsModule } from '../../src/modules/submissions/submissions.module';
import { ResultsModule } from '../../src/modules/results/results.module';
import { AdminModule } from '../../src/modules/admin/admin.module';
import { AdminPrismaService } from '../../src/database/admin-prisma.service';
import { QuestionAuthoringSecurity } from '../../src/modules/admin/question-management.service';
import { AssessmentsModule } from '../../src/modules/assessments/assessments.module';
import { StudentsModule } from '../../src/modules/students/students.module';
import { SessionGuard } from '../../src/common/guards/session.guard';
import { ApiExceptionFilter, ApiResponseInterceptor } from '../../src/common/http/api-response';
import { seedJudgeAssessment } from '../../prisma/judge-seed';
import { TestcaseKeyring } from '../../src/workers/judge/testcase-crypto';
import { ToolchainCatalog } from '../../src/workers/sandbox/toolchain-catalog';
import type { components } from '../../../contracts/generated/api';
export type Attempt = components['schemas']['AttemptResponse'];
export type Submission = components['schemas']['SubmissionResponse'];
export type Envelope<T> = { data: T; meta: { serverNow: string } };
export const envelope = async <T>(response: Response) => (await response.json()) as Envelope<T>;
export const contractCatalog = () =>
  new ToolchainCatalog({
    toolchains: [
      {
        id: 'test-python',
        language: 'PYTHON',
        version: '3.13.1',
        image: 'sha256:' + 'a'.repeat(64),
      },
      { id: 'test-java', language: 'JAVA', version: '21.0.1', image: 'sha256:' + 'b'.repeat(64) },
      { id: 'test-cpp', language: 'CPP', version: '14.1.0', image: 'sha256:' + 'c'.repeat(64) },
    ],
  });
export const testKeyring = () =>
  new TestcaseKeyring({
    keys: ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'].map((dataClass) => ({
      id: `test-${dataClass}`,
      dataClass,
      base64: randomBytes(32).toString('base64'),
    })),
  });
export async function step4Context(
  catalog = contractCatalog(),
  keys = testKeyring(),
  options: { admin?: boolean } = {},
) {
  const database = await PGlite.create();
  for (const name of [
    '20261011000000_new_install_only',
    '20261011010000_student_dashboard',
    '20261012000000_public_question_examples',
    '20261012010000_execution_lifecycle',
    '20261013000000_admin_management',
  ])
    await database.exec(
      readFileSync(resolve(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8'),
    );
  const socket = new PGLiteSocketServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 1,
  });
  await socket.start();
  const environment = validateEnvironment({
    ...parse(readFileSync(resolve(__dirname, '../../.env.example'))),
    NODE_ENV: 'test',
    DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
    DATABASE_POOL_MAX: '1',
    EXECUTION_ENABLED: 'true',
    CSRF_SIGNING_KEY: randomBytes(32).toString('hex'),
    ARGON2_MEMORY_KIB: '19456',
    ARGON2_TIME_COST: '2',
    LOGIN_ACCOUNT_LIMIT: '100',
    ...(options.admin ? { ADMIN_ORIGINS: 'http://localhost:3001' } : {}),
  });
  const builder = Test.createTestingModule({
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
      SubmissionsModule,
      ResultsModule,
      ...(options.admin ? [AdminModule, AssessmentsModule, StudentsModule] : []),
    ],
    providers: [
      { provide: APP_GUARD, useClass: SessionGuard },
      { provide: APP_FILTER, useClass: ApiExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    ],
  });
  if (options.admin) {
    // Test adapter only: share PGlite's single wire connection. Runtime applications
    // retain independent administration and student database identities/pools.
    builder.overrideProvider(AdminPrismaService).useFactory({
      factory: (db: PrismaService) => {
        Object.defineProperties(db, {
          configured: { value: true },
          assertConfigured: { value: () => undefined },
        });
        return db;
      },
      inject: [PrismaService],
    });
    builder.overrideProvider(QuestionAuthoringSecurity).useValue({
      available: () => true,
      keys: () => keys,
      catalog: () => catalog,
    });
  }
  const module = await builder.compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService),
    base = `${await app.getUrl()}/api/v1`;
  const passwordHash = await argon2.hash('Step4-test-password!', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  for (const externalId of [
    'STEP4-OWNER',
    'STEP4-OTHER',
    'STEP4-EXPIRED',
    'STEP4-FAILURE',
    'STEP4-LATEST',
  ])
    await prisma.user.create({
      data: {
        email: `${externalId}@test.invalid`,
        role: 'STUDENT',
        passwordHash,
        student: { create: { externalId, displayName: externalId } },
      },
    });
  const toolchains = Object.fromEntries(
    ['PYTHON', 'JAVA', 'CPP'].map((language) => [
      language,
      [...catalog.entries].reverse().find((e) => e.language === language)!.id,
    ]),
  ) as Record<'PYTHON' | 'JAVA' | 'CPP', string>;
  const assessment = await seedJudgeAssessment(
    prisma,
    new Date((await prisma.now()).getTime() - 60000),
    keys,
    toolchains,
  );
  await prisma.judgeWorkerHeartbeat.create({
    data: {
      id: 'b2400000-0000-4000-8000-000000000099',
      toolchainIds: catalog.entries.map((e) => e.id),
      lastSeenAt: await prisma.now(),
    },
  });
  let cookie = '',
    csrf = '';
  const request = (path: string, method = 'GET', body?: unknown, key?: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost:3000',
        ...(body !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const signIn = async (identifier: string) => {
    cookie = '';
    const pre = await request('/auth/csrf');
    cookie = pre.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    csrf = (await envelope<{ csrfToken: string }>(pre)).data.csrfToken;
    const login = await request('/auth/login', 'POST', {
      identifier,
      password: 'Step4-test-password!',
    });
    if (login.status !== 200) throw new Error('Test authentication failed');
    cookie = login.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
  };
  const start = async (identifier = 'STEP4-OWNER') => {
    await signIn(identifier);
    const response = await request(
      `/assessments/${assessment.id}/start`,
      'POST',
      {},
      randomBytes(16).toString('hex'),
    );
    if (response.status !== 200) throw new Error(`Test start failed (${response.status})`);
    return (await envelope<Attempt>(response)).data;
  };
  return {
    app,
    database,
    socket,
    prisma,
    request,
    signIn,
    start,
    assessment,
    keys,
    catalog,
    close: async () => {
      await app.close();
      await socket.stop();
      await database.close();
    },
  };
}
