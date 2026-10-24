import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client';
import { TestcaseKeyring } from '../src/workers/judge/testcase-crypto';
import { seedJudgeAssessment } from '../prisma/judge-seed';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';

describe('Local practice CLI persistence (PGlite; no judge or native infrastructure)', () => {
  it('reuses fixtures and schedules, assigns existing students, and rejects lost keys', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'assessment-local-seed-'));
    const keyringFile = join(temporary, 'keys.json');
    const material = {
      keys: ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'].map((dataClass) => ({
        id: `local-test-${dataClass.toLowerCase()}`,
        dataClass,
        base64: randomBytes(32).toString('base64'),
      })),
    };
    writeFileSync(keyringFile, JSON.stringify(material), { mode: 0o600 });
    const database = await PGlite.create();
    const migrations = resolve(__dirname, '../prisma/migrations');
    for (const name of readdirSync(migrations)
      .filter((name) => /^\d{14}_/.test(name))
      .sort())
      await database.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
    const socket = new PGLiteSocketServer({
      db: database,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 2,
    });
    await socket.start();
    const url = `postgresql://postgres@${socket.getServerConn()}/assessment_local_test`;
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
    const cli = () =>
      new Promise<number | null>((done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'prisma/seed-local.ts'],
          {
            cwd: resolve(__dirname, '..'),
            env: {
              ...process.env,
              NODE_ENV: 'development',
              DATABASE_URL: url,
              TESTCASE_KEYRING_FILE: keyringFile,
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Local seed timed out'));
        }, 30000);
        child.stdout.resume();
        child.stderr.resume();
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          done(code);
        });
      });
    try {
      const student = await db.user.create({
        data: {
          email: 'local-seed@example.test',
          role: 'STUDENT',
          passwordHash: 'test-not-a-login',
          student: { create: { externalId: 'LOCAL-SEED-TEST', displayName: 'Local Seed Test' } },
        },
        include: { student: true },
      });
      // Identifiers for persistence testing only. No execution is enabled or reported.
      await seedJudgeAssessment(db, new Date(Date.now() - 60000), new TestcaseKeyring(material), {
        PYTHON: 'test-python',
        JAVA: 'test-java',
        CPP: 'test-cpp',
      });
      expect(await cli()).toBe(0);
      const practice = await db.assessment.findFirstOrThrow({
        where: { title: { startsWith: 'Local practice - ' } },
        include: { pool: true, assignments: true },
      });
      expect(practice.pool).toHaveLength(8);
      expect(practice.assignments.some((row) => row.studentId === student.student!.id)).toBe(true);
      const serverNow = (await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
        .now;
      expect(practice.opensAt!.getTime()).toBeLessThan(serverNow.getTime());
      expect(practice.latestStartAt!.getTime()).toBeGreaterThan(serverNow.getTime() + 3600000);
      const ciphertext = await db.testCase.findFirstOrThrow();
      expect(await cli()).toBe(0);
      expect(await db.assessment.count()).toBe(2);
      const persisted = await db.assessment.findUniqueOrThrow({ where: { id: practice.id } });
      expect(persisted.opensAt).toEqual(practice.opensAt);
      expect(
        (await db.testCase.findUniqueOrThrow({ where: { id: ciphertext.id } })).inputCiphertext,
      ).toEqual(ciphertext.inputCiphertext);
      writeFileSync(
        keyringFile,
        JSON.stringify({
          keys: material.keys.map((key) => ({
            ...key,
            base64: randomBytes(32).toString('base64'),
          })),
        }),
      );
      expect(await cli()).not.toBe(0);
      expect(await db.assessment.count()).toBe(2);
    } finally {
      await db.$disconnect();
      await socket.stop();
      await database.close();
      expect(dirname(resolve(temporary))).toBe(resolve(tmpdir()));
      expect(basename(temporary).startsWith('assessment-local-seed-')).toBe(true);
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 120000);
});
