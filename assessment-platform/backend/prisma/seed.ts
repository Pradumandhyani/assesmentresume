import { randomBytes } from 'node:crypto';
import { developmentDatabase } from './development-database';
import { seedDevelopmentAssessment } from './dev-seed';
async function main() {
  const db = developmentDatabase();
  try {
    const requested = process.env.DEV_ASSESSMENT_START_AT;
    if (requested && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(requested))
      throw new Error('DEV_ASSESSMENT_START_AT must be an ISO timestamp ending in Z');
    const now = (await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const opensAt = requested ? new Date(requested) : new Date(now.getTime() + 3600000);
    // Seed ciphertext is not used by a judge. Its ephemeral key is intentionally not logged or persisted.
    const assessment = await seedDevelopmentAssessment(db, opensAt, randomBytes(32));
    console.log(
      `Development assessment ${assessment.id}; persisted start ${assessment.opensAt?.toISOString()}. Existing schedules and credentials were preserved.`,
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Development seed failed. Check the development database, migrations and UTC schedule.',
  );
  process.exitCode = 1;
});
