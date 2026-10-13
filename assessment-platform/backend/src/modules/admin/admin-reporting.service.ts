import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../database/generated/client';
import type { Environment } from '../../config/environment';
import type { AuthIdentity } from '../auth/auth.types';
import type { PageInput } from './dto/management-input';
import { ManagementRepository, missing } from './repositories/management.repository';
import { QuestionAuthoringSecurity } from './question-management.service';
const safeSubmissionResult = {
  verdict: true,
  passedCount: true,
  totalCount: true,
  score: true,
  cpuTimeMs: true,
  memoryKiB: true,
};
const csvCell = (v: unknown) => {
  let text = String(v ?? '');
  if (/^\s*[=+@\-＝＋－＠]|^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
@Injectable()
export class AdminReportingService {
  constructor(
    private readonly repo: ManagementRepository,
    private readonly config: ConfigService<Environment, true>,
    private readonly authoring: QuestionAuthoringSecurity,
  ) {}
  async queue() {
    const now = await this.repo.now();
    const [groups, oldest, workers] = await Promise.all([
      this.repo.db.submission.groupBy({ by: ['status'], _count: true }),
      this.repo.db.submission.findFirst({
        where: { status: { in: ['PENDING', 'QUEUED'] } },
        orderBy: { acceptedAt: 'asc' },
        select: { acceptedAt: true },
      }),
      this.repo.db.judgeWorkerHeartbeat.count({
        where: { lastSeenAt: { gt: new Date(now.getTime() - 30000) } },
      }),
    ]);
    const count = (status: string) => groups.find((g) => g.status === status)?._count ?? 0,
      enabled = this.config.get('EXECUTION_ENABLED', { infer: true });
    return {
      pending: count('PENDING'),
      queued: count('QUEUED'),
      running: count('RUNNING'),
      failed: count('INFRASTRUCTURE_FAILED'),
      oldestPendingAt: oldest?.acceptedAt.toISOString() ?? null,
      oldestPendingAgeSeconds: oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.acceptedAt.getTime()) / 1000))
        : null,
      healthyWorkers: workers,
      status: !enabled
        ? 'DISABLED'
        : workers > 0 && (!oldest || now.getTime() - oldest.acceptedAt.getTime() < 120000)
          ? 'HEALTHY'
          : 'DEGRADED',
    };
  }
  async dashboard() {
    const now = await this.repo.now(),
      scheduled = { status: { in: ['SCHEDULED', 'OPEN'] as const } };
    const [
      totalStudents,
      totalAssessments,
      upcomingAssessments,
      activeAssessments,
      completedAssessments,
      currentlyActiveStudents,
      assigned,
      finished,
      queue,
      recent,
    ] = await Promise.all([
      this.repo.db.student.count(),
      this.repo.db.assessment.count(),
      this.repo.db.assessment.count({
        where: { status: { in: [...scheduled.status.in] }, opensAt: { gt: now } },
      }),
      this.repo.db.assessment.count({
        where: {
          status: { in: [...scheduled.status.in] },
          opensAt: { lte: now },
          closesAt: { gt: now },
        },
      }),
      this.repo.db.assessment.count({
        where: {
          OR: [
            { status: { in: ['CLOSED', 'ARCHIVED'] } },
            { status: { in: [...scheduled.status.in] }, closesAt: { lte: now } },
          ],
        },
      }),
      this.repo.db.assessmentAttempt.findMany({
        where: {
          status: 'IN_PROGRESS',
          expiresAt: { gt: now },
          lastHeartbeatAt: { gt: new Date(now.getTime() - 90000) },
          student: { user: { isActive: true } },
        },
        distinct: ['studentId'],
        select: { studentId: true },
      }),
      this.repo.db.assessmentAssignment.count({ where: { status: 'ASSIGNED' } }),
      this.repo.db.assessmentAttempt.count({
        where: { status: 'FINALIZED', assignment: { status: 'ASSIGNED' } },
      }),
      this.queue(),
      this.audit({ page: 1, pageSize: 8 }),
    ]);
    return {
      totalStudents,
      totalAssessments,
      upcomingAssessments,
      activeAssessments,
      completedAssessments,
      currentlyActiveStudents: currentlyActiveStudents.length,
      completionRate: assigned ? finished / assigned : 0,
      queue,
      recentActions: recent.items,
    };
  }
  async students(query: PageInput) {
    await this.repo.now();
    const where: Prisma.StudentWhereInput = {
      ...(query.search
        ? {
            OR: [
              { externalId: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { cohort: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.active ? { user: { isActive: query.active === 'true' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.repo.db.student.findMany({
        where,
        orderBy: { externalId: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { isActive: true } },
          assignments: {
            orderBy: { assignedAt: 'desc' },
            take: 100,
            include: {
              assessment: {
                select: {
                  id: true,
                  title: true,
                  opensAt: true,
                  latestStartAt: true,
                  closesAt: true,
                  status: true,
                },
              },
              attempt: { include: { result: { select: { totalScore: true, status: true } } } },
            },
          },
        },
      }),
      this.repo.db.student.count({ where }),
    ]);
    const now = await this.repo.now();
    return {
      items: rows.map((s) => ({
        id: s.id,
        externalId: s.externalId,
        displayName: s.displayName,
        cohort: s.cohort,
        isActive: s.user.isActive,
        assignments: s.assignments.map((x) => ({
          assessmentId: x.assessmentId,
          title: x.assessment.title,
          status: x.status,
          attemptId: x.attempt?.id ?? null,
          attemptStatus: x.attempt?.status ?? null,
          score: x.attempt?.result?.totalScore?.toString() ?? null,
          eligibility: !s.user.isActive
            ? 'DISABLED'
            : x.status === 'REVOKED'
              ? 'REVOKED'
              : x.attempt
                ? 'STARTED'
                : !['OPEN', 'SCHEDULED'].includes(x.assessment.status)
                  ? 'UNPUBLISHED_OR_CLOSED'
                  : x.assessment.opensAt && now < x.assessment.opensAt
                    ? 'NOT_OPEN'
                    : x.assessment.latestStartAt && now > x.assessment.latestStartAt
                      ? 'ADMISSION_CLOSED'
                      : 'ELIGIBLE',
        })),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
  async studentUpdate(
    identity: AuthIdentity,
    id: string,
    key: string | undefined,
    input: { active?: boolean | undefined; cohort?: string | null | undefined },
  ) {
    return this.repo.mutate(identity, `admin:student:update:${id}`, key, input, async (tx) => {
      const student = await tx.student.findUnique({
        where: { id },
        select: { id: true, userId: true },
      });
      if (!student) throw missing();
      await tx.$queryRaw`SELECT id FROM users WHERE id=${student.userId}::uuid FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: student.userId },
        select: { role: true },
      });
      if (target?.role !== 'STUDENT')
        throw new (await import('../../common/http/api-error')).ApiException(
          403,
          'FORBIDDEN',
          'Student management cannot modify administrator identities.',
        );
      if (input.cohort !== undefined)
        await tx.student.update({ where: { id }, data: { cohort: input.cohort } });
      if (input.active !== undefined) {
        await tx.user.update({
          where: { id: student.userId },
          data: { isActive: input.active, authVersion: { increment: 1 } },
          select: { id: true },
        });
        await tx.authSession.updateMany({
          where: { userId: student.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.repo.audit(tx, identity, 'student.account_updated', 'Student', id, {
        ...(input.active !== undefined ? { active: input.active } : {}),
        cohortChanged: input.cohort !== undefined,
      });
      return { id, updated: true };
    });
  }
  async submissions(query: PageInput) {
    await this.repo.now();
    const where: Prisma.SubmissionWhereInput = {
      ...(query.search
        ? {
            OR: [
              {
                attemptQuestion: {
                  attempt: {
                    student: { externalId: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              },
              {
                attemptQuestion: {
                  attempt: {
                    student: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              },
              {
                attemptQuestion: {
                  attempt: {
                    assessment: { title: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.assessmentId ? { attemptQuestion: { assessmentId: query.assessmentId } } : {}),
      ...(query.studentId
        ? {
            attemptQuestion: {
              attempt: { studentId: query.studentId },
              ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
            },
          }
        : {}),
      ...(query.status &&
      ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'INFRASTRUCTURE_FAILED', 'CANCELLED'].includes(
        query.status,
      )
        ? { status: query.status as Prisma.EnumSubmissionStatusFilter }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.repo.db.submission.findMany({
        where,
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
        orderBy: { acceptedAt: 'desc' },
        select: {
          id: true,
          attemptId: true,
          purpose: true,
          language: true,
          status: true,
          acceptedAt: true,
          completedAt: true,
          lastJudgeErrorCode: true,
          result: { select: safeSubmissionResult },
          attemptQuestion: {
            select: {
              questionVersion: { select: { title: true } },
              attempt: {
                select: {
                  studentId: true,
                  student: { select: { displayName: true, externalId: true } },
                  assessmentId: true,
                  assessment: { select: { title: true } },
                },
              },
            },
          },
        },
      }),
      this.repo.db.submission.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        attemptId: s.attemptId,
        studentId: s.attemptQuestion.attempt.studentId,
        studentName: s.attemptQuestion.attempt.student.displayName,
        externalId: s.attemptQuestion.attempt.student.externalId,
        assessmentId: s.attemptQuestion.attempt.assessmentId,
        assessmentTitle: s.attemptQuestion.attempt.assessment.title,
        questionTitle: s.attemptQuestion.questionVersion.title,
        purpose: s.purpose,
        language: s.language,
        status: s.status,
        acceptedAt: s.acceptedAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
        errorCode: s.lastJudgeErrorCode,
        result: s.result ? { ...s.result, score: s.result.score.toString() } : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private resultWhere(query: PageInput): Prisma.AssessmentResultWhereInput {
    return {
      ...(query.search
        ? {
            OR: [
              {
                attempt: {
                  student: { externalId: { contains: query.search, mode: 'insensitive' } },
                },
              },
              {
                attempt: {
                  student: { displayName: { contains: query.search, mode: 'insensitive' } },
                },
              },
              {
                attempt: { assessment: { title: { contains: query.search, mode: 'insensitive' } } },
              },
            ],
          }
        : {}),
      ...(query.assessmentId || query.studentId
        ? {
            attempt: {
              ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
              ...(query.studentId ? { studentId: query.studentId } : {}),
            },
          }
        : {}),
      ...(query.status && ['PENDING', 'COMPLETE', 'REQUIRES_REVIEW'].includes(query.status)
        ? { status: query.status as Prisma.EnumResultStatusFilter }
        : {}),
    };
  }
  private resultFilter(query: PageInput) {
    return Prisma.sql`${query.assessmentId ? Prisma.sql`AND a.assessment_id=${query.assessmentId}::uuid` : Prisma.empty} ${query.studentId ? Prisma.sql`AND a.student_id=${query.studentId}::uuid` : Prisma.empty}
      ${query.search ? Prisma.sql`AND (EXISTS (SELECT 1 FROM students s WHERE s.id=a.student_id AND (s.external_id ILIKE ${'%' + query.search + '%'} OR s.display_name ILIKE ${'%' + query.search + '%'})) OR EXISTS (SELECT 1 FROM assessments x WHERE x.id=a.assessment_id AND x.title ILIKE ${'%' + query.search + '%'}))` : Prisma.empty}`;
  }
  private async resultRows(
    query: PageInput,
    take = query.pageSize,
    skip = (query.page - 1) * query.pageSize,
  ) {
    return this.repo.db.assessmentResult.findMany({
      where: this.resultWhere(query),
      orderBy: { computedAt: 'desc' },
      take,
      skip,
      include: {
        attempt: {
          include: {
            student: { select: { id: true, displayName: true, externalId: true } },
            assessment: { select: { id: true, title: true } },
            questions: {
              include: {
                questionVersion: {
                  select: { title: true, difficulty: true, topicSnapshot: true, maxScore: true },
                },
              },
            },
          },
        },
      },
    });
  }
  private resultView(r: Awaited<ReturnType<AdminReportingService['resultRows']>>[number]) {
    const scores = Array.isArray(r.questionScores) ? r.questionScores : [];
    return {
      id: r.id,
      attemptId: r.attemptId,
      assessmentId: r.attempt.assessmentId,
      assessmentTitle: r.attempt.assessment.title,
      studentId: r.attempt.studentId,
      studentName: r.attempt.student.displayName,
      externalId: r.attempt.student.externalId,
      status: r.status,
      totalScore: r.totalScore?.toString() ?? null,
      maximumScore: r.maximumScore.toString(),
      computedAt: r.computedAt?.toISOString() ?? null,
      questions: r.attempt.questions.map((q) => {
        const score = scores.find(
          (s) => s && typeof s === 'object' && !Array.isArray(s) && s.attemptQuestionId === q.id,
        );
        const item = score && typeof score === 'object' && !Array.isArray(score) ? score : null;
        return {
          title: q.questionVersion.title,
          difficulty: q.questionVersion.difficulty,
          topics: q.questionVersion.topicSnapshot,
          score: typeof item?.score === 'string' ? item.score : null,
          maximumScore: q.questionVersion.maxScore.toString(),
          verdict: typeof item?.verdict === 'string' ? item.verdict : null,
          submissionId:
            typeof item?.scoringSubmissionId === 'string' ? item.scoringSubmissionId : null,
        };
      }),
    };
  }
  async results(query: PageInput) {
    await this.repo.now();
    const [rows, total, analytics] = await Promise.all([
      this.resultRows(query),
      this.repo.db.assessmentResult.count({ where: this.resultWhere(query) }),
      this.analytics(query),
    ]);
    return {
      items: rows.map((r) => this.resultView(r)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      analytics,
    };
  }
  private async analytics(query: PageInput) {
    const filter = this.resultFilter(query);
    const groups = async (expression: Prisma.Sql, extra = Prisma.empty) =>
      this.repo.db.$queryRaw<{ label: string; earned: string; maximum: string; count: bigint }[]>(
        Prisma.sql`SELECT ${expression} AS label,COALESCE(sum((j.value->>'score')::numeric),0)::text AS earned,sum((j.value->>'maximumScore')::numeric)::text AS maximum,count(*)::bigint AS count FROM assessment_results r JOIN assessment_attempts a ON a.id=r.attempt_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.question_scores,'[]'::jsonb)) j(value) JOIN attempt_questions q ON q.id=(j.value->>'attemptQuestionId')::uuid JOIN question_versions v ON v.id=q.question_version_id ${extra} WHERE r.status='COMPLETE' ${filter} GROUP BY 1 ORDER BY 1`,
      );
    const [difficulty, topics, questions, distribution, assigned, finished] = await Promise.all([
      groups(Prisma.sql`v.difficulty::text`),
      groups(Prisma.sql`topic`, Prisma.sql`CROSS JOIN LATERAL unnest(v.topic_snapshot) topic`),
      groups(Prisma.sql`v.title || ' (v' || v.version::text || ')'`),
      this.repo.db.$queryRaw<{ range: string; count: bigint }[]>(
        Prisma.sql`SELECT CASE WHEN total_score/maximum_score<0.25 THEN '0–24%' WHEN total_score/maximum_score<0.5 THEN '25–49%' WHEN total_score/maximum_score<0.75 THEN '50–74%' ELSE '75–100%' END AS range,count(*)::bigint AS count FROM assessment_results r JOIN assessment_attempts a ON a.id=r.attempt_id WHERE r.status='COMPLETE' ${filter} GROUP BY 1 ORDER BY 1`,
      ),
      this.repo.db.assessmentAssignment.count({
        where: {
          status: 'ASSIGNED',
          ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
          ...(query.studentId ? { studentId: query.studentId } : {}),
        },
      }),
      this.repo.db.assessmentAttempt.count({
        where: {
          status: 'FINALIZED',
          assignment: { status: 'ASSIGNED' },
          ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
          ...(query.studentId ? { studentId: query.studentId } : {}),
        },
      }),
    ]);
    const convert = (rows: typeof difficulty) =>
      rows.map((r) => ({ ...r, count: Number(r.count) }));
    return {
      completionRate: assigned ? finished / assigned : 0,
      scoreDistribution: distribution.map((r) => ({ ...r, count: Number(r.count) })),
      difficulty: convert(difficulty),
      topics: convert(topics),
      questions: convert(questions),
    };
  }
  async export(identity: AuthIdentity, query: PageInput) {
    await this.repo.now();
    const total = await this.repo.db.assessmentResult.count({ where: this.resultWhere(query) });
    if (total > 10000)
      throw new (await import('../../common/http/api-error')).ApiException(
        422,
        'VALIDATION_FAILED',
        'Filter exports to at most 10000 results.',
      );
    const rows = await this.resultRows(query, 10000, 0);
    await this.repo.db.$transaction((tx) =>
      this.repo.audit(
        tx,
        identity,
        'results.csv_exported',
        'AssessmentResult',
        query.assessmentId ?? null,
        { count: rows.length },
      ),
    );
    return [
      [
        'Student ID',
        'Student name',
        'Assessment',
        'Attempt ID',
        'Status',
        'Score',
        'Maximum',
        'Computed UTC',
      ]
        .map(csvCell)
        .join(','),
      ...rows.map((r) =>
        [
          r.attempt.student.externalId,
          r.attempt.student.displayName,
          r.attempt.assessment.title,
          r.attemptId,
          r.status,
          r.totalScore?.toString() ?? '',
          r.maximumScore.toString(),
          r.computedAt?.toISOString() ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n');
  }
  async audit(query: PageInput) {
    await this.repo.now();
    const where: Prisma.AuditLogWhereInput = {
      ...(query.search ? { action: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.repo.db.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
        include: {
          actor: {
            select: {
              admin: { select: { displayName: true } },
              student: { select: { displayName: true } },
            },
          },
        },
      }),
      this.repo.db.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        occurredAt: r.occurredAt.toISOString(),
        actorName: r.actor?.admin?.displayName ?? r.actor?.student?.displayName ?? 'System',
        metadata: r.metadata,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
  async settings() {
    const now = await this.repo.now();
    let toolchains: { id: string; language: string; version: string }[] = [];
    let questionAuthoringAvailable = this.authoring.available();
    if (questionAuthoringAvailable)
      try {
        this.authoring.keys();
        toolchains = this.authoring
          .catalog()
          .entries.map(({ id, language, version }) => ({ id, language, version }));
      } catch {
        questionAuthoringAvailable = false;
      }
    return {
      executionEnabled: this.config.get('EXECUTION_ENABLED', { infer: true }),
      questionAuthoringAvailable,
      toolchains,
      queueLimits: {
        public: this.config.get('EXECUTION_MAX_PENDING_PUBLIC', { infer: true }),
        hidden: this.config.get('EXECUTION_MAX_PENDING_HIDDEN', { infer: true }),
      },
      session: {
        secure: this.config.get('SESSION_SECURE', { infer: true }),
        sameSite: 'lax',
        ttlSeconds: this.config.get('SESSION_TTL_SECONDS', { infer: true }),
      },
      policy: { maxQuestions: 20, maxDurationSeconds: 21600 },
      serverNow: now.toISOString(),
    };
  }
}
