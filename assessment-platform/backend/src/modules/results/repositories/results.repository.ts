import type { Prisma } from '../../../database/generated/client';
import { Injectable } from '@nestjs/common';
// Domain writes must receive the caller's transaction; repositories never open nested transactions.
export interface ResultsRepositoryContract {
  readonly transaction: Prisma.TransactionClient;
}
@Injectable()
export class ResultsRepository {
  async lock(tx: Prisma.TransactionClient, id: string) {
    const identity = await tx.assessmentAttempt.findUnique({ where: { id }, select: { assessmentId: true } });
    if (!identity) return null;
    await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${identity.assessmentId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.assessmentAttempt.findUnique({ where: { id }, include: {
      result: true, assessment: { select: { resultsReleaseAt: true } }, questions: { orderBy: { position: 'asc' }, include: {
        questionVersion: { select: { maxScore: true } }, submissions: { where: { purpose: { in: ['SUBMIT', 'FINAL'] } }, include: { result: true } },
      } },
    } });
  }
}
