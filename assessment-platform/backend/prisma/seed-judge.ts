import { developmentDatabase } from './development-database';
import { TestcaseKeyring } from '../src/workers/judge/testcase-crypto';
import { ToolchainCatalog } from '../src/workers/sandbox/toolchain-catalog';
import { seedJudgeAssessment } from './judge-seed';
async function main() {
  const db = developmentDatabase();
  try {
    if (!process.env.TESTCASE_KEYRING_FILE || !process.env.SANDBOX_TOOLCHAIN_CATALOG)
      throw new Error('Private keyring and reviewed toolchain catalog paths are required');
    const keys = TestcaseKeyring.fromFile(process.env.TESTCASE_KEYRING_FILE);
    const catalog = ToolchainCatalog.fromFile(process.env.SANDBOX_TOOLCHAIN_CATALOG);
    const now = (await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const opensAt = process.env.DEV_EXECUTION_START_AT
      ? new Date(process.env.DEV_EXECUTION_START_AT)
      : new Date(now.getTime() + 3600000);
    if (process.env.DEV_EXECUTION_START_AT && !process.env.DEV_EXECUTION_START_AT.endsWith('Z'))
      throw new Error('DEV_EXECUTION_START_AT must be UTC ending in Z');
    const languages = Object.fromEntries(
      ['PYTHON', 'JAVA', 'CPP'].map((language) => [
        language,
        [...catalog.entries].reverse().find((t) => t.language === language)!.id,
      ]),
    ) as Record<'PYTHON' | 'JAVA' | 'CPP', string>;
    await seedJudgeAssessment(db, opensAt, keys, languages);
    console.log('Execution assessment seeded; published data and existing schedules preserved.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Judge seeding failed. Check development database, preserved keys, catalog and migration configuration.',
  );
  process.exitCode = 1;
});
