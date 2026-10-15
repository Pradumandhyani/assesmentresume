import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as argon2 from 'argon2';

describe('Actual development credential and dashboard seed CLI persistence (PGlite, no judge)', () => {
  it('runs the documented CLIs and preserves identities, credentials, versions and schedules on rerun', async () => {
    const database = await PGlite.create();
    const directory = resolve(__dirname, '../prisma/migrations');
    for (const name of readdirSync(directory)
      .filter((n) => /^\d{14}_/.test(n))
      .sort())
      await database.exec(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
    const socket = new PGLiteSocketServer({
      db: database,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 2,
    });
    await socket.start();
    const url = `postgresql://postgres@${socket.getServerConn()}/assessment_cli_test`;
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
    const studentPassword = randomBytes(24).toString('base64url'),
      adminPassword = randomBytes(24).toString('base64url');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: url,
      DEV_STUDENT_ID: 'CLI-STUDENT',
      DEV_STUDENT_NAME: 'CLI Student',
      DEV_STUDENT_PASSWORD: studentPassword,
      DEV_ADMIN_EMAIL: 'cli-admin@example.test',
      DEV_ADMIN_NAME: 'CLI Administrator',
      DEV_ADMIN_PASSWORD: adminPassword,
    };
    const cli = async (script: string, extra: Record<string, string> = {}) => {
      const result = await new Promise<{ code: number | null; output: string }>(
        (resolveResult, reject) => {
          const child = spawn(
            process.execPath,
            [
              resolve(__dirname, '../node_modules/tsx/dist/cli.mjs'),
              resolve(__dirname, '../prisma', script),
            ],
            {
              cwd: resolve(__dirname, '..'),
              env: { ...env, ...extra },
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let output = '';
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Seed CLI timed out'));
          }, 30000);
          child.stdout.on('data', (data: Buffer) => {
            output += data.toString();
          });
          child.stderr.on('data', (data: Buffer) => {
            output += data.toString();
          });
          child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            resolveResult({ code, output });
          });
        },
      );
      expect(result.output).not.toContain(studentPassword);
      expect(result.output).not.toContain(adminPassword);
      expect(result.code).toBe(0);
    };
    try {
      await cli('provision-student.ts');
      await cli('provision-admin.ts');
      const student = await prisma.student.findUniqueOrThrow({
        where: { externalId: 'CLI-STUDENT' },
        include: { user: true },
      });
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: 'cli-admin@example.test' },
        include: { admin: true },
      });
      expect(admin.role).toBe('ADMIN');
      expect(admin.admin?.displayName).toBe('CLI Administrator');
      expect(await argon2.verify(student.user.passwordHash, studentPassword)).toBe(true);
      expect(await argon2.verify(admin.passwordHash, adminPassword)).toBe(true);
      await cli('provision-student.ts', {
        DEV_STUDENT_PASSWORD: randomBytes(24).toString('base64url'),
        DEV_STUDENT_NAME: 'Must not replace',
      });
      await cli('provision-admin.ts', {
        DEV_ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
        DEV_ADMIN_NAME: 'Must not replace',
      });
      expect(
        (
          await prisma.student.findUniqueOrThrow({
            where: { id: student.id },
            include: { user: true },
          })
        ).user.passwordHash,
      ).toBe(student.user.passwordHash);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(
        admin.passwordHash,
      );
      const start = new Date(Date.now() + 3600000).toISOString();
      await cli('seed.ts', { DEV_ASSESSMENT_START_AT: start });
      const assessment = await prisma.assessment.findFirstOrThrow({
        include: { rule: true, pool: true, assignments: true },
      });
      expect(assessment.opensAt?.toISOString()).toBe(start);
      expect(assessment.rule?.durationSeconds).toBe(10800);
      expect(assessment.pool).toHaveLength(4);
      expect(assessment.assignments.some((a) => a.studentId === student.id)).toBe(true);
      await cli('seed.ts', {
        DEV_ASSESSMENT_START_AT: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(await prisma.assessment.count()).toBe(1);
      expect(await prisma.questionVersion.count()).toBe(4);
      expect(
        (
          await prisma.assessment.findUniqueOrThrow({ where: { id: assessment.id } })
        ).opensAt?.toISOString(),
      ).toBe(start);
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await database.close();
    }
  }, 120000);
});
