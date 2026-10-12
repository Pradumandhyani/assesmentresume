import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedDevelopmentAssessment } from '../../backend/prisma/dev-seed.ts';
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const { PrismaClient } = backendRequire('./dist/database/generated/client.js');
const { PrismaPg } = backendRequire('@prisma/adapter-pg');
const { parse } = backendRequire('dotenv');
const argon2 = backendRequire('argon2');
const root = fileURLToPath(new URL('../../', import.meta.url));
const db = await PGlite.create();
for (const migration of [
  '20261011000000_new_install_only',
  '20261011010000_student_dashboard',
  '20261012000000_public_question_examples',
])
  await db.exec(
    readFileSync(
      new URL(`../../backend/prisma/migrations/${migration}/migration.sql`, import.meta.url),
      'utf8',
    ),
  );
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
await socket.start();
const databaseUrl = `postgresql://postgres@${socket.getServerConn()}/postgres`;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
});
const passwordHash = await argon2.hash('E2E-only-password!', {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
await prisma.user.create({
  data: {
    email: 'browser-test@example.invalid',
    role: 'STUDENT',
    passwordHash,
    student: { create: { externalId: 'E2E-100', displayName: 'Avery Test' } },
  },
});
const now = (await prisma.$queryRaw`SELECT clock_timestamp() AS now`)[0].now;
await seedDevelopmentAssessment(prisma, new Date(now.getTime() + 1800000), randomBytes(32));
// Independent open fixture; preserve the Round 1 dashboard schedule.
const pool = await prisma.assessmentPoolQuestion.findMany();
const owner = await prisma.admin.findFirstOrThrow();
const coding = await prisma.assessment.create({
  data: {
    title: 'Step 3 Coding Workspace',
    description: 'Browser integration fixture',
    createdById: owner.id,
    rule: { create: {} },
    pool: {
      create: pool.map((p) => ({
        questionVersionId: p.questionVersionId,
        questionId: p.questionId,
      })),
    },
  },
});
await prisma.assessment.update({
  where: { id: coding.id },
  data: {
    status: 'SCHEDULED',
    opensAt: new Date(now.getTime() - 60000),
    latestStartAt: new Date(now.getTime() + 1800000),
    closesAt: new Date(now.getTime() + 12600000),
    resultsReleaseAt: new Date(now.getTime() + 16200000),
  },
});
for (const externalId of ['E2E-200', 'E2E-201'])
  await prisma.user.create({
    data: {
      email: `${externalId}@test.invalid`,
      role: 'STUDENT',
      passwordHash,
      student: {
        create: {
          externalId,
          displayName: 'Coding Student',
          assignments: { create: { assessmentId: coding.id } },
        },
      },
    },
  });
await prisma.$disconnect();
const environment = {
  ...process.env,
  ...parse(readFileSync(new URL('../../backend/.env.example', import.meta.url))),
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DATABASE_POOL_MAX: '1',
  CSRF_SIGNING_KEY: randomBytes(32).toString('hex'),
  ARGON2_MEMORY_KIB: '19456',
  ARGON2_TIME_COST: '2',
  LOG_LEVEL: 'error',
};
const children = [
  spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}backend`,
    env: environment,
    windowsHide: true,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['.next/standalone/frontend/server.js'], {
    cwd: `${root}frontend`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '3000',
      HOSTNAME: '127.0.0.1',
      BACKEND_API_URL: 'http://127.0.0.1:4000',
    },
    windowsHide: true,
    stdio: 'inherit',
  }),
];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  await socket.stop();
  await db.close();
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void stop().then(() => process.exit());
  });
for (const child of children) {
  child.on('error', () => {
    void stop().then(() => process.exit(1));
  });
  child.on('exit', () => {
    if (!stopping) void stop().then(() => process.exit(1));
  });
}
