import type { RequestContext } from '../../common/auth/request-context';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { ApiException } from '../../common/http/api-error';
import { AttemptsService } from '../attempts/attempts.service';
import { ExecutionAvailability } from '../execution/execution-availability';
import { executionRules } from '../execution/grading';
import {
  SubmissionsRepository,
  submissionInclude,
  type SubmissionRow,
} from './repositories/submissions.repository';
import type { CreateSubmissionDto } from './dto/create-submission.dto';
// Use-case boundary; concrete methods will follow the OpenAPI operation definitions.
export interface SubmissionsServiceContract {
  readonly context: RequestContext;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function idempotencyKey(value?: string): string {
  if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw new ApiException(400, 'VALIDATION_FAILED', 'A valid Idempotency-Key header is required.');
  return value;
}
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly repo: SubmissionsRepository,
    private readonly attempts: AttemptsService,
    private readonly availability: ExecutionAvailability,
    private readonly config: ConfigService,
  ) {}
  view(row: SubmissionRow, now: Date) {
    const attempt = row.attemptQuestion.attempt;
    const released =
      row.purpose === 'RUN_PUBLIC' ||
      executionRules(attempt.ruleSnapshot).hiddenFeedbackImmediate ||
      (attempt.assessment.resultsReleaseAt !== null && attempt.assessment.resultsReleaseAt <= now);
    const result = row.result;
    const publicCases =
      row.purpose === 'RUN_PUBLIC' && Array.isArray(result?.publicCaseResults)
        ? result.publicCaseResults.flatMap((item) => {
            if (
              !item ||
              typeof item !== 'object' ||
              Array.isArray(item) ||
              typeof item.ordinal !== 'number' ||
              typeof item.verdict !== 'string' ||
              typeof item.stdout !== 'string' ||
              typeof item.stderr !== 'string' ||
              typeof item.input !== 'string' ||
              typeof item.expectedOutput !== 'string'
            )
              return [];
            return [
              {
                ordinal: item.ordinal,
                verdict: item.verdict,
                stdout: item.stdout.slice(0, 65536),
                stderr: item.stderr.slice(0, 4096),
                input: item.input.slice(0, 262144),
                expectedOutput: item.expectedOutput.slice(0, 65536),
                cpuTimeMs: typeof item.cpuTimeMs === 'number' ? item.cpuTimeMs : null,
                wallTimeMs: typeof item.wallTimeMs === 'number' ? item.wallTimeMs : null,
                memoryKiB: typeof item.memoryKiB === 'number' ? item.memoryKiB : null,
              },
            ];
          })
        : [];
    return {
      id: row.id,
      attemptId: row.attemptId,
      attemptQuestionId: row.attemptQuestionId,
      questionVersionId: row.questionVersionId,
      purpose: row.purpose,
      language: row.language,
      status: row.status,
      acceptedAt: row.acceptedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      feedbackReleased: released,
      result:
        result && released
          ? {
              verdict: result.verdict,
              passedCount: result.passedCount,
              totalCount: result.totalCount,
              score: result.score.toString(),
              publicCaseResults: publicCases,
              cpuTimeMs: result.cpuTimeMs,
              memoryKiB: result.memoryKiB,
            }
          : null,
    };
  }
  async get(studentId: string, id: string) {
    const row = await this.repo.own(studentId, id);
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Submission not found.');
    const now = await this.db.now();
    return { data: this.view(row, now), now };
  }
  async create(
    studentId: string,
    userId: string,
    attemptId: string,
    input: CreateSubmissionDto,
    key: string,
    purpose: 'RUN_PUBLIC' | 'SUBMIT',
  ) {
    if (Buffer.byteLength(input.sourceCode, 'utf8') > 65536 || input.sourceCode.includes('\0'))
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Source must be valid text within the 64 KiB limit.',
      );
    const sourceHash = digest(input.sourceCode);
    const requestHash = digest(
      JSON.stringify([purpose, input.attemptQuestionId, input.language, sourceHash]),
    );
    // Successful retry remains available after the cutoff. Ownership precedes key lookup disclosure.
    const old = await this.db.submission.findFirst({
      where: { attemptId, idempotencyKey: key, attemptQuestion: { attempt: { studentId } } },
      include: submissionInclude,
    });
    if (old) {
      if (old.requestHash !== requestHash)
        throw new ApiException(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was used with different input.',
        );
      const now = await this.db.now();
      return { data: this.view(old, now), now };
    }
    return this.attempts.withActive(studentId, attemptId, async (tx, attempt, now) => {
      const replay = await tx.submission.findUnique({
        where: { attemptId_idempotencyKey: { attemptId, idempotencyKey: key } },
        include: submissionInclude,
      });
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new ApiException(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key was used with different input.',
          );
        return this.view(replay, now);
      }
      const q = attempt.questions.find((q) => q.id === input.attemptQuestionId);
      if (!q) throw new ApiException(404, 'NOT_FOUND', 'Attempt question not found.');
      const allowedLanguages = (attempt.ruleSnapshot as { allowedLanguages: string[] })
        .allowedLanguages;
      if (!allowedLanguages.includes(input.language))
        throw new ApiException(
          400,
          'VALIDATION_FAILED',
          'This language is not allowed for the assessment.',
        );
      const template = q.questionVersion.templates.find((t) => t.language === input.language);
      if (!template || !(await this.availability.ready([template.toolchainId], tx)))
        throw new ApiException(
          503,
          'EXECUTION_UNAVAILABLE',
          'A healthy execution worker with the pinned toolchain is required.',
        );
      const rules = executionRules(attempt.ruleSnapshot);
      const accepted = await tx.submission.findMany({
        where: { attemptQuestionId: q.id, purpose },
        select: { acceptedAt: true },
        orderBy: { acceptedAt: 'desc' },
      });
      const maximum = purpose === 'SUBMIT' ? rules.maxHiddenSubmissions : rules.maxPublicRuns;
      if (accepted.length >= maximum)
        throw new ApiException(
          429,
          'SUBMISSION_LIMIT',
          'The configured question submission limit has been reached.',
          3600,
        );
      const cooldown = purpose === 'SUBMIT' ? rules.hiddenCooldownSeconds : 2;
      const remaining = accepted[0]
        ? cooldown - (now.getTime() - accepted[0].acceptedAt.getTime()) / 1000
        : 0;
      if (remaining > 0)
        throw new ApiException(
          429,
          'RATE_LIMITED',
          'Please wait before submitting again.',
          Math.ceil(remaining),
        );
      const pending = ['PENDING', 'QUEUED', 'RUNNING'] as const;
      if ((await tx.submission.count({ where: { attemptId, status: { in: [...pending] } } })) >= 4)
        throw new ApiException(
          429,
          'QUEUE_BACKPRESSURE',
          'Wait for your accepted evaluations to complete.',
        );
      // A database-wide admission lock makes the queue budget atomic across API replicas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261012, 4)`;
      const count = await tx.submission.count({
        where: {
          purpose: purpose === 'RUN_PUBLIC' ? 'RUN_PUBLIC' : { in: ['SUBMIT', 'FINAL'] },
          status: { in: [...pending] },
        },
      });
      const ceiling =
        this.config.get<number>(
          purpose === 'RUN_PUBLIC'
            ? 'EXECUTION_MAX_PENDING_PUBLIC'
            : 'EXECUTION_MAX_PENDING_HIDDEN',
        ) ?? 1500;
      if (count >= ceiling)
        throw new ApiException(
          503,
          'QUEUE_BACKPRESSURE',
          'The execution queue is busy. Retry shortly.',
        );
      const row = await tx.submission.create({
        data: {
          attemptId,
          attemptQuestionId: q.id,
          questionVersionId: q.questionVersionId,
          purpose,
          language: input.language,
          sourceCode: input.sourceCode,
          sourceHash,
          requestHash,
          idempotencyKey: key,
          acceptedAt: now,
        },
        include: submissionInclude,
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'submission.judge',
          aggregateId: row.id,
          dedupeKey: `judge-${row.id}-g1`,
          payload: { submissionId: row.id, generation: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'submission.accepted',
          entityType: 'Submission',
          entityId: row.id,
          requestId: randomUUID(),
          metadata: { attemptId, purpose },
        },
      });
      return this.view(row, now);
    });
  }
}
