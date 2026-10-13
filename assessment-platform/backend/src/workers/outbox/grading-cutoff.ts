import type { PrismaService } from '../../database/prisma.service';
import type { ResultsService } from '../../modules/results/results.service';
export async function expireGrading(db: PrismaService, results: ResultsService) {
  const now = await db.now();
  // Terminal-state fencing prevents a late worker from publishing after this update.
  await db.submission.updateMany({
    where: {
      purpose: { in: ['SUBMIT', 'FINAL'] },
      status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      attemptQuestion: { attempt: { status: 'FINALIZING', gradingDeadlineAt: { lte: now } } },
    },
    data: {
      status: 'INFRASTRUCTURE_FAILED',
      completedAt: now,
      judgeLeaseToken: null,
      leaseExpiresAt: null,
      lastJudgeErrorCode: 'GRADING_CUTOFF',
      stateVersion: { increment: 1 },
    },
  });
  await results.reconcile();
}
