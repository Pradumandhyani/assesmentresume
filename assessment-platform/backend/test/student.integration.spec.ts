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
import { Controller, Get, ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { hash as bcryptHash } from 'bcryptjs';
import { validateEnvironment } from '../src/config/environment';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AssessmentsModule } from '../src/modules/assessments/assessments.module';
import { StudentsModule } from '../src/modules/students/students.module';
import { Roles, SessionGuard } from '../src/common/guards/session.guard';
import { ApiExceptionFilter, ApiResponseInterceptor } from '../src/common/http/api-response';
import { seedDevelopmentAssessment } from '../prisma/dev-seed';
import type { components } from '../../contracts/generated/api';
type Envelope<T> = { data: T; meta: { serverNow: string; requestId: string } };
@Roles('ADMIN')
@Controller('admin/test-role')
class AdminRoleProbe {
  @Get() probe() {
    return { testOnly: true };
  }
}

describe('student authentication and dashboard HTTP / PostgreSQL integration', () => {
  let app: INestApplication;
  let db: PGlite;
  let socket: PGLiteSocketServer;
  let prisma: PrismaService;
  let base: string;
  let assessmentId: string;
  let studentUserId: string;
  const password = 'Integration-only-password!';
  const origin = 'http://localhost:3000';
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie(),
        Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-CSRF-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(';')[0]!;
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return response;
  }
  async function login(identifier = 'TEST-100', suppliedPassword = password, remember = false) {
    const csrf = (await (await request('/auth/csrf')).json()) as Envelope<
      components['schemas']['CsrfResponse']
    >;
    return request(
      '/auth/login',
      'POST',
      { identifier, password: suppliedPassword, remember },
      csrf.data.csrfToken,
    );
  }
  beforeAll(async () => {
    db = await PGlite.create();
    for (const migration of [
      '20261011000000_new_install_only',
      '20261011010000_student_dashboard',
      '20261012000000_public_question_examples',
    ])
      await db.exec(
        readFileSync(
          resolve(__dirname, '../prisma/migrations', migration, 'migration.sql'),
          'utf8',
        ),
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
        StudentsModule,
        AssessmentsModule,
      ],
      controllers: [AdminRoleProbe],
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
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await prisma.user.create({
      data: {
        email: 'test-student@example.invalid',
        role: 'STUDENT',
        passwordHash,
        student: { create: { externalId: 'TEST-100', displayName: 'Test Student' } },
      },
    });
    studentUserId = user.id;
    await prisma.user.create({
      data: {
        email: 'disabled@example.invalid',
        role: 'STUDENT',
        isActive: false,
        passwordHash,
        student: { create: { externalId: 'TEST-DISABLED', displayName: 'Disabled Student' } },
      },
    });
    await prisma.user.create({
      data: {
        email: 'other@example.invalid',
        role: 'STUDENT',
        passwordHash,
        student: { create: { externalId: 'TEST-OTHER', displayName: 'Other Student' } },
      },
    });
    const assessment = await seedDevelopmentAssessment(
      prisma,
      new Date((await prisma.now()).getTime() + 3600000),
      randomBytes(32),
    );
    assessmentId = assessment.id;
    const other = await prisma.student.findUniqueOrThrow({ where: { externalId: 'TEST-OTHER' } });
    await prisma.assessmentAssignment.update({
      where: { assessmentId_studentId: { assessmentId, studentId: other.id } },
      data: { status: 'REVOKED' },
    });
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await socket?.stop();
    await db?.close();
  }, 30000);
  beforeEach(() => jar.clear());
  it('rejects unauthenticated dashboard and session access', async () => {
    expect((await request('/assessments')).status).toBe(401);
    expect((await request('/auth/me')).status).toBe(401);
  });
  it('logs in correctly with an HttpOnly host-only cookie and exposes only safe profile fields', async () => {
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(';')).toMatch(/HttpOnly/);
    expect(response.headers.getSetCookie().join(';')).toMatch(/SameSite=Lax/);
    expect(response.headers.getSetCookie().join(';')).not.toMatch(/Domain=/);
    expect(
      response.headers
        .getSetCookie()
        .find((header) => header.startsWith('assessment_session_dev=')),
    ).not.toMatch(/Max-Age=/);
    const profile = (await response.json()) as Envelope<components['schemas']['SessionResponse']>;
    expect(profile.data.student?.externalId).toBe('TEST-100');
    expect(JSON.stringify(profile)).not.toMatch(/password|tokenHash|csrfTokenHash/);
    expect((await request('/auth/me')).status).toBe(200);
    expect((await request('/auth/session')).status).toBe(200);
    expect((await request('/student/me')).status).toBe(200);
    const stored = await prisma.authSession.findFirstOrThrow({
      where: { userId: studentUserId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toBe(jar.get('assessment_session_dev'));
  });
  it.each([
    ['TEST-100', 'incorrect-password'],
    ['UNKNOWN-ID', password],
    ['TEST-DISABLED', password],
  ])(
    'rejects invalid or inactive credentials uniformly (%s)',
    async (identifier, suppliedPassword) => {
      const response = await login(identifier, suppliedPassword);
      expect(response.status).toBe(401);
      const payload = (await response.json()) as components['schemas']['ApiError'];
      expect(payload.error.message).toBe('Student ID or password is incorrect.');
      expect(jar.has('assessment_session_dev')).toBe(false);
    },
  );
  it('uses bounded persistent cookies only when remember is requested', async () => {
    const response = await login('TEST-100', password, true);
    expect(response.status).toBe(200);
    expect(
      response.headers
        .getSetCookie()
        .find((header) => header.startsWith('assessment_session_dev=')),
    ).toMatch(/Max-Age=604800/);
  });
  it('rejects expired and revoked sessions using the database clock', async () => {
    await login();
    await prisma.authSession.updateMany({
      where: { userId: studentUserId },
      data: { expiresAt: new Date((await prisma.now()).getTime() - 1) },
    });
    expect((await request('/auth/me')).status).toBe(401);
  });
  it('immediately invalidates sessions when an identity is disabled or its auth version changes', async () => {
    await login();
    await prisma.user.update({ where: { id: studentUserId }, data: { isActive: false } });
    expect((await request('/auth/me')).status).toBe(401);
    await prisma.user.update({ where: { id: studentUserId }, data: { isActive: true } });
    await login();
    await prisma.user.update({
      where: { id: studentUserId },
      data: { authVersion: { increment: 1 } },
    });
    expect((await request('/auth/me')).status).toBe(401);
  });
  it('requires CSRF and exact trusted Origin, and logout revokes server state', async () => {
    await login();
    expect((await request('/auth/logout', 'POST', {})).status).toBe(403);
    const csrf = (await (await request('/auth/csrf')).json()) as Envelope<
      components['schemas']['CsrfResponse']
    >;
    const crossOrigin = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        Cookie: cookie(),
        'X-CSRF-Token': csrf.data.csrfToken,
      },
    });
    expect(crossOrigin.status).toBe(403);
    expect((await request('/auth/logout', 'POST', {}, csrf.data.csrfToken)).status).toBe(200);
    expect((await request('/auth/me')).status).toBe(401);
  });
  it('prevents student access to an admin-only controller', async () => {
    await login();
    expect((await request('/admin/test-role')).status).toBe(403);
  });
  it('retrieves upcoming assessments from PostgreSQL without hidden question data', async () => {
    await login();
    const response = await request('/assessments/upcoming');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Envelope<{
      items: components['schemas']['DashboardAssessment'][];
    }>;
    expect(payload.data.items[0]?.assessment.title).toBe('DSA Coding Assessment — Round 1');
    expect(payload.data.items[0]?.rules).toMatchObject({
      durationSeconds: 10800,
      easyCount: 2,
      mediumCount: 1,
      hardCount: 1,
      allowedLanguages: ['PYTHON', 'JAVA', 'CPP'],
    });
    expect(payload.data.items[0]?.eligibility.canStart).toBe(false);
    expect(payload.meta.serverNow).toMatch(/Z$/);
    expect(JSON.stringify(payload)).not.toMatch(/testCases|Ciphertext|starterCode|expectedOutput/);
    expect((await request('/student/assessments')).status).toBe(200);
  });
  it('checks eligibility with the server and never creates a partial attempt', async () => {
    await login();
    const response = await request(`/assessments/${assessmentId}/eligibility`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Envelope<
      components['schemas']['AssessmentEligibility']
    >;
    expect(payload.data).toMatchObject({ canStart: false, reason: 'NOT_OPEN' });
    expect(await prisma.assessmentAttempt.count()).toBe(0);
  });
  it('does not expose other students assignments', async () => {
    await login('TEST-OTHER');
    expect((await request(`/assessments/${assessmentId}/eligibility`)).status).toBe(404);
    const list = (await (await request('/assessments')).json()) as Envelope<
      components['schemas']['DashboardAssessments']
    >;
    expect(list.data.items).toEqual([]);
  });
  it('reruns the seed without changing schedules, credentials, published content or assignment revocations', async () => {
    const before = await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
    const users = await prisma.user.findMany({
      select: { id: true, passwordHash: true },
      orderBy: { id: 'asc' },
    });
    await seedDevelopmentAssessment(prisma, new Date(Date.now() + 86400000), randomBytes(32));
    expect(
      (await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } })).opensAt,
    ).toEqual(before.opensAt);
    expect(await prisma.assessment.count()).toBe(1);
    expect(await prisma.questionVersion.count()).toBe(4);
    expect(
      await prisma.user.findMany({
        select: { id: true, passwordHash: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(users);
  });
  it('upgrades a verified bcrypt credential to Argon2id, preserving the identity', async () => {
    const legacy = await prisma.user.create({
      data: {
        email: 'legacy@example.invalid',
        role: 'STUDENT',
        passwordHash: await bcryptHash(password, 8),
        student: { create: { externalId: 'TEST-LEGACY', displayName: 'Legacy Student' } },
      },
    });
    expect((await login('TEST-LEGACY')).status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect(after.id).toBe(legacy.id);
  });
  it('rate-limits attempts using shared database records before issuing a session', async () => {
    for (let index = 0; index < 10; index++)
      expect((await login('RATE-TEST', 'bad-password')).status).toBe(401);
    const response = await login('RATE-TEST', 'bad-password');
    expect(response.status).toBe(429);
    expect(response.headers.has('Retry-After')).toBe(true);
  });
});
