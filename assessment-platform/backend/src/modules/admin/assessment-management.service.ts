import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/http/api-error';
import { Prisma } from '../../database/generated/client';
import type { AuthIdentity } from '../auth/auth.types';
import { type AssessmentInput, type PageInput } from './dto/management-input';
import {
  ManagementRepository,
  missing,
  immutable,
  conflict,
} from './repositories/management.repository';

const include = {
  rule: true,
  pool: { include: { questionVersion: true } },
  _count: { select: { assignments: true, attempts: true } },
};
type Row = Prisma.AssessmentGetPayload<{ include: typeof include }>;
@Injectable()
export class AssessmentManagementService {
  constructor(private readonly repo: ManagementRepository) {}
  private view(a: Row) {
    return {
      id: a.id,
      title: a.title,
      description: a.description ?? '',
      status: a.status,
      revision: a.revision,
      opensAt: a.opensAt?.toISOString() ?? null,
      latestStartAt: a.latestStartAt?.toISOString() ?? null,
      closesAt: a.closesAt?.toISOString() ?? null,
      resultsReleaseAt: a.resultsReleaseAt?.toISOString() ?? null,
      rule: a.rule
        ? {
            durationSeconds: a.rule.durationSeconds,
            easyCount: a.rule.easyCount,
            mediumCount: a.rule.mediumCount,
            hardCount: a.rule.hardCount,
            allowedLanguages: a.rule.allowedLanguages,
            allowedTopics: a.rule.allowedTopics,
            marks:
              a.rule.difficultyMarks ??
              Object.fromEntries(
                ['EASY', 'MEDIUM', 'HARD'].map((d) => [
                  d,
                  a.pool
                    .find((p) => p.questionVersion.difficulty === d)
                    ?.questionVersion.maxScore.toString() ?? '0.00',
                ]),
              ),
            submissionSelection: a.rule.submissionSelection,
            partialScoring: a.rule.partialScoring,
            hiddenFeedbackImmediate: a.rule.hiddenFeedbackImmediate,
          }
        : null,
      questionVersionIds: a.pool.map((p) => p.questionVersionId),
      pool: a.pool.map((p) => ({
        id: p.questionVersionId,
        questionId: p.questionId,
        title: p.questionVersion.title,
        difficulty: p.questionVersion.difficulty,
        maxScore: p.questionVersion.maxScore.toString(),
        topics: p.questionVersion.topicSnapshot,
      })),
      assignmentCount: a._count.assignments,
      attemptCount: a._count.attempts,
    };
  }
  async list(query: PageInput) {
    await this.repo.now();
    const where: Prisma.AssessmentWhereInput = {
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.status &&
      ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'ARCHIVED'].includes(query.status)
        ? { status: query.status as Prisma.EnumAssessmentStatusFilter }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.repo.db.assessment.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      this.repo.db.assessment.count({ where }),
    ]);
    return {
      items: items.map((a) => this.view(a)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async detail(id: string) {
    await this.repo.now();
    const a = await this.repo.db.assessment.findUnique({ where: { id }, include });
    if (!a) throw missing();
    return this.view(a);
  }
  private schedule(input: AssessmentInput) {
    return {
      title: input.title,
      description: input.description,
      opensAt: new Date(input.opensAt),
      latestStartAt: new Date(input.latestStartAt),
      closesAt: new Date(input.closesAt),
      resultsReleaseAt: input.resultsReleaseAt ? new Date(input.resultsReleaseAt) : null,
    };
  }
  private rule(input: AssessmentInput) {
    const { marks, ...rule } = input.rule;
    return {
      ...rule,
      difficultyMarks: marks,
      gradingPolicyVersion: 'v3-admin-weighted',
      allocationPolicyVersion: 'v2-bounded-stratified',
    };
  }
  private async pool(tx: Prisma.TransactionClient, id: string, input: AssessmentInput) {
    const versions = await tx.questionVersion.findMany({
      where: { id: { in: input.questionVersionIds } },
      include: { question: true, templates: { select: { language: true } } },
    });
    if (
      versions.length !== input.questionVersionIds.length ||
      new Set(versions.map((v) => v.questionId)).size !== versions.length
    )
      throw new ApiException(422, 'POOL_INSUFFICIENT', 'Select one existing version per question.');
    if (
      versions.some(
        (v) =>
          v.status !== 'PUBLISHED' ||
          v.question.archivedAt ||
          input.rule.allowedLanguages.some((l) => !v.templates.some((t) => t.language === l)),
      )
    )
      throw new ApiException(
        422,
        'POOL_INSUFFICIENT',
        'The pool requires active published versions and supported templates.',
      );
    await tx.assessmentPoolQuestion.deleteMany({ where: { assessmentId: id } });
    await tx.assessmentPoolQuestion.createMany({
      data: versions.map((v) => ({
        assessmentId: id,
        questionId: v.questionId,
        questionVersionId: v.id,
      })),
    });
  }
  async create(identity: AuthIdentity, key: string | undefined, input: AssessmentInput) {
    return this.repo.mutate(identity, 'admin:assessment:create', key, input, async (tx) => {
      const a = await tx.assessment.create({
        data: {
          ...this.schedule(input),
          createdById: await this.repo.adminId(identity, tx),
          rule: { create: this.rule(input) },
        },
      });
      await this.pool(tx, a.id, input);
      await this.repo.audit(tx, identity, 'assessment.created', 'Assessment', a.id);
      return { id: a.id, revision: a.revision, status: a.status };
    });
  }
  private async lock(tx: Prisma.TransactionClient, id: string, revision: number) {
    await tx.$queryRaw`SELECT id FROM assessments WHERE id=${id}::uuid FOR UPDATE`;
    const a = await tx.assessment.findUnique({ where: { id }, include });
    if (!a) throw missing();
    if (a.revision !== revision) throw conflict();
    return a;
  }
  async update(
    identity: AuthIdentity,
    id: string,
    key: string | undefined,
    input: AssessmentInput,
  ) {
    if (!input.revision) throw conflict();
    return this.repo.mutate(identity, `admin:assessment:update:${id}`, key, input, async (tx) => {
      const a = await this.lock(tx, id, input.revision!);
      if (a.status !== 'DRAFT') throw immutable();
      await tx.assessment.update({
        where: { id },
        data: { ...this.schedule(input), revision: { increment: 1 } },
      });
      await tx.assessmentRule.upsert({
        where: { assessmentId: id },
        create: { assessmentId: id, ...this.rule(input) },
        update: this.rule(input),
      });
      await this.pool(tx, id, input);
      await this.repo.audit(tx, identity, 'assessment.draft_updated', 'Assessment', id);
      return { id, revision: a.revision + 1, status: 'DRAFT' };
    });
  }
  async publish(identity: AuthIdentity, id: string, key: string | undefined, revision: number) {
    return this.repo.mutate(
      identity,
      `admin:assessment:publish:${id}`,
      key,
      { revision },
      async (tx) => {
        const a = await this.lock(tx, id, revision);
        if (a.status !== 'DRAFT') throw immutable();
        const r = a.rule;
        if (
          !r ||
          !a.opensAt ||
          !a.latestStartAt ||
          !a.closesAt ||
          !a.resultsReleaseAt ||
          a.resultsReleaseAt < a.closesAt ||
          a.latestStartAt.getTime() + r.durationSeconds * 1000 > a.closesAt.getTime()
        )
          throw new ApiException(
            422,
            'VALIDATION_FAILED',
            'Complete a valid schedule before publishing.',
          );
        const eligible = a.pool.filter(
          (p) =>
            !r.allowedTopics.length ||
            p.questionVersion.topicSnapshot.some((t) => r.allowedTopics.includes(t)),
        );
        const marks = r.difficultyMarks as Record<string, string> | null;
        for (const [difficulty, count] of [
          ['EASY', r.easyCount],
          ['MEDIUM', r.mediumCount],
          ['HARD', r.hardCount],
        ] as const) {
          const pool = eligible.filter((p) => p.questionVersion.difficulty === difficulty);
          if (
            pool.length < count ||
            pool.some(
              (p) =>
                p.questionVersion.status !== 'PUBLISHED' ||
                (marks && Number(p.questionVersion.maxScore) !== Number(marks[difficulty])),
            )
          )
            throw new ApiException(
              422,
              'POOL_INSUFFICIENT',
              'Difficulty, topics and published question marks must match the assessment policy.',
            );
        }
        await tx.assessment.update({
          where: { id },
          data: { status: 'SCHEDULED', revision: { increment: 1 } },
        });
        await this.repo.audit(tx, identity, 'assessment.published', 'Assessment', id, {
          revision: revision + 1,
        });
        return { id, revision: revision + 1, status: 'SCHEDULED' };
      },
    );
  }
  async cancel(identity: AuthIdentity, id: string, key: string | undefined, revision: number) {
    return this.repo.mutate(
      identity,
      `admin:assessment:cancel:${id}`,
      key,
      { revision },
      async (tx) => {
        const a = await this.lock(tx, id, revision);
        if (!['DRAFT', 'SCHEDULED', 'OPEN'].includes(a.status))
          throw new ApiException(409, 'VERSION_IMMUTABLE', 'This assessment cannot be cancelled.');
        const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
        await tx.assessment.update({
          where: { id },
          data: { status: 'CANCELLED', revision: { increment: 1 } },
        });
        // Assessment lock precedes attempt locks, matching acceptance and judge commits.
        await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE assessment_id=${id}::uuid AND status IN ('IN_PROGRESS','FINALIZING') ORDER BY id FOR UPDATE`;
        await tx.assessmentAttempt.updateMany({
          where: { assessmentId: id, status: { in: ['IN_PROGRESS', 'FINALIZING'] } },
          data: {
            status: 'VOIDED',
            finalizedAt: now,
            finalizationReason: 'ADMIN_VOID',
            stateVersion: { increment: 1 },
          },
        });
        await this.repo.audit(tx, identity, 'assessment.cancelled', 'Assessment', id);
        return { id, revision: revision + 1, status: 'CANCELLED' };
      },
    );
  }
  async assign(
    identity: AuthIdentity,
    id: string,
    key: string | undefined,
    input: { studentIds: string[]; cohorts: string[]; revoke: boolean },
  ) {
    return this.repo.mutate(identity, `admin:assessment:assign:${id}`, key, input, async (tx) => {
      await tx.$queryRaw`SELECT id FROM assessments WHERE id=${id}::uuid FOR UPDATE`;
      const a = await tx.assessment.findUnique({ where: { id } });
      if (!a) throw missing();
      if (['CANCELLED', 'CLOSED', 'ARCHIVED'].includes(a.status)) throw immutable();
      const students = await tx.student.findMany({
        where: {
          OR: [{ id: { in: input.studentIds } }, { cohort: { in: input.cohorts } }],
          ...(input.revoke ? {} : { user: { isActive: true, role: 'STUDENT' } }),
        },
        select: { id: true },
      });
      if (students.length > 5000)
        throw new ApiException(
          422,
          'VALIDATION_FAILED',
          'Assign at most 5000 students per request.',
        );
      if (input.studentIds.some((id) => !students.some((s) => s.id === id)))
        throw new ApiException(
          422,
          'VALIDATION_FAILED',
          'One or more students are missing or disabled.',
        );
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      for (const s of students) {
        const previous = await tx.assessmentAssignment.findUnique({
          where: { assessmentId_studentId: { assessmentId: id, studentId: s.id } },
          include: { attempt: { select: { id: true, status: true } } },
        });
        if (previous?.attempt && !input.revoke && previous.status === 'REVOKED')
          throw new ApiException(
            409,
            'VERSION_IMMUTABLE',
            'A revoked started assignment cannot be restored.',
          );
        await tx.assessmentAssignment.upsert({
          where: { assessmentId_studentId: { assessmentId: id, studentId: s.id } },
          create: {
            assessmentId: id,
            studentId: s.id,
            status: input.revoke ? 'REVOKED' : 'ASSIGNED',
          },
          update: { status: input.revoke ? 'REVOKED' : 'ASSIGNED' },
        });
        if (
          input.revoke &&
          previous?.attempt &&
          ['IN_PROGRESS', 'FINALIZING'].includes(previous.attempt.status)
        )
          await tx.assessmentAttempt.update({
            where: { id: previous.attempt.id },
            data: {
              status: 'VOIDED',
              finalizedAt: now,
              finalizationReason: 'ADMIN_VOID',
              stateVersion: { increment: 1 },
            },
          });
      }
      await this.repo.audit(
        tx,
        identity,
        input.revoke ? 'assessment.assignments_revoked' : 'assessment.students_assigned',
        'Assessment',
        id,
        { count: students.length },
      );
      return { id, assignedCount: students.length, status: input.revoke ? 'REVOKED' : 'ASSIGNED' };
    });
  }
  async monitor(id: string, query: PageInput) {
    const now = await this.repo.now();
    if (!(await this.repo.db.assessment.findUnique({ where: { id }, select: { id: true } })))
      throw missing();
    const rows = await this.repo.db.assessmentAssignment.findMany({
      where: { assessmentId: id },
      include: { student: true, attempt: { include: { result: true } } },
      orderBy: { id: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const classify = (r: (typeof rows)[number]) => {
      const a = r.attempt;
      if (r.status === 'REVOKED' || a?.status === 'VOIDED') return 'CANCELLED';
      if (!a) return 'NOT_STARTED';
      if (a.result?.status === 'REQUIRES_REVIEW') return 'EVALUATION_FAILED';
      if (a.status === 'FINALIZED') return 'COMPLETED';
      if (a.status === 'FINALIZING') return 'EVALUATION_PENDING';
      if (now >= a.expiresAt) return 'EXPIRED';
      if (!a.lastHeartbeatAt || now.getTime() - a.lastHeartbeatAt.getTime() > 90000) return 'STALE';
      return 'ACTIVE';
    };
    const countsRows = await this.repo.db.$queryRaw<
      { status: string; count: bigint }[]
    >`SELECT CASE WHEN x.status='REVOKED' OR a.status='VOIDED' THEN 'CANCELLED' WHEN a.id IS NULL THEN 'NOT_STARTED' WHEN r.status='REQUIRES_REVIEW' THEN 'EVALUATION_FAILED' WHEN a.status='FINALIZED' THEN 'COMPLETED' WHEN a.status='FINALIZING' THEN 'EVALUATION_PENDING' WHEN a.expires_at<=${now} THEN 'EXPIRED' WHEN a.last_heartbeat_at IS NULL OR a.last_heartbeat_at<${new Date(now.getTime() - 90000)} THEN 'STALE' ELSE 'ACTIVE' END AS status,count(*)::bigint AS count FROM assessment_assignments x LEFT JOIN assessment_attempts a ON a.assignment_id=x.id LEFT JOIN assessment_results r ON r.attempt_id=a.id WHERE x.assessment_id=${id}::uuid GROUP BY 1`;
    return {
      items: rows.map((r) => ({
        assignmentId: r.id,
        studentId: r.studentId,
        studentName: r.student.displayName,
        externalId: r.student.externalId,
        attemptId: r.attempt?.id ?? null,
        status: classify(r),
        attemptStatus: r.attempt?.status ?? null,
        lastHeartbeatAt: r.attempt?.lastHeartbeatAt?.toISOString() ?? null,
        expiresAt: r.attempt?.expiresAt.toISOString() ?? null,
        resultStatus: r.attempt?.result?.status ?? null,
        score: r.attempt?.result?.totalScore?.toString() ?? null,
      })),
      counts: Object.fromEntries(countsRows.map((r) => [r.status, Number(r.count)])),
      serverNow: now.toISOString(),
      page: query.page,
      pageSize: query.pageSize,
      total: countsRows.reduce((n, r) => n + Number(r.count), 0),
      message:
        'A stale heartbeat indicates connectivity or inactivity; it is not evidence of cheating.',
    };
  }
}
