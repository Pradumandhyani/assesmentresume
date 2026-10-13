import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { ResultsRepository } from '../modules/results/repositories/results.repository';
import { ResultsService } from '../modules/results/results.service';
import { AttemptsRepository } from '../modules/attempts/repositories/attempts.repository';
import { AttemptsService } from '../modules/attempts/attempts.service';
import { ExecutionAvailability } from '../modules/execution/execution-availability';
import type { Environment } from '../config/environment';
export async function workerContext(url: string, pool: number) {
  // Each process explicitly uses its own database identity, not the API's DATABASE_URL.
  const config = new ConfigService<Environment, true>({
    DATABASE_URL: url,
    DATABASE_POOL_MAX: pool,
    EXECUTION_ENABLED: false,
  });
  const db = new PrismaService(config);
  await db.onModuleInit();
  const results = new ResultsService(db, new ResultsRepository());
  const attempts = new AttemptsService(
    db,
    new AttemptsRepository(),
    new ExecutionAvailability(db, config),
  );
  return { db, results, attempts };
}
