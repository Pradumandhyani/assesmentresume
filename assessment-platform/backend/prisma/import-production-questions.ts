import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client';
import { TestcaseKeyring } from '../src/workers/judge/testcase-crypto';
import { prepareQuestionBankDrafts } from './question-bank-import';
import { importProductionQuestionDrafts } from './production-question-bank';

let phase = 'validation';
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported');
  const directory = resolve(__dirname, '../../.local/production');
  const profile = JSON.parse(readFileSync(resolve(directory, 'deployment.json'), 'utf8'));
  const secrets = JSON.parse(readFileSync(resolve(directory, 'database-secrets.json'), 'utf8'));
  const database = profile.railway?.database?.name;
  const proxy = profile.railway?.services?.postgres?.proxy;
  if (
    database !== 'assessment_production' ||
    !proxy?.domain ||
    !Number.isInteger(proxy.proxyPort) ||
    !secrets.roles?.admin
  )
    throw new Error(
      'A verified assessment_production profile and restricted admin credential are required',
    );
  const source = JSON.parse(
    readFileSync(resolve(__dirname, '../../../Questions/question_bank.json'), 'utf8'),
  );
  const entries = prepareQuestionBankDrafts(source);
  const keys = TestcaseKeyring.fromFile(resolve(directory, 'question-keyring.json'), true, [
    'PUBLIC',
    'HIDDEN',
  ]);
  const url = new URL(`postgresql://${proxy.domain}:${proxy.proxyPort}/${database}`);
  url.username = 'assessment_runtime_admin';
  url.password = secrets.roles.admin;
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', resolve(directory, 'postgres-ca.crt'));
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 15000,
    }),
  });
  try {
    phase = 'database-preview';
    const plan = await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const [identity] = await tx.$queryRaw<{ name: string; role: string; tls: boolean }[]>`
        SELECT current_database()::text AS name, current_user::text AS role,
        (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`;
        if (
          !identity ||
          identity.name !== database ||
          identity.role !== 'assessment_runtime_admin' ||
          !identity.tls
        )
          throw new Error('Production database identity or verified TLS check failed');
        const matching = await tx.question.count({
          where: { slug: { in: entries.map((entry) => entry.slug) } },
        });
        return {
          database,
          verifiedTls: true,
          totalInFile: entries.length,
          existingBankQuestions: await tx.question.count(),
          newDrafts: entries.length - matching,
          preservedQuestions: matching,
          willPublish: false,
          difficulties: Object.fromEntries(
            ['EASY', 'MEDIUM', 'HARD'].map((difficulty) => [
              difficulty,
              entries.filter((entry) => entry.difficulty === difficulty).length,
            ]),
          ),
        };
      },
      { maxWait: 30000, timeout: 30000 },
    );
    console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', ...plan }));
    if (args.includes('--apply')) {
      phase = 'draft-import';
      const result = await importProductionQuestionDrafts(db, entries, keys);
      const visible = await db.question.count({
        where: { archivedAt: null, slug: { in: entries.map((entry) => entry.slug) } },
      });
      console.log(JSON.stringify({ ...result, visibleSourceQuestions: visible }));
    }
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  // Connection strings, private tests and encryption keys never enter command output.
  const detail =
    error instanceof Error && error.message.startsWith('Invalid question ')
      ? error.message
      : 'Check the saved production profile, verified TLS connection, restricted admin permissions, keyring and source file.';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  console.error(
    JSON.stringify({ error: 'Production question import failed', phase, code, detail }),
  );
  process.exitCode = 1;
});
