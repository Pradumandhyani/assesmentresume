import type { RequestContext } from '../../common/auth/request-context';
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Language } from '../../database/generated/client';
import { PrismaService } from '../../database/prisma.service';
import { ApiException } from '../../common/http/api-error';
import type { AuthIdentity } from '../auth/auth.types';
import type { components } from '../../../../contracts/generated/api';
import { allocate } from './allocation';
import { AttemptsRepository, type AttemptRow } from './repositories/attempts.repository';
import type { SaveDraftDto } from './dto/attempt-input.dto';
import { executionRules } from '../execution/grading';
import { ExecutionAvailability } from '../execution/execution-availability';
// Original Step 1 use-case type is retained; lifecycle methods implement its reserved contracts.
export interface AttemptsServiceContract {
  readonly context: RequestContext;
}
type Rules = components['schemas']['AssessmentRuleResponse'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = () => new ApiException(404, 'NOT_FOUND', 'Attempt or question not found.');
function draftView(d: {
  attemptQuestionId: string;
  language: Language;
  sourceCode: string;
  revision: number;
  savedAt: Date;
}) {
  return {
    attemptQuestionId: d.attemptQuestionId,
    language: d.language,
    sourceCode: d.sourceCode,
    revision: d.revision,
    savedAt: d.savedAt.toISOString(),
  };
}
@Injectable()
export class AttemptsService {
  constructor(
    private readonly db: PrismaService,
    private readonly repo: AttemptsRepository,
    private readonly availability: ExecutionAvailability,
  ) {}
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    serial = false,
  ): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
            return work(tx);
          },
          { isolationLevel: serial ? 'Serializable' : 'ReadCommitted', timeout: 15000 },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(error.code) &&
          retry < 3
        )
          continue;
        throw error;
      }
    }
  }
  async view(row: AttemptRow, tx: Prisma.TransactionClient) {
    const ready = await this.availability.ready(row.questions.flatMap((q) => q.questionVersion.templates.map((t) => t.toolchainId)), tx);
    return {
      id: row.id,
      assessmentId: row.assessmentId,
      assessmentTitle: row.assessment.title,
      status: row.status,
      stateVersion: row.stateVersion,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      rules: row.ruleSnapshot as unknown as Rules,
      capabilities: {
        executionAvailable: ready,
        submissionReviewAllowed: true,
        message: ready ? 'Execution workers are ready.' : 'Execution is unavailable. A reviewed toolchain and healthy worker are required.',
      },
      questions: row.questions.map((q) => ({
        id: q.id,
        position: q.position,
        questionVersionId: q.questionVersionId,
        title: q.questionVersion.title,
        difficulty: q.questionVersion.difficulty,
        selectedLanguage: q.selectedLanguage,
        finalSubmissionId: q.finalSubmissionId,
        hasDraft: q.drafts.length > 0,
        hasSubmission: q.submissions.some((s) => s.purpose !== 'RUN_PUBLIC'),
      })),
      drafts: row.questions.flatMap((q) => q.drafts.map(draftView)),
    };
  }
  private async deduplicate(
    tx: Prisma.TransactionClient,
    userId: string,
    operation: string,
    key: string,
    requestHash: string,
  ) {
    const old = await tx.idempotencyRecord.findUnique({
      where: { userId_operation_key: { userId, operation, key } },
    });
    if (old && old.requestHash !== requestHash)
      throw new ApiException(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was used with different input.',
      );
    return old;
  }
  private async record(
    tx: Prisma.TransactionClient,
    userId: string,
    operation: string,
    key: string,
    requestHash: string,
    id: string,
    now: Date,
    responseCode = 200,
  ) {
    await tx.idempotencyRecord.upsert({
      where: { userId_operation_key: { userId, operation, key } },
      create: {
        userId,
        operation,
        key,
        requestHash,
        responseCode,
        responseBody: { attemptId: id },
        expiresAt: new Date(now.getTime() + 7 * 86400000),
      },
      update: {},
    });
  }
  async start(identity: AuthIdentity, assessmentId: string, key: string) {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${assessmentId}::uuid FOR SHARE`;
      const assignment = await tx.assessmentAssignment.findUnique({
        where: { assessmentId_studentId: { assessmentId, studentId: identity.student!.id } },
        include: { assessment: { include: { rule: true } } },
      });
      if (!assignment || assignment.status !== 'ASSIGNED') throw missing();
      await tx.$queryRaw`SELECT id FROM assessment_assignments WHERE id = ${assignment.id}::uuid FOR UPDATE`;
      const operation = `start:${assessmentId}`;
      const requestHash = hash(assessmentId);
      await this.deduplicate(tx, identity.user.id, operation, key, requestHash);
      const existing = await tx.assessmentAttempt.findUnique({
        where: { assignmentId: assignment.id },
        select: { id: true },
      });
      let now = await this.repo.now(tx);
      if (existing) {
        const row = await this.repo.lock(tx, existing.id, identity.student!.id);
        if (!row) throw missing();
        now = await this.repo.now(tx);
        await this.settle(tx, row, now);
        await this.record(tx, identity.user.id, operation, key, requestHash, row.id, now);
        return { data: await this.view((await this.repo.get(tx, row.id))!, tx), now };
      }
      const a = assignment.assessment;
      if (
        !['SCHEDULED', 'OPEN'].includes(a.status) ||
        !a.opensAt ||
        !a.latestStartAt ||
        !a.closesAt ||
        now < a.opensAt ||
        now > a.latestStartAt ||
        now >= a.closesAt
      )
        throw new ApiException(
          409,
          'ASSESSMENT_NOT_OPEN',
          'This assessment is not accepting new attempts.',
        );
      if (!a.rule)
        throw new ApiException(422, 'POOL_INSUFFICIENT', 'The assessment rules are incomplete.');
      const pool = await tx.assessmentPoolQuestion.findMany({
        where: { assessmentId },
        select: {
          questionId: true,
          questionVersionId: true,
          questionVersion: { select: { status: true, difficulty: true, topicSnapshot: true, question: { select: { archivedAt: true } } } },
        },
      });
      let selected: typeof pool;
      try {
        selected = allocate(
          pool
            .filter((p) => p.questionVersion.status === 'PUBLISHED' && p.questionVersion.question.archivedAt === null && (!a.rule!.allowedTopics.length || p.questionVersion.topicSnapshot.some((topic) => a.rule!.allowedTopics.includes(topic))))
            .map((p) => ({ ...p, difficulty: p.questionVersion.difficulty })),
        );
      } catch {
        throw new ApiException(
          422,
          'POOL_INSUFFICIENT',
          'The published question pool is incomplete.',
        );
      }
      const r = a.rule;
      if (
        r.durationSeconds !== 10800 ||
        r.easyCount !== 2 ||
        r.mediumCount !== 1 ||
        r.hardCount !== 1 ||
        r.maxSourceBytes !== 65536
      )
        throw new ApiException(
          422,
          'POOL_INSUFFICIENT',
          'Assessment rules do not match the fixed policy.',
        );
      const rules = {
        durationSeconds: 10800,
        easyCount: 2,
        mediumCount: 1,
        hardCount: 1,
        allowedLanguages: r.allowedLanguages,
        maxSourceBytes: 65536,
        gradingPolicyVersion: r.gradingPolicyVersion,
        allocationPolicyVersion: r.allocationPolicyVersion,
        allowedTopics: r.allowedTopics,
        ...executionRules(r),
      };
      now = await this.repo.now(tx);
      if (now > a.latestStartAt || now >= a.closesAt)
        throw new ApiException(409, 'ASSESSMENT_NOT_OPEN', 'The admission window has closed.');
      const expiresAt = new Date(now.getTime() + 10800000);
      const row = await tx.assessmentAttempt.create({
        data: {
          assignmentId: assignment.id,
          assessmentId,
          studentId: identity.student!.id,
          startedAt: now,
          expiresAt,
          ruleSnapshot: rules,
          allocationManifestHash: hash(JSON.stringify(selected.map((p) => p.questionVersionId))),
        },
      });
      await tx.attemptQuestion.createMany({
        data: selected.map((p, index) => ({
          attemptId: row.id,
          assessmentId,
          questionId: p.questionId,
          questionVersionId: p.questionVersionId,
          position: index + 1,
        })),
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'attempt.expiry',
          aggregateId: row.id,
          dedupeKey: `expire-${row.id}`,
          payload: { attemptId: row.id },
          availableAt: expiresAt,
        },
      });
      await this.record(tx, identity.user.id, operation, key, requestHash, row.id, now);
      await tx.auditLog.create({
        data: {
          actorUserId: identity.user.id,
          action: 'attempt.started',
          entityType: 'AssessmentAttempt',
          entityId: row.id,
          requestId: randomUUID(),
          metadata: { assessmentId },
        },
      });
      return { data: await this.view((await this.repo.get(tx, row.id))!, tx), now };
    }, true);
  }
  private async freeze(
    tx: Prisma.TransactionClient,
    row: AttemptRow,
    now: Date,
    reason: 'STUDENT' | 'EXPIRED',
    actorUserId: string | null = null,
  ) {
    for (const q of row.questions) {
      const sourceCode =
        q.drafts.find((d) => d.language === q.selectedLanguage)?.sourceCode ??
        q.questionVersion.templates.find((t) => t.language === q.selectedLanguage)?.starterCode;
      if (sourceCode === undefined) throw new Error('Pinned language template missing');
      const sourceHash = hash(sourceCode);
      const s = await tx.submission.create({
        data: {
          attemptId: row.id,
          attemptQuestionId: q.id,
          questionVersionId: q.questionVersionId,
          purpose: 'FINAL',
          language: q.selectedLanguage,
          sourceCode,
          sourceHash,
          idempotencyKey: `final-${q.id}`,
          requestHash: hash(`${q.id}:${q.selectedLanguage}:${sourceHash}`),
          acceptedAt: now,
        },
      });
      await tx.attemptQuestion.update({ where: { id: q.id }, data: { finalSubmissionId: s.id } });
      await tx.outboxEvent.create({
        data: {
          eventType: 'submission.judge',
          aggregateId: s.id,
          dedupeKey: `judge-${s.id}-g1`,
          payload: { submissionId: s.id, generation: 1 },
        },
      });
    }
    await tx.assessmentAttempt.update({
      where: { id: row.id },
      data: { status: 'FINALIZING', finalizationReason: reason, stateVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        action: 'attempt.frozen',
        actorUserId,
        entityType: 'AssessmentAttempt',
        entityId: row.id,
        requestId: randomUUID(),
        metadata: { reason },
      },
    });
  }
  private async settle(tx: Prisma.TransactionClient, row: AttemptRow, now: Date) {
    if (row.status !== 'IN_PROGRESS') return;
    if (row.assessment.status === 'CANCELLED' || row.assignment.status !== 'ASSIGNED') {
      await tx.assessmentAttempt.update({
        where: { id: row.id },
        data: {
          status: 'VOIDED',
          finalizedAt: now,
          finalizationReason: 'ADMIN_VOID',
          stateVersion: { increment: 1 },
        },
      });
    } else if (now >= row.expiresAt) await this.freeze(tx, row, now, 'EXPIRED');
  }
  async get(studentId: string, id: string) {
    return this.transaction(async (tx) => {
      const row = await this.repo.lock(tx, id, studentId);
      if (!row) throw missing();
      const now = await this.repo.now(tx);
      await this.settle(tx, row, now);
      return { data: await this.view((await this.repo.get(tx, id))!, tx), now };
    });
  }
  async withActive<T>(
    studentId: string,
    id: string,
    work: (tx: Prisma.TransactionClient, row: AttemptRow, now: Date) => Promise<T>,
  ) {
    const result = await this.transaction(async (tx) => {
      const row = await this.repo.lock(tx, id, studentId);
      if (!row) throw missing();
      const now = await this.repo.now(tx);
      await this.settle(tx, row, now);
      if (
        row.status !== 'IN_PROGRESS' ||
        now >= row.expiresAt ||
        row.assessment.status === 'CANCELLED' ||
        row.assignment.status !== 'ASSIGNED'
      )
        return { error: true as const, now };
      return { data: await work(tx, row, now), now };
    });
    // Throw after commit so rejecting an expired save cannot roll back finalization.
    if ('error' in result)
      throw new ApiException(410, 'ATTEMPT_EXPIRED', 'This attempt is no longer editable.');
    return result;
  }
  async question(studentId: string, id: string, questionId: string) {
    const attempt = await this.get(studentId, id);
    const q = await this.db.attemptQuestion.findFirst({
      where: { id: questionId, attemptId: id },
      select: {
        questionVersion: {
          select: {
            id: true,
            title: true,
            difficulty: true,
            statement: true,
            inputFormat: true,
            outputFormat: true,
            constraints: true,
            explanation: true,
            cpuTimeMs: true,
            wallTimeMs: true,
            memoryLimitKiB: true,
            outputLimitBytes: true,
            maxScore: true,
            templates: { select: { language: true, starterCode: true, toolchainId: true } },
            publicExamples: true,
            topicSnapshot: true,
            tags: true,
            question: { select: { topics: { select: { topic: true } } } },
          },
        },
      },
    });
    if (!q) throw missing();
    const v = q.questionVersion;
    const examples = Array.isArray(v.publicExamples)
      ? v.publicExamples.flatMap((e) => {
          if (
            !e ||
            typeof e !== 'object' ||
            Array.isArray(e) ||
            typeof e.ordinal !== 'number' ||
            typeof e.input !== 'string' ||
            typeof e.expectedOutput !== 'string'
          )
            return [];
          return [{ ordinal: e.ordinal, input: e.input, expectedOutput: e.expectedOutput }];
        })
      : [];
    return {
      data: {
        attemptQuestionId: questionId,
        questionVersionId: v.id,
        title: v.title,
        difficulty: v.difficulty,
        statement: v.statement,
        inputFormat: v.inputFormat,
        outputFormat: v.outputFormat,
        constraints: v.constraints,
        explanation: v.explanation,
        cpuTimeMs: v.cpuTimeMs,
        wallTimeMs: v.wallTimeMs,
        memoryLimitKiB: v.memoryLimitKiB,
        outputLimitBytes: v.outputLimitBytes,
        maxScore: v.maxScore.toString(),
        templates: v.templates,
        topics: v.topicSnapshot.length ? v.topicSnapshot : v.question.topics.map((t) => t.topic),
        tags: v.tags,
        publicTestCases: examples,
        samplesAvailable: v.publicExamples !== null,
      },
      now: attempt.now,
    };
  }
  save(studentId: string, id: string, questionId: string, language: Language, input: SaveDraftDto) {
    return this.withActive(studentId, id, async (tx, row, now) => {
      if (!row.questions.some((q) => q.id === questionId)) throw missing();
      if (
        Buffer.byteLength(input.sourceCode, 'utf8') >
        (row.ruleSnapshot as unknown as Rules).maxSourceBytes
      )
        throw new ApiException(
          400,
          'VALIDATION_FAILED',
          'Source code exceeds the UTF-8 byte limit.',
        );
      const old = await tx.codeDraft.findUnique({
        where: { attemptQuestionId_language: { attemptQuestionId: questionId, language } },
      });
      if ((old?.revision ?? 0) !== input.expectedRevision) {
        if (
          old &&
          old.revision === input.expectedRevision + 1 &&
          old.sourceCode === input.sourceCode
        )
          return draftView(old);
        throw new ApiException(
          409,
          'REVISION_CONFLICT',
          'A newer draft exists. Keep your local code and review the server version.',
        );
      }
      const data = {
        sourceCode: input.sourceCode,
        sourceHash: hash(input.sourceCode),
        savedAt: now,
      };
      const draft = old
        ? await tx.codeDraft.update({
            where: { id: old.id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.codeDraft.create({
            data: { ...data, attemptId: id, attemptQuestionId: questionId, language },
          });
      return draftView(draft);
    });
  }
  select(studentId: string, id: string, questionId: string, language: Language, expected: number) {
    return this.withActive(studentId, id, async (tx, row) => {
      const q = row.questions.find((q) => q.id === questionId);
      if (!q) throw missing();
      if (q.selectedLanguage === language) return this.view(row, tx);
      if (row.stateVersion !== expected)
        throw new ApiException(
          409,
          'REVISION_CONFLICT',
          'The active language changed in another tab. Refresh before selecting it again.',
        );
      await tx.attemptQuestion.update({
        where: { id: questionId },
        data: { selectedLanguage: language },
      });
      await tx.assessmentAttempt.update({
        where: { id },
        data: { stateVersion: { increment: 1 } },
      });
      return this.view((await this.repo.get(tx, id))!, tx);
    });
  }
  async finalize(identity: AuthIdentity, id: string, key: string, expected?: number) {
    return this.transaction(async (tx) => {
      const row = await this.repo.lock(tx, id, identity.student!.id);
      if (!row) throw missing();
      const now = await this.repo.now(tx);
      const operation = `finalize:${id}`,
        requestHash = hash(String(expected));
      await this.deduplicate(tx, identity.user.id, operation, key, requestHash);
      await this.settle(tx, row, now);
      if (
        row.status === 'IN_PROGRESS' &&
        now < row.expiresAt &&
        row.assessment.status !== 'CANCELLED' &&
        row.assignment.status === 'ASSIGNED'
      ) {
        if (expected !== undefined && row.stateVersion !== expected)
          throw new ApiException(
            409,
            'REVISION_CONFLICT',
            'Attempt state changed. Refresh before final submission.',
          );
        await this.freeze(tx, row, now, 'STUDENT', identity.user.id);
      }
      await this.record(tx, identity.user.id, operation, key, requestHash, id, now, 202);
      return { data: await this.view((await this.repo.get(tx, id))!, tx), now };
    });
  }
  async reconcile() {
    const due = await this.db.assessmentAttempt.findMany({
      where: { status: 'IN_PROGRESS', expiresAt: { lte: await this.db.now() } },
      select: { id: true },
      take: 50,
      orderBy: { expiresAt: 'asc' },
    });
    for (const item of due)
      await this.transaction(async (tx) => {
        const row = await this.repo.lock(tx, item.id, undefined, true);
        if (row) await this.settle(tx, row, await this.repo.now(tx));
      });
  }
  async history(studentId: string, id: string) {
    await this.get(studentId, id);
    const rows = await this.db.submission.findMany({
      where: { attemptId: id },
      take: 200,
      orderBy: { acceptedAt: 'desc' },
      select: {
        id: true,
        attemptQuestionId: true,
        purpose: true,
        language: true,
        sourceCode: true,
        status: true,
        acceptedAt: true,
      },
    });
    return {
      data: { items: rows.map((s) => ({ ...s, acceptedAt: s.acceptedAt.toISOString() })) },
      now: await this.db.now(),
    };
  }
}
