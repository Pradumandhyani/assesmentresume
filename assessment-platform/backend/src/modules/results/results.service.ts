import type { RequestContext } from '../../common/auth/request-context';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../database/generated/client';
import { ApiException } from '../../common/http/api-error';
import { cents, decimal, executionRules } from '../execution/grading';
import { ResultsRepository } from './repositories/results.repository';
// Use-case boundary; concrete methods will follow the OpenAPI operation definitions.
export interface ResultsServiceContract {
  readonly context: RequestContext;
}
@Injectable()
export class ResultsService {
  constructor(
    private readonly db: PrismaService,
    private readonly repo: ResultsRepository,
  ) {}
  async settle(attemptId: string) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        const row = await this.repo.lock(tx, attemptId);
        if (!row || row.result || row.status !== 'FINALIZING') return false;
        const policy = executionRules(row.ruleSnapshot).submissionSelection;
        const evaluations = row.questions.flatMap((q) =>
          q.submissions.filter((s) => s.purpose === 'FINAL' || s.acceptedAt < row.expiresAt),
        );
        // Finish all accepted hidden jobs, including those not selected for the final score.
        if (evaluations.some((s) => ['PENDING', 'QUEUED', 'RUNNING'].includes(s.status)))
          return false;
        const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
        let review = evaluations.some(
          (s) => s.status !== 'COMPLETED' || !s.result || s.result.verdict === 'INTERNAL_ERROR',
        );
        const questions = row.questions.map((q) => {
          const candidates = q.submissions.filter(
            (s) =>
              s.status === 'COMPLETED' &&
              s.result &&
              s.result.verdict !== 'INTERNAL_ERROR' &&
              (s.purpose === 'FINAL' || s.acceptedAt < row.expiresAt),
          );
          candidates.sort((a, b) => {
            if (policy === 'BEST_VALID') {
              const difference =
                cents(b.result!.score.toString()) - cents(a.result!.score.toString());
              if (difference !== 0n) return difference > 0n ? 1 : -1;
            }
            return b.acceptedAt.getTime() - a.acceptedAt.getTime() || b.id.localeCompare(a.id);
          });
          // LATEST_VALID selects the latest explicit solution, using the frozen draft only
          // when none was submitted. BEST_VALID may improve an earlier score with the final draft.
          const selected =
            policy === 'FINAL_SNAPSHOT'
              ? candidates.find((s) => s.id === q.finalSubmissionId)
              : policy === 'LATEST_VALID'
                ? (candidates.find((s) => s.purpose === 'SUBMIT') ??
                  candidates.find((s) => s.id === q.finalSubmissionId))
                : candidates[0];
          if (!selected) review = true;
          return {
            attemptQuestionId: q.id,
            finalSubmissionId: q.finalSubmissionId,
            scoringSubmissionId: selected?.id ?? null,
            verdict: selected?.result?.verdict ?? null,
            score: selected?.result?.score.toString() ?? null,
            maximumScore: q.questionVersion.maxScore.toString(),
          };
        });
        const maximum = decimal(
          row.questions.reduce((n, q) => n + cents(q.questionVersion.maxScore.toString()), 0n),
        );
        const total = review ? null : decimal(questions.reduce((n, q) => n + cents(q.score!), 0n));
        await tx.assessmentResult.create({
          data: {
            attemptId,
            status: review ? 'REQUIRES_REVIEW' : 'COMPLETE',
            totalScore: total,
            maximumScore: maximum,
            gradingPolicyVersion:
              (row.ruleSnapshot as { gradingPolicyVersion?: string }).gradingPolicyVersion ??
              'v1-final-snapshot',
            computedAt: now,
            releasedAt: row.assessment.resultsReleaseAt,
            questionScores: questions as Prisma.InputJsonValue,
          },
        });
        await tx.assessmentAttempt.update({
          where: { id: attemptId },
          data: { status: 'FINALIZED', finalizedAt: now, stateVersion: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'attempt.graded',
            entityType: 'AssessmentAttempt',
            entityId: attemptId,
            requestId: randomUUID(),
            metadata: { status: review ? 'REQUIRES_REVIEW' : 'COMPLETE', policy },
          },
        });
        return true;
      },
      { timeout: 15000 },
    );
  }
  async reconcile() {
    const rows = await this.db.assessmentAttempt.findMany({
      where: { status: 'FINALIZING' },
      select: { id: true },
      take: 50,
      orderBy: { expiresAt: 'asc' },
    });
    for (const row of rows) await this.settle(row.id);
  }
  async get(studentId: string, id: string) {
    const attempt = await this.db.assessmentAttempt.findFirst({
      where: { id, studentId },
      include: {
        result: true,
        assessment: { select: { resultsReleaseAt: true } },
        questions: {
          orderBy: { position: 'asc' },
          include: { questionVersion: { select: { maxScore: true } } },
        },
      },
    });
    if (!attempt) throw new ApiException(404, 'NOT_FOUND', 'Attempt not found.');
    const now = await this.db.now();
    const result = attempt.result;
    const released =
      !!attempt.assessment.resultsReleaseAt && attempt.assessment.resultsReleaseAt <= now;
    const scores = released && Array.isArray(result?.questionScores) ? result.questionScores : [];
    return {
      now,
      data: {
        attemptId: id,
        attemptStatus: attempt.status,
        finalizationReason: attempt.finalizationReason,
        status: result?.status ?? 'PENDING',
        feedbackReleased: released,
        totalScore: released ? (result?.totalScore?.toString() ?? null) : null,
        maximumScore:
          result?.maximumScore.toString() ??
          decimal(
            attempt.questions.reduce(
              (n, q) => n + cents(q.questionVersion.maxScore.toString()),
              0n,
            ),
          ),
        computedAt: result?.computedAt?.toISOString() ?? null,
        releasedAt: released ? attempt.assessment.resultsReleaseAt!.toISOString() : null,
        questions: attempt.questions.map((q) => {
          const item = scores.find(
            (s) => s && typeof s === 'object' && !Array.isArray(s) && s.attemptQuestionId === q.id,
          );
          const score = item && typeof item === 'object' && !Array.isArray(item) ? item : null;
          return {
            attemptQuestionId: q.id,
            finalSubmissionId: q.finalSubmissionId,
            scoringSubmissionId:
              typeof score?.scoringSubmissionId === 'string' ? score.scoringSubmissionId : null,
            verdict: typeof score?.verdict === 'string' ? score.verdict : null,
            score: typeof score?.score === 'string' ? score.score : null,
            maximumScore: q.questionVersion.maxScore.toString(),
          };
        }),
      },
    };
  }
}
