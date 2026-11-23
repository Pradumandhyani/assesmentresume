import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client';
import { ToolchainCatalog } from '../src/workers/sandbox/toolchain-catalog';
import { prepareQuestionBank } from './question-bank-import';
import { configureImportedDraftToolchains } from './production-question-bank';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported');
  const directory = resolve(__dirname, '../../.local/production');
  const profile = JSON.parse(readFileSync(resolve(directory, 'deployment.json'), 'utf8'));
  const secrets = JSON.parse(readFileSync(resolve(directory, 'database-secrets.json'), 'utf8'));
  const proxy = profile.railway?.services?.postgres?.proxy;
  if (
    profile.railway?.database?.name !== 'assessment_production' ||
    !proxy?.domain ||
    !Number.isInteger(proxy.proxyPort) ||
    !secrets.roles?.admin
  )
    throw new Error('A verified production profile is required');
  // This private catalog must match the exact catalog configured on admin-api.
  const catalog = ToolchainCatalog.fromFile(resolve(directory, 'toolchains.json'));
  const entries = prepareQuestionBank(
    JSON.parse(readFileSync(resolve(__dirname, '../../../Questions/question_bank.json'), 'utf8')),
    catalog,
  );
  const url = new URL(`postgresql://${proxy.domain}:${proxy.proxyPort}/assessment_production`);
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
    const [identity] = await db.$queryRaw<
      { database: string; role: string; tls: boolean }[]
    >`SELECT current_database()::text AS database, current_user::text AS role, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`;
    if (
      identity?.database !== 'assessment_production' ||
      identity.role !== 'assessment_runtime_admin' ||
      !identity.tls
    )
      throw new Error('Unexpected production identity');
    console.log(
      JSON.stringify({
        mode: args.includes('--apply') ? 'apply' : 'dry-run',
        ...(await configureImportedDraftToolchains(db, entries, args.includes('--apply'))),
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Production toolchain setup failed. Check the verified production profile, pinned catalog and database permissions.',
  );
  process.exitCode = 1;
});
