import { randomUUID } from 'node:crypto';
import { step4Context, envelope, type Attempt, type Submission } from './support/step4-context';
import { ContractBroker } from './support/contract-broker';
import { JudgeService, JudgeBusyError } from '../src/workers/judge/judge-service';
import { ResultsService } from '../src/modules/results/results.service';
import { judgeFixtures } from '../prisma/judge-fixtures';
import { seedJudgeAssessment } from '../prisma/judge-seed';
import { OutboxDispatcher } from '../src/workers/outbox/outbox-dispatcher';
import type { ExecutionQueues } from '../src/queues/execution-queues';
import { expireGrading } from '../src/workers/outbox/grading-cutoff';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('Step 4 real HTTP/PostgreSQL lifecycle with an explicit sandbox transport double', () => {
  let context: Awaited<ReturnType<typeof step4Context>>,
    attempt: Attempt,
    question: Attempt['questions'][number],
    judge: JudgeService;
  const broker = new ContractBroker();
  const create = async (purpose: 'run' | 'submit-solution', source: string, key = randomUUID()) => {
    const response = await context.request(
      `/attempts/${attempt.id}/${purpose}`,
      'POST',
      { attemptQuestionId: question.id, language: 'PYTHON', sourceCode: source },
      key,
    );
    expect(response.status).toBe(202);
    return (await envelope<Submission>(response)).data;
  };
  const configure = async (q: Attempt['questions'][number]) => {
    const row = await context.prisma.questionVersion.findUniqueOrThrow({
      where: { id: q.questionVersionId },
      include: { question: true },
    });
    const fixture = judgeFixtures.find((f) => row.question.slug.endsWith(f.slug))!;
    broker.outputs = new Map(fixture.cases.map((c) => [c.input, c.output]));
    broker.firstHiddenInput = fixture.cases[2]!.input;
    return fixture;
  };
  beforeAll(async () => {
    context = await step4Context();
    attempt = await context.start();
    question = attempt.questions.find((q) => q.difficulty === 'EASY')!;
    judge = new JudgeService(
      context.prisma,
      broker,
      context.catalog,
      context.keys,
      context.app.get(ResultsService),
    );
  }, 120000);
  const policyAssessment = async (
    policy: 'BEST_VALID' | 'LATEST_VALID' | 'FINAL_SNAPSHOT',
    topics: string[] = [],
    schedule = true,
  ) => {
    const now = await context.prisma.now();
    const pool = await context.prisma.assessmentPoolQuestion.findMany({
      where: { assessmentId: context.assessment.id },
      select: { questionId: true, questionVersionId: true },
    });
    const a = await context.prisma.assessment.create({
      data: {
        title: 'Isolated policy test',
        createdById: context.assessment.createdById,
        rule: {
          create: {
            submissionSelection: policy,
            hiddenCooldownSeconds: 0,
            maxHiddenSubmissions: 2,
            allowedTopics: topics,
          },
        },
        pool: { create: pool },
      },
    });
    if (schedule)
      await context.prisma.assessment.update({
        where: { id: a.id },
        data: {
          status: 'SCHEDULED',
          opensAt: new Date(now.getTime() - 60000),
          latestStartAt: new Date(now.getTime() + 1200000),
          closesAt: new Date(now.getTime() + 12000000),
          resultsReleaseAt: new Date(now.getTime() + 12000000),
        },
      });
    const owner = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    const assignment = await context.prisma.assessmentAssignment.create({
      data: { assessmentId: a.id, studentId: owner.id },
    });
    return { assessment: a, assignment };
  };
  const startPolicy = async (policy: 'BEST_VALID' | 'LATEST_VALID' | 'FINAL_SNAPSHOT') => {
    const { assessment } = await policyAssessment(policy);
    const response = await context.request(
      `/assessments/${assessment.id}/start`,
      'POST',
      {},
      randomUUID(),
    );
    expect(response.status).toBe(200);
    return (await envelope<Attempt>(response)).data;
  };
  beforeEach(async () => {
    await context.prisma.judgeWorkerHeartbeat.updateMany({
      data: { lastSeenAt: await context.prisma.now() },
    });
    await context.signIn('STEP4-OWNER');
  });
  afterAll(async () => {
    await context?.close();
  }, 30000);
  it('seeds eight immutable questions, correct scoring weights, and preserves schedules on rerun', async () => {
    expect(await context.prisma.question.count()).toBe(8);
    await seedJudgeAssessment(context.prisma, new Date(Date.now() + 86400000), context.keys, {
      PYTHON: 'changed-python',
      JAVA: 'changed-java',
      CPP: 'changed-cpp',
    });
    expect(await context.prisma.question.count()).toBe(8);
    expect(
      (await context.prisma.assessment.findUniqueOrThrow({ where: { id: context.assessment.id } }))
        .opensAt,
    ).toEqual(context.assessment.opensAt);
    const versions = await context.prisma.questionVersion.findMany();
    expect(
      versions.filter((v) => v.difficulty === 'EASY').every((v) => v.maxScore.toString() === '10'),
    ).toBe(true);
    expect(attempt.questions.filter((q) => q.difficulty === 'EASY')).toHaveLength(2);
    expect(attempt.questions.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(1);
    expect(attempt.questions.filter((q) => q.difficulty === 'HARD')).toHaveLength(1);
    // PGlite's pg-wire adapter cannot reuse a connection after a trigger exception;
    // exercise the actual trigger via the same PostgreSQL engine's direct connection.
    await expect(
      context.database.query(
        'UPDATE question_templates SET execution_adapter = \'{"kind":"STDIO"}\'::jsonb WHERE question_version_id = $1',
        [question.questionVersionId],
      ),
    ).rejects.toThrow();
  });
  it('deduplicates concurrent accepted requests and rejects a changed payload with the same key', async () => {
    const key = randomUUID(),
      input = {
        attemptQuestionId: question.id,
        language: 'PYTHON',
        sourceCode: '# contract-correct',
      };
    const responses = await Promise.all([
      context.request(`/attempts/${attempt.id}/run`, 'POST', input, key),
      context.request(`/attempts/${attempt.id}/run`, 'POST', input, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    const rows = await Promise.all(responses.map((r) => envelope<Submission>(r)));
    expect(rows[0]!.data.id).toBe(rows[1]!.data.id);
    expect(
      await context.prisma.submission.count({
        where: { attemptId: attempt.id, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(
      (
        await context.request(
          `/attempts/${attempt.id}/run`,
          'POST',
          { ...input, sourceCode: 'changed' },
          key,
        )
      ).status,
    ).toBe(409);
    await configure(question);
    broker.requests.length = 0;
    await judge.evaluate(rows[0]!.data.id, 1);
    const result = (
      await envelope<Submission>(await context.request(`/submissions/${rows[0]!.data.id}`))
    ).data;
    expect(result.result?.totalCount).toBe(2);
    expect(result.result?.passedCount).toBe(2);
    expect(result.result?.publicCaseResults).toHaveLength(2);
    const fixture = await configure(question);
    expect(broker.requests.map((r) => Buffer.from(r.stdinBase64, 'base64').toString())).toEqual(
      fixture.cases.slice(0, 2).map((c) => c.input),
    );
    expect(JSON.stringify(broker.requests)).not.toContain('expectedOutput');
  });
  it('rejects foreign ownership, unsupported language and unexpected execution options', async () => {
    await context.signIn('STEP4-OTHER');
    expect(
      (
        await context.request(
          `/attempts/${attempt.id}/run`,
          'POST',
          { attemptQuestionId: question.id, language: 'PYTHON', sourceCode: 'stolen' },
          randomUUID(),
        )
      ).status,
    ).toBe(404);
    const existing = await context.prisma.submission.findFirstOrThrow({
      where: { attemptId: attempt.id },
    });
    expect((await context.request(`/submissions/${existing.id}`)).status).toBe(404);
    expect((await context.request(`/results/${attempt.id}`)).status).toBe(404);
    await context.signIn('STEP4-OWNER');
    expect(
      (
        await context.request(
          `/attempts/${attempt.id}/run`,
          'POST',
          { attemptQuestionId: question.id, language: 'JAVASCRIPT', sourceCode: 'code' },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await context.request(
          `/attempts/${attempt.id}/run`,
          'POST',
          {
            attemptQuestionId: question.id,
            language: 'PYTHON',
            sourceCode: 'code',
            enableNetwork: true,
          },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it('never exposes hidden stdout/stderr even when code deliberately echoes its input', async () => {
    const submission = await create('submit-solution', '# contract-echo');
    await configure(question);
    await judge.evaluate(submission.id, 1);
    let result = (
      await envelope<Submission>(await context.request(`/submissions/${submission.id}`))
    ).data;
    expect(result.status).toBe('COMPLETED');
    expect(result.result).toBeNull();
    expect(result.feedbackReleased).toBe(false);
    const release = new Date(context.assessment.resultsReleaseAt!.getTime() + 1),
      clock = jest.spyOn(context.prisma, 'now').mockResolvedValue(release);
    try {
      result = (await envelope<Submission>(await context.request(`/submissions/${submission.id}`)))
        .data;
      expect(result.result?.publicCaseResults).toEqual([]);
      expect(result.result?.totalCount).toBe(4);
      expect(JSON.stringify(result)).not.toMatch(
        /private echo|inputCiphertext|internalDiagnostics|expectedOutput|stdout|stderr|ordinal/,
      );
    } finally {
      clock.mockRestore();
    }
    const stored = await context.prisma.submissionResult.findUniqueOrThrow({
      where: { submissionId: submission.id },
    });
    expect(stored.publicCaseResults).toBeNull();
    expect(stored.internalDiagnosticsCiphertext).not.toBeNull();
  });
  it('enforces the hidden probing cooldown without creating another submission', async () => {
    const before = await context.prisma.submission.count();
    const response = await context.request(
      `/attempts/${attempt.id}/submit-solution`,
      'POST',
      { attemptQuestionId: question.id, language: 'PYTHON', sourceCode: '# contract-correct' },
      randomUUID(),
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await context.prisma.submission.count()).toBe(before);
  });
  it('recovers an expired judge lease with fenced durable result persistence', async () => {
    const other = attempt.questions.find((q) => q.id !== question.id)!;
    const original = question;
    question = other;
    const submission = await create('submit-solution', '# contract-correct');
    question = original;
    await configure(other);
    await context.prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: 'RUNNING',
        judgeAttempts: 1,
        judgeLeaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 60000),
      },
    });
    await judge.evaluate(submission.id, 1);
    await judge.evaluate(submission.id, 1);
    const stored = await context.prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(stored.judgeAttempts).toBe(2);
    expect(stored.status).toBe('COMPLETED');
    expect(stored.judgeLeaseToken).toBeNull();
    expect(
      await context.prisma.submissionResult.count({ where: { submissionId: submission.id } }),
    ).toBe(1);
  });
  it('retries infrastructure failures with bounded attempts and sanitized errors', async () => {
    const fresh = attempt.questions.find((q) => q.id !== question.id && q.difficulty === 'EASY')!;
    const original = question;
    question = fresh;
    const submission = await create('run', '# contract-correct');
    question = original;
    broker.transientFailures = 3;
    for (let i = 0; i < 3; i++)
      await expect(judge.evaluate(submission.id, 1)).rejects.toThrow('JUDGE_TRANSIENT_FAILURE');
    await judge.exhaust(submission.id, 1);
    const result = (
      await envelope<Submission>(await context.request(`/submissions/${submission.id}`))
    ).data;
    expect(result.status).toBe('INFRASTRUCTURE_FAILED');
    expect(result.result).toBeNull();
    expect(JSON.stringify(result)).not.toContain('untrusted-secret-diagnostic');
    expect(
      (await context.prisma.submission.findUniqueOrThrow({ where: { id: submission.id } }))
        .judgeAttempts,
    ).toBe(3);
  });
  it('reports compilation errors only for public runs', async () => {
    const fresh = attempt.questions.find((q) => q.difficulty === 'HARD')!;
    const original = question;
    question = fresh;
    const submission = await create('run', '# contract-compile-error');
    question = original;
    await judge.evaluate(submission.id, 1);
    const result = (
      await envelope<Submission>(await context.request(`/submissions/${submission.id}`))
    ).data;
    expect(result.result?.verdict).toBe('COMPILATION_ERROR');
    expect(result.result?.cpuTimeMs).toBeNull();
    expect(result.result?.publicCaseResults[0]?.wallTimeMs).toBeNull();
    expect(result.result?.publicCaseResults[0]?.stderr).toContain('syntax error');
  });
  it('keeps a newer valid submission ahead of an expired worker using lease fencing', async () => {
    const fresh = attempt.questions.find((q) => q.difficulty === 'MEDIUM')!,
      original = question;
    question = fresh;
    const submission = await create('run', '# contract-correct');
    question = original;
    await configure(fresh);
    let release!: () => void;
    broker.compileBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const evaluation = judge.evaluate(submission.id, 1);
    for (let i = 0; i < 100; i++) {
      const row = await context.prisma.submission.findUniqueOrThrow({
        where: { id: submission.id },
      });
      if (row.status === 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await expect(judge.evaluate(submission.id, 1)).rejects.toBeInstanceOf(JudgeBusyError);
    broker.compileBarrier = null;
    release();
    await evaluation;
    expect(
      await context.prisma.submissionResult.count({ where: { submissionId: submission.id } }),
    ).toBe(1);
  });
  it('dispatches transactionally, retries an outbox failure and uses identifier-only job payloads', async () => {
    const active = await startPolicy('BEST_VALID'),
      q = active.questions[0]!;
    const response = await context.request(
      `/attempts/${active.id}/run`,
      'POST',
      { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: '# contract-correct' },
      randomUUID(),
    );
    expect(response.status).toBe(202);
    const row = (await envelope<Submission>(response)).data;
    const add = jest
      .fn()
      .mockRejectedValueOnce(new Error('REDIS_UNAVAILABLE'))
      .mockResolvedValue({});
    const queues = {
      publicRuns: {
        getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
      },
      hidden: { getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }) },
      finalization: { add: jest.fn().mockResolvedValue({}) },
      addJudge: add,
    } as unknown as ExecutionQueues;
    const dispatcher = new OutboxDispatcher(context.prisma, queues);
    await expect(dispatcher.dispatchBatch(100)).rejects.toThrow('REDIS_UNAVAILABLE');
    expect(
      (await context.prisma.submission.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('PENDING');
    expect(
      (await context.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: row.id } }))
        .status,
    ).toBe('PENDING');
    await dispatcher.dispatchBatch(100);
    expect(
      await context.prisma.outboxEvent.count({
        where: { status: 'PENDING', eventType: 'submission.judge' },
      }),
    ).toBe(0);
    expect(
      (await context.prisma.submission.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('QUEUED');
    expect(add).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(add.mock.calls)).not.toMatch(/sourceCode|expectedOutput|Ciphertext/);
    await configure(q);
    await judge.evaluate(row.id, 1);
  });
  it('freezes once under concurrent finalization and rejects all later execution requests', async () => {
    const responses = await Promise.all([
      context.request(
        `/attempts/${attempt.id}/finalize`,
        'POST',
        { expectedStateVersion: attempt.stateVersion },
        randomUUID(),
      ),
      context.request(
        `/attempts/${attempt.id}/finalize`,
        'POST',
        { expectedStateVersion: attempt.stateVersion },
        randomUUID(),
      ),
    ]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    expect(
      await context.prisma.submission.count({ where: { attemptId: attempt.id, purpose: 'FINAL' } }),
    ).toBe(4);
    expect(
      (
        await context.request(
          `/attempts/${attempt.id}/run`,
          'POST',
          { attemptQuestionId: question.id, language: 'PYTHON', sourceCode: 'late' },
          randomUUID(),
        )
      ).status,
    ).toBe(410);
    const snapshots = await context.prisma.submission.findMany({
      where: { attemptId: attempt.id, purpose: 'FINAL' },
    });
    for (const snapshot of snapshots) {
      await judge.evaluate(snapshot.id, 1);
    }
    await Promise.all([
      context.app.get(ResultsService).settle(attempt.id),
      context.app.get(ResultsService).settle(attempt.id),
    ]);
    expect(await context.prisma.assessmentResult.count({ where: { attemptId: attempt.id } })).toBe(
      1,
    );
    expect(
      await context.prisma.auditLog.count({
        where: { entityId: attempt.id, action: 'attempt.graded' },
      }),
    ).toBe(1);
    const result = await context.prisma.assessmentResult.findUniqueOrThrow({
      where: { attemptId: attempt.id },
    });
    expect(result.status).toBe('COMPLETE');
    expect(result.maximumScore.toString()).toBe('70');
    const response = await context.request(`/results/${attempt.id}`);
    expect(response.status).toBe(200);
    expect((await envelope<{ totalScore: string | null }>(response)).data.totalScore).toBeNull();
  });
  it.each(['BEST_VALID', 'LATEST_VALID'] as const)(
    'applies %s, weighted partial credit and preserves a pre-freeze accepted job',
    async (policy) => {
      const active = await startPolicy(policy),
        q = active.questions.find((item) => item.difficulty === 'EASY')!;
      await configure(q);
      const submit = async (source: string) => {
        const r = await context.request(
          `/attempts/${active.id}/submit-solution`,
          'POST',
          { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: source },
          randomUUID(),
        );
        expect(r.status).toBe(202);
        return (await envelope<Submission>(r)).data;
      };
      const best = await submit('# contract-correct');
      await judge.evaluate(best.id, 1);
      const partial = await submit('# contract-partial');
      const rejected = await context.request(
        `/attempts/${active.id}/submit-solution`,
        'POST',
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: 'probe' },
        randomUUID(),
      );
      expect(rejected.status).toBe(429);
      expect(
        (
          await context.request(
            `/attempts/${active.id}/finalize`,
            'POST',
            { expectedStateVersion: active.stateVersion },
            randomUUID(),
          )
        ).status,
      ).toBe(202);
      const results = context.app.get(ResultsService);
      expect(await results.settle(active.id)).toBe(false);
      await judge.evaluate(partial.id, 1);
      expect(
        (
          await context.prisma.submissionResult.findUniqueOrThrow({
            where: { submissionId: partial.id },
          })
        ).score.toString(),
      ).toBe('1');
      const finals = await context.prisma.submission.findMany({
        where: { attemptId: active.id, purpose: 'FINAL' },
      });
      for (const s of finals) await judge.evaluate(s.id, 1);
      const score = await context.prisma.assessmentResult.findUniqueOrThrow({
        where: { attemptId: active.id },
      });
      expect(score.status).toBe('COMPLETE');
      expect(score.totalScore?.toString()).toBe(policy === 'BEST_VALID' ? '10' : '1');
      const items = score.questionScores as {
        attemptQuestionId: string;
        scoringSubmissionId: string;
      }[];
      expect(items.find((item) => item.attemptQuestionId === q.id)?.scoringSubmissionId).toBe(
        policy === 'BEST_VALID' ? best.id : partial.id,
      );
    },
  );
  it('defers a full public queue without blocking hidden evaluations in the outbox', async () => {
    const active = await startPolicy('BEST_VALID'),
      q = active.questions[0]!;
    const accept = async (purpose: string) => {
      const r = await context.request(
        `/attempts/${active.id}/${purpose}`,
        'POST',
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: '# contract-correct' },
        randomUUID(),
      );
      expect(r.status).toBe(202);
      return (await envelope<Submission>(r)).data;
    };
    const publicRun = await accept('run'),
      hidden = await accept('submit-solution');
    const add = jest.fn().mockResolvedValue({});
    const queues = {
      publicRuns: { getJobCounts: jest.fn().mockResolvedValue({ prioritized: 5000 }) },
      hidden: { getJobCounts: jest.fn().mockResolvedValue({ prioritized: 0 }) },
      finalization: { add: jest.fn() },
      addJudge: add,
    } as unknown as ExecutionQueues;
    await new OutboxDispatcher(context.prisma, queues).dispatchBatch(100);
    expect(add).toHaveBeenCalledWith(
      'SUBMIT',
      expect.objectContaining({ submissionId: hidden.id }),
    );
    expect(
      (await context.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: publicRun.id } }))
        .status,
    ).toBe('PENDING');
    expect(
      (await context.prisma.submission.findUniqueOrThrow({ where: { id: hidden.id } })).status,
    ).toBe('QUEUED');
    await configure(q);
    await judge.evaluate(publicRun.id, 1);
    await judge.evaluate(hidden.id, 1);
  });
  it('rejects an insufficient topic-filtered pool at publication without creating attempts', async () => {
    const { assessment } = await policyAssessment('BEST_VALID', ['Arrays'], false);
    const now = await context.prisma.now();
    // The additive administration migration rejects this configuration before admission.
    await expect(
      context.database.query(
        'UPDATE assessments SET status=$1,opens_at=$2,latest_start_at=$3,closes_at=$4,results_release_at=$5 WHERE id=$6',
        [
          'SCHEDULED',
          new Date(now.getTime() - 60000),
          new Date(now.getTime() + 1200000),
          new Date(now.getTime() + 12000000),
          new Date(now.getTime() + 12000000),
          assessment.id,
        ],
      ),
    ).rejects.toThrow('Insufficient question pool');
    const response = await context.request(
      `/assessments/${assessment.id}/start`,
      'POST',
      {},
      randomUUID(),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'ASSESSMENT_NOT_OPEN',
    );
    expect(
      await context.prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id } }),
    ).toBe(0);
  });
  it('closes the grading cutoff with a review result and fences a late worker', async () => {
    const { assessment, assignment } = await policyAssessment('FINAL_SNAPSHOT');
    const now = await context.prisma.now(),
      pool = await context.prisma.assessmentPoolQuestion.findMany({
        where: { assessmentId: assessment.id },
        include: { questionVersion: true },
      });
    const selected = [
      ...pool.filter((p) => p.questionVersion.difficulty === 'EASY').slice(0, 2),
      pool.find((p) => p.questionVersion.difficulty === 'MEDIUM')!,
      pool.find((p) => p.questionVersion.difficulty === 'HARD')!,
    ];
    const frozen = await context.prisma.$transaction(async (tx) => {
      const created = await tx.assessmentAttempt.create({
        data: {
          assessmentId: assessment.id,
          assignmentId: assignment.id,
          studentId: assignment.studentId,
          status: 'FINALIZING',
          finalizationReason: 'EXPIRED',
          startedAt: new Date(now.getTime() - 14400000),
          expiresAt: new Date(now.getTime() - 3600000),
          allocationManifestHash: 'a'.repeat(64),
          gradingDeadlineAt: new Date(now.getTime() - 1),
          ruleSnapshot: { submissionSelection: 'FINAL_SNAPSHOT' },
        },
      });
      await tx.attemptQuestion.createMany({
        data: selected.map((p, index) => ({
          attemptId: created.id,
          position: index + 1,
          questionId: p.questionId,
          questionVersionId: p.questionVersionId,
          assessmentId: assessment.id,
        })),
      });
      return tx.assessmentAttempt.findUniqueOrThrow({
        where: { id: created.id },
        include: { questions: true },
      });
    });
    for (const q of frozen.questions) {
      const source = '# cutoff';
      const s = await context.prisma.submission.create({
        data: {
          attemptId: frozen.id,
          attemptQuestionId: q.id,
          questionVersionId: q.questionVersionId,
          purpose: 'FINAL',
          language: 'PYTHON',
          sourceCode: source,
          sourceHash: createHash('sha256').update(source).digest('hex'),
          requestHash: 'b'.repeat(64),
          idempotencyKey: randomUUID(),
          acceptedAt: now,
        },
      });
      await context.prisma.attemptQuestion.update({
        where: { id: q.id },
        data: { finalSubmissionId: s.id },
      });
    }
    await expireGrading(context.prisma, context.app.get(ResultsService));
    const result = await context.prisma.assessmentResult.findUniqueOrThrow({
      where: { attemptId: frozen.id },
    });
    expect(result.status).toBe('REQUIRES_REVIEW');
    expect(result.totalScore).toBeNull();
    const submissions = await context.prisma.submission.findMany({
      where: { attemptId: frozen.id },
    });
    expect(submissions.every((s) => s.lastJudgeErrorCode === 'GRADING_CUTOFF')).toBe(true);
    for (const s of submissions) await judge.evaluate(s.id, 1);
    expect(
      await context.prisma.submissionResult.count({
        where: { submissionId: { in: submissions.map((s) => s.id) } },
      }),
    ).toBe(0);
    expect(
      (
        await context.request(
          `/attempts/${frozen.id}/run`,
          'POST',
          { attemptQuestionId: frozen.questions[0]!.id, language: 'PYTHON', sourceCode: 'late' },
          randomUUID(),
        )
      ).status,
    ).toBe(410);
  });
  it('serves permitted result and attempt projections under the constrained API database group', async () => {
    await context.database.exec(
      readFileSync(resolve(__dirname, '../prisma/runtime-grants.sql'), 'utf8'),
    );
    await context.prisma.$executeRawUnsafe('SET ROLE assessment_api');
    try {
      const existing = await context.prisma.submission.findFirstOrThrow({
        where: { attemptId: attempt.id, status: 'COMPLETED' },
        select: { id: true },
      });
      expect((await context.request(`/submissions/${existing.id}`)).status).toBe(200);
      expect((await context.request(`/attempts/${attempt.id}`)).status).toBe(200);
      expect((await context.request(`/results/${attempt.id}`)).status).toBe(200);
    } finally {
      await context.prisma.$executeRawUnsafe('RESET ROLE');
    }
  });
});
