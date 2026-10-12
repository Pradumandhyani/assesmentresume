import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../database/generated/client';
import { PrismaService } from '../../../database/prisma.service';
// Domain writes must receive the caller's transaction; repositories never open nested transactions.
export interface SubmissionsRepositoryContract {
  readonly transaction: Prisma.TransactionClient;
}
export const submissionInclude = {
  result: true,
  attemptQuestion: { include: { attempt: { include: { assessment: { select: { resultsReleaseAt: true } } } } } },
} satisfies Prisma.SubmissionInclude;
export type SubmissionRow = Prisma.SubmissionGetPayload<{ include: typeof submissionInclude }>;
@Injectable()
export class SubmissionsRepository {
  constructor(private readonly db: PrismaService) {}
  own(studentId: string, id: string) {
    return this.db.submission.findFirst({ where: { id, attemptQuestion: { attempt: { studentId } } }, include: submissionInclude });
  }
}
