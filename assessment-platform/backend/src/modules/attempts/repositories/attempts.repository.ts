import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../database/generated/client';
// Domain writes must receive the caller's transaction; repositories never open nested transactions.
export interface AttemptsRepositoryContract {
  readonly transaction: Prisma.TransactionClient;
}
export const attemptInclude = {
  assessment: { select: { title: true, status: true } },
  assignment: { select: { status: true } },
  questions: {
    orderBy: { position: 'asc' },
    include: {
      questionVersion: { include: { templates: true } },
      drafts: true,
      submissions: {
        where: { purpose: { in: ['SUBMIT', 'FINAL'] } },
        take: 1,
        select: { id: true, purpose: true },
      },
    },
  },
} satisfies Prisma.AssessmentAttemptInclude;
export type AttemptRow = Prisma.AssessmentAttemptGetPayload<{ include: typeof attemptInclude }>;
@Injectable()
export class AttemptsRepository {
  get(tx: Prisma.TransactionClient, id: string, studentId?: string) {
    return tx.assessmentAttempt.findFirst({
      where: { id, ...(studentId ? { studentId } : {}) },
      include: attemptInclude,
    });
  }
  async now(tx: Prisma.TransactionClient): Promise<Date> {
    const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!row) throw new Error('Database clock unavailable');
    return row.now;
  }
  async lock(tx: Prisma.TransactionClient, id: string, studentId?: string, skipBusy = false) {
    const row = await tx.assessmentAttempt.findFirst({
      where: { id, ...(studentId ? { studentId } : {}) },
      select: { assessmentId: true },
    });
    if (!row) return null;
    await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${row.assessmentId}::uuid FOR SHARE`;
    if (skipBusy) {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM assessment_attempts WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
    } else await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${id}::uuid FOR UPDATE`;
    return this.get(tx, id, studentId);
  }
}
