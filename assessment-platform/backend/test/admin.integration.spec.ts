import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { envelope, step4Context, type Attempt, type Submission } from './support/step4-context';
import { ContractBroker } from './support/contract-broker';
import { JudgeService } from '../src/workers/judge/judge-service';
import { ResultsService } from '../src/modules/results/results.service';
import { AuthService } from '../src/modules/auth/auth.service';
import type { AuthRequest, AuthIdentity } from '../src/modules/auth/auth.types';
import { AdminReportingService } from '../src/modules/admin/admin-reporting.service';
import { AssessmentManagementService } from '../src/modules/admin/assessment-management.service';
import { judgeFixtures, type JudgeFixture } from '../prisma/judge-fixtures';
import type { QuestionInput, AssessmentInput } from '../src/modules/admin/dto/management-input';

jest.setTimeout(30000);

// Actual HTTP, SQL, encryption, lifecycle and grading services; ContractBroker is
// an explicit transport double. These tests do not validate Linux code execution.
describe('Step 5 administration-to-student HTTP/PostgreSQL workflow with a sandbox transport double', () => {
  let context: Awaited<ReturnType<typeof step4Context>>;
  let base: string,
    csrf = '',
    assessmentId: string,
    assessmentRevision: number,
    attempt: Attempt;
  let adminIdentity: AuthIdentity;
  const jar = new Map<string, string>();
  const authored: {
    id: string;
    versionId: string;
    revision: number;
    input: QuestionInput;
    fixture: JudgeFixture;
  }[] = [];
  const fixtures = [judgeFixtures[1]!, judgeFixtures[2]!, judgeFixtures[4]!, judgeFixtures[6]!];
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const request = async (path: string, method = 'GET', body?: unknown, key?: string) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: 'http://localhost:3001',
        Cookie: cookie(),
        ...(body !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [name, value] = header.split(';')[0]!.split('=');
      if (value) jar.set(name!, value);
      else jar.delete(name!);
    }
    return response;
  };
  const mutate = (path: string, body: unknown, method = 'POST', key = randomUUID()) =>
    request(path, method, body, key);
  const questionInput = (fixture: JudgeFixture): QuestionInput => ({
    slug: `admin-http-${fixture.slug}`,
    title: fixture.title,
    difficulty: fixture.difficulty,
    topics: [fixture.topic],
    tags: ['integration'],
    statement: fixture.statement,
    inputFormat: fixture.inputFormat,
    outputFormat: 'Print the requested integer followed by a newline.',
    constraints: fixture.constraints,
    explanation: 'Apply the algorithm described in the problem statement.',
    publicExamples: fixture.cases
      .slice(0, 2)
      .map((c, index) => ({ ordinal: index + 1, input: c.input, expectedOutput: c.output })),
    maxScore:
      fixture.difficulty === 'EASY' ? '10.00' : fixture.difficulty === 'MEDIUM' ? '20.00' : '30.00',
    cpuTimeMs: 1000,
    wallTimeMs: 2000,
    memoryLimitKiB: 262144,
    outputLimitBytes: 65536,
    processLimit: 32,
    outputComparison: 'TOKENS',
    templates: context.catalog.entries.map((entry) => ({
      language: entry.language,
      starterCode:
        entry.language === 'PYTHON'
          ? '# Read stdin and print your answer.\n'
          : entry.language === 'JAVA'
            ? 'public class Main { public static void main(String[] args) {} }\n'
            : 'int main() { return 0; }\n',
      toolchainId: entry.id,
      executionAdapter: { kind: 'STDIO' as const },
    })),
    testCases: fixture.cases.map((c, index) => ({
      ordinal: index + 1,
      visibility: index < 2 ? 'PUBLIC' : 'HIDDEN',
      input: c.input,
      expectedOutput: c.output,
      weight: '1.00',
    })),
  });
  const assessmentInput = async (future = false): Promise<AssessmentInput> => {
    const now = await context.prisma.now();
    return {
      title: 'Administrator configured DSA Round',
      description: 'Four real published DSA questions.',
      opensAt: new Date(now.getTime() + (future ? 3000 : -60000)).toISOString(),
      latestStartAt: new Date(now.getTime() + 1800000).toISOString(),
      closesAt: new Date(now.getTime() + 14400000).toISOString(),
      resultsReleaseAt: new Date(now.getTime() + 14400000).toISOString(),
      rule: {
        durationSeconds: 10800,
        easyCount: 2,
        mediumCount: 1,
        hardCount: 1,
        allowedLanguages: ['PYTHON', 'JAVA', 'CPP'],
        allowedTopics: fixtures.map((f) => f.topic),
        marks: { EASY: '10.00', MEDIUM: '20.00', HARD: '30.00' },
        submissionSelection: 'BEST_VALID',
        partialScoring: true,
        hiddenFeedbackImmediate: true,
      },
      questionVersionIds: authored.map((q) => q.versionId),
    };
  };
  beforeAll(async () => {
    context = await step4Context(undefined, undefined, { admin: true });
    base = `${await context.app.getUrl()}/api/v1`;
    const student = await context.prisma.user.findFirstOrThrow({ where: { role: 'STUDENT' } });
    await context.prisma.user.create({
      data: {
        email: 'step5-admin@test.invalid',
        role: 'ADMIN',
        passwordHash: student.passwordHash,
        admin: { create: { displayName: 'Integration Administrator' } },
      },
    });
    const pre = await envelope<{ csrfToken: string }>(await request('/auth/csrf'));
    csrf = pre.data.csrfToken;
    const login = await request('/auth/login', 'POST', {
      identifier: 'step5-admin@test.invalid',
      password: 'Step4-test-password!',
      role: 'ADMIN',
    });
    expect(login.status).toBe(200);
    expect(
      (await envelope<{ user: { role: string; displayName: string } }>(login)).data.user,
    ).toMatchObject({ role: 'ADMIN', displayName: 'Integration Administrator' });
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
    const config = context.app.get(ConfigService);
    adminIdentity = (await context.app.get(AuthService).identify({
      cookies: {
        [config.get<string>('SESSION_COOKIE_NAME')!]: jar.get(
          config.get<string>('SESSION_COOKIE_NAME')!,
        ),
      },
    } as AuthRequest))!;
  }, 120000);
  beforeEach(async () => {
    await context.prisma.judgeWorkerHeartbeat.updateMany({
      data: { lastSeenAt: await context.prisma.now() },
    });
  });
  afterAll(async () => {
    await context?.close();
  }, 30000);

  it('reports real database totals, paginated students and honest system settings', async () => {
    const response = await request('/admin/dashboard');
    expect(response.status).toBe(200);
    const dashboard = (
      await envelope<{
        totalStudents: number;
        totalAssessments: number;
        queue: { healthyWorkers: number };
      }>(response)
    ).data;
    expect(dashboard.totalStudents).toBe(5);
    expect(dashboard.totalAssessments).toBe(1);
    expect(dashboard.queue.healthyWorkers).toBe(1);
    const students = (
      await envelope<{ total: number; items: unknown[] }>(
        await request('/admin/students?pageSize=2'),
      )
    ).data;
    expect(students.total).toBe(5);
    expect(students.items).toHaveLength(2);
    const settings = (
      await envelope<{
        questionAuthoringAvailable: boolean;
        toolchains: unknown[];
        session: { sameSite: string };
      }>(await request('/admin/settings'))
    ).data;
    expect(settings.questionAuthoringAvailable).toBe(true);
    expect(settings.toolchains).toHaveLength(3);
    expect(settings.session.sameSite).toBe('lax');
    expect(JSON.stringify(settings)).not.toMatch(/password|keyring|DATABASE|internal\.invalid/);
  });

  it('creates, validates and publishes four encrypted immutable questions with safe idempotent retries', async () => {
    for (const fixture of fixtures) {
      const input = questionInput(fixture),
        key = randomUUID();
      const created = await mutate('/admin/questions', input, 'POST', key);
      expect(created.status).toBe(200);
      const result = (await envelope<{ id: string; versionId: string; revision: number }>(created))
        .data;
      const replay = await mutate('/admin/questions', input, 'POST', key);
      expect((await envelope<{ id: string }>(replay)).data.id).toBe(result.id);
      expect(
        (await mutate('/admin/questions', { ...input, title: 'Changed input' }, 'POST', key))
          .status,
      ).toBe(409);
      const validated = (
        await envelope<{ valid: boolean; executionValidated: boolean }>(
          await request(`/admin/questions/${result.id}/validate`, 'POST', { revision: 1 }),
        )
      ).data;
      expect(validated).toMatchObject({ valid: true, executionValidated: false });
      expect((await mutate(`/admin/questions/${result.id}/publish`, { revision: 1 })).status).toBe(
        200,
      );
      const detail = (
        await envelope<{ status: string; testCases: QuestionInput['testCases'] }>(
          await request(`/admin/questions/${result.id}`),
        )
      ).data;
      expect(detail.status).toBe('PUBLISHED');
      expect(detail.testCases.filter((c) => c.visibility === 'HIDDEN')).toHaveLength(4);
      const stored = await context.prisma.testCase.findFirstOrThrow({
        where: { questionVersionId: result.versionId, visibility: 'HIDDEN' },
      });
      expect(Buffer.from(stored.inputCiphertext).toString()).not.toBe(fixture.cases[2]!.input);
      authored.push({ ...result, input, fixture });
    }
    expect(await context.prisma.question.count()).toBe(12);
    const logs = await request('/admin/audit-logs?search=question');
    expect(logs.status).toBe(200);
    expect(JSON.stringify(await logs.json())).not.toMatch(/expectedOutput|Ciphertext|passwordHash/);
  });

  it('rejects expected outputs that exceed byte or execution limits, including incompatible legacy drafts at publication', async () => {
    const input = questionInput(fixtures[0]!);
    const hidden = input.testCases.findIndex((c) => c.visibility === 'HIDDEN');
    for (const [limit, output] of [
      [65536, 'x'.repeat(65537)],
      [65536, '\u754c'.repeat(21846)],
      [1024, 'x'.repeat(2048)],
    ] as const) {
      const invalid: QuestionInput = {
        ...input,
        slug: `invalid-output-${randomUUID()}`,
        outputLimitBytes: limit,
        testCases: input.testCases.map((c, index) =>
          index === hidden ? { ...c, expectedOutput: output } : c,
        ),
      };
      expect((await mutate('/admin/questions', invalid)).status).toBe(400);
    }
    const compatible: QuestionInput = {
      ...input,
      slug: 'legacy-output-budget-draft',
      testCases: input.testCases.map((c, index) =>
        index === hidden ? { ...c, expectedOutput: 'x'.repeat(2048) } : c,
      ),
    };
    const createdResponse = await mutate('/admin/questions', compatible);
    expect(createdResponse.status).toBe(200);
    const created = (await envelope<{ id: string; versionId: string }>(createdResponse)).data;
    // Simulate a pre-existing draft with incompatible limits. Publication must
    // revalidate persisted encrypted cases rather than trusting input validation.
    await context.prisma.questionVersion.update({
      where: { id: created.versionId },
      data: { outputLimitBytes: 1024 },
    });
    const validated = (
      await envelope<{ valid: boolean; issues: string[] }>(
        await request(`/admin/questions/${created.id}/validate`, 'POST', { revision: 1 }),
      )
    ).data;
    expect(validated.valid).toBe(false);
    expect(validated.issues).toContain('Expected output exceeds its runtime output limit.');
    expect((await mutate(`/admin/questions/${created.id}/publish`, { revision: 1 })).status).toBe(
      422,
    );
  });

  it('configures and assigns a scheduled assessment, waits for server eligibility and starts exactly one durable allocation', async () => {
    const input = await assessmentInput(true);
    expect(
      (await mutate('/admin/assessments', { ...input, latestStartAt: input.closesAt })).status,
    ).toBe(400);
    const response = await mutate('/admin/assessments', input);
    expect(response.status).toBe(200);
    const created = (await envelope<{ id: string; revision: number }>(response)).data;
    assessmentId = created.id;
    const student = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    expect(
      (
        await mutate(`/admin/assessments/${assessmentId}/assignments`, {
          studentIds: [student.id],
          cohorts: [],
          revoke: false,
        })
      ).status,
    ).toBe(200);
    const published = await mutate(`/admin/assessments/${assessmentId}/publish`, {
      revision: created.revision,
    });
    expect(published.status).toBe(200);
    assessmentRevision = (await envelope<{ revision: number }>(published)).data.revision;
    await context.signIn('STEP4-OWNER');
    const upcoming = await context.request('/assessments/upcoming');
    expect(upcoming.status).toBe(200);
    expect(
      (await envelope<{ items: { assessment: { id: string } }[] }>(upcoming)).data.items.some(
        (x) => x.assessment.id === assessmentId,
      ),
    ).toBe(true);
    expect(
      (await context.request(`/assessments/${assessmentId}/start`, 'POST', {}, randomUUID()))
        .status,
    ).toBe(409);
    while ((await context.prisma.now()).getTime() < Date.parse(input.opensAt))
      await new Promise((resolve) => setTimeout(resolve, 100));
    const key = randomUUID();
    const responses = await Promise.all([
      context.request(`/assessments/${assessmentId}/start`, 'POST', {}, key),
      context.request(`/assessments/${assessmentId}/start`, 'POST', {}, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    attempt = (await envelope<Attempt>(responses[0]!)).data;
    expect((await envelope<Attempt>(responses[1]!)).data.id).toBe(attempt.id);
    expect(attempt.questions).toHaveLength(4);
    expect(attempt.questions.filter((q) => q.difficulty === 'EASY')).toHaveLength(2);
    expect(attempt.questions.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(1);
    expect(attempt.questions.filter((q) => q.difficulty === 'HARD')).toHaveLength(1);
    expect(Date.parse(attempt.expiresAt) - Date.parse(attempt.startedAt)).toBe(10800000);
  });

  it('navigates stable questions, preserves separate language drafts and evaluates real persisted public/hidden submissions', async () => {
    await context.signIn('STEP4-OWNER');
    for (const q of [...attempt.questions].reverse()) {
      const detail = await context.request(`/attempts/${attempt.id}/questions/${q.id}`);
      expect(detail.status).toBe(200);
      expect(JSON.stringify(await detail.json())).not.toMatch(
        /HIDDEN|Ciphertext|encryptionKeyId|executionAdapter/,
      );
      for (const language of ['PYTHON', 'JAVA', 'CPP'])
        expect(
          (
            await context.request(`/attempts/${attempt.id}/drafts/${q.id}/${language}`, 'PUT', {
              sourceCode: `${language === 'PYTHON' ? '#' : '//'} contract-correct ${language}`,
              expectedRevision: 0,
            })
          ).status,
        ).toBe(200);
    }
    const first = attempt.questions[0]!;
    expect(
      (
        await context.request(`/attempts/${attempt.id}/drafts/${first.id}/PYTHON`, 'PUT', {
          sourceCode: '# stale draft',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(409);
    let stateVersion = attempt.stateVersion;
    for (const language of ['JAVA', 'CPP', 'PYTHON']) {
      const response = await context.request(
        `/attempts/${attempt.id}/questions/${first.id}/language`,
        'PATCH',
        { language, expectedStateVersion: stateVersion },
      );
      expect(response.status).toBe(200);
      stateVersion = (await envelope<{ stateVersion: number }>(response)).data.stateVersion;
    }
    await context.signIn('STEP4-OWNER');
    const restored = (await envelope<Attempt>(await context.request(`/attempts/${attempt.id}`)))
      .data;
    expect(restored.startedAt).toBe(attempt.startedAt);
    expect(restored.expiresAt).toBe(attempt.expiresAt);
    expect(restored.questions.map((q) => q.questionVersionId)).toEqual(
      attempt.questions.map((q) => q.questionVersionId),
    );
    expect(restored.drafts).toHaveLength(12);
    const q = attempt.questions[0]!,
      fixture = authored.find((a) => a.versionId === q.questionVersionId)!.fixture;
    const broker = new ContractBroker();
    broker.outputs = new Map(fixture.cases.map((c) => [c.input, c.output]));
    const judge = new JudgeService(
      context.prisma,
      broker,
      context.catalog,
      context.keys,
      context.app.get(ResultsService),
    );
    const sourceCode = '# contract-correct',
      payload = { attemptQuestionId: q.id, language: 'PYTHON', sourceCode },
      publicKey = randomUUID();
    const run = await context.request(`/attempts/${attempt.id}/run`, 'POST', payload, publicKey);
    expect(run.status).toBe(202);
    const publicJob = (await envelope<Submission>(run)).data;
    expect(
      (
        await envelope<Submission>(
          await context.request(`/attempts/${attempt.id}/run`, 'POST', payload, publicKey),
        )
      ).data.id,
    ).toBe(publicJob.id);
    await judge.evaluate(publicJob.id, 1);
    const publicResult = (
      await envelope<Submission>(await context.request(`/submissions/${publicJob.id}`))
    ).data;
    expect(publicResult.result?.passedCount).toBe(2);
    expect(publicResult.result?.publicCaseResults).toHaveLength(2);
    const submit = await context.request(
      `/attempts/${attempt.id}/submit-solution`,
      'POST',
      payload,
      randomUUID(),
    );
    expect(submit.status).toBe(202);
    const hiddenJob = (await envelope<Submission>(submit)).data;
    await judge.evaluate(hiddenJob.id, 1);
    const hiddenResult = (
      await envelope<Submission>(await context.request(`/submissions/${hiddenJob.id}`))
    ).data;
    expect(hiddenResult.result?.passedCount).toBe(4);
    expect(hiddenResult.result?.publicCaseResults).toEqual([]);
    expect(JSON.stringify(hiddenResult)).not.toMatch(
      /expectedOutput|private echo|internalDiagnostics|Ciphertext/,
    );
    await context.signIn('STEP4-OTHER');
    expect((await context.request(`/attempts/${attempt.id}`)).status).toBe(404);
    expect((await context.request(`/submissions/${hiddenJob.id}`)).status).toBe(404);
    expect((await context.request(`/admin/questions/${authored[0]!.id}`)).status).toBe(403);
    expect((await context.request('/admin/results')).status).toBe(403);
    await context.signIn('STEP4-OWNER');
  });

  it('finalizes accepted drafts exactly once and exposes calculated scores, analytics and safe CSV to administrators', async () => {
    const key = randomUUID();
    const current = (await envelope<Attempt>(await context.request(`/attempts/${attempt.id}`)))
      .data;
    const payload = { expectedStateVersion: current.stateVersion };
    expect(
      (await context.request(`/attempts/${attempt.id}/finalize`, 'POST', payload, key)).status,
    ).toBe(202);
    expect(
      (await context.request(`/attempts/${attempt.id}/finalize`, 'POST', payload, key)).status,
    ).toBe(202);
    const finalJobs = await context.prisma.submission.findMany({
      where: { attemptId: attempt.id, purpose: 'FINAL' },
    });
    expect(finalJobs).toHaveLength(4);
    const broker = new ContractBroker(),
      results = context.app.get(ResultsService);
    const judge = new JudgeService(context.prisma, broker, context.catalog, context.keys, results);
    for (const job of finalJobs) {
      broker.outputs = new Map(
        authored
          .find((q) => q.versionId === job.questionVersionId)!
          .fixture.cases.map((c) => [c.input, c.output]),
      );
      await judge.evaluate(job.id, job.judgeGeneration);
    }
    await results.settle(attempt.id);
    await results.settle(attempt.id);
    expect(await context.prisma.assessmentResult.count({ where: { attemptId: attempt.id } })).toBe(
      1,
    );
    const studentResult = (
      await envelope<{ feedbackReleased: boolean; totalScore: string | null }>(
        await context.request(`/results/${attempt.id}`),
      )
    ).data;
    expect(studentResult.feedbackReleased).toBe(false);
    expect(studentResult.totalScore).toBeNull();
    const response = await request(`/admin/results?assessmentId=${assessmentId}`);
    expect(response.status).toBe(200);
    const report = (
      await envelope<{
        items: { totalScore: string; maximumScore: string; questions: unknown[] }[];
        analytics: {
          completionRate: number;
          difficulty: unknown[];
          topics: unknown[];
          scoreDistribution: unknown[];
        };
      }>(response)
    ).data;
    expect(report.items[0]).toMatchObject({ totalScore: '70', maximumScore: '70' });
    expect(report.items[0]!.questions).toHaveLength(4);
    expect(report.analytics.completionRate).toBe(1);
    expect(report.analytics.difficulty).toHaveLength(3);
    expect(report.analytics.topics.length).toBeGreaterThan(0);
    expect(report.analytics.scoreDistribution).toHaveLength(1);
    for (const displayName of [
      '=INTEGRATION_FORMULA',
      '\n=INTEGRATION_FORMULA',
      '＝INTEGRATION_FORMULA',
      '   +INTEGRATION_FORMULA',
    ]) {
      await context.prisma.student.update({
        where: { externalId: 'STEP4-OWNER' },
        data: { displayName },
      });
      const csv = await request(`/admin/results/export?assessmentId=${assessmentId}`);
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      const csvText = await csv.text();
      expect(csvText).toContain('"70","70"');
      expect(csvText).toContain("'" + displayName);
    }
    await context.prisma.student.update({
      where: { externalId: 'STEP4-OWNER' },
      data: { displayName: 'STEP4-OWNER' },
    });
    const submissions = await request(`/admin/submissions?assessmentId=${assessmentId}`);
    expect(submissions.status).toBe(200);
    expect(JSON.stringify(await submissions.json())).not.toMatch(
      /sourceCode|expectedOutput|internalDiagnostics|Ciphertext/,
    );
  });

  it('protects published versions and rejects stale draft revisions without changing assigned content', async () => {
    const question = authored[0]!;
    expect(
      (
        await mutate(
          `/admin/questions/${question.id}`,
          { ...question.input, revision: 1, title: 'Forbidden mutation' },
          'PATCH',
        )
      ).status,
    ).toBe(409);
    const draft = await mutate(`/admin/questions/${question.id}/draft`, { revision: 1 });
    expect(draft.status).toBe(200);
    const version = (await envelope<{ versionId: string; revision: number }>(draft)).data;
    expect(version.versionId).not.toBe(question.versionId);
    expect(
      (
        await mutate(
          `/admin/questions/${question.id}`,
          { ...question.input, revision: version.revision, title: 'New draft title' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          `/admin/questions/${question.id}`,
          { ...question.input, revision: version.revision, title: 'Stale draft write' },
          'PATCH',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await context.prisma.questionVersion.findUniqueOrThrow({
          where: { id: question.versionId },
        })
      ).title,
    ).toBe(question.input.title);
    expect(
      (await context.prisma.attemptQuestion.findMany({ where: { attemptId: attempt.id } }))
        .map((q) => q.questionVersionId)
        .sort(),
    ).toEqual(attempt.questions.map((q) => q.questionVersionId).sort());
    expect(
      (
        await mutate(
          `/admin/assessments/${assessmentId}`,
          { ...(await assessmentInput()), revision: assessmentRevision },
          'PATCH',
        )
      ).status,
    ).toBe(409);
  });

  it('assigns cohorts, treats stale heartbeats as connectivity observations and cancels active attempts safely', async () => {
    const owner = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    const other = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OTHER' },
    });
    for (const student of [owner, other])
      expect(
        (await mutate(`/admin/students/${student.id}`, { cohort: 'Integration Cohort' }, 'PATCH'))
          .status,
      ).toBe(200);
    const created = (
      await envelope<{ id: string; revision: number }>(
        await mutate('/admin/assessments', await assessmentInput()),
      )
    ).data;
    const assigned = (
      await envelope<{ assignedCount: number }>(
        await mutate(`/admin/assessments/${created.id}/assignments`, {
          studentIds: [],
          cohorts: ['Integration Cohort'],
          revoke: false,
        }),
      )
    ).data;
    expect(assigned.assignedCount).toBe(2);
    const published = (
      await envelope<{ revision: number }>(
        await mutate(`/admin/assessments/${created.id}/publish`, { revision: created.revision }),
      )
    ).data;
    await context.signIn('STEP4-OTHER');
    const started = (
      await envelope<Attempt>(
        await context.request(`/assessments/${created.id}/start`, 'POST', {}, randomUUID()),
      )
    ).data;
    const monitor = (
      await envelope<{
        items: { attemptId: string; status: string; attemptStatus: string }[];
        message: string;
      }>(await request(`/admin/assessments/${created.id}/monitor`))
    ).data;
    expect(monitor.items.find((x) => x.attemptId === started.id)).toMatchObject({
      status: 'STALE',
      attemptStatus: 'IN_PROGRESS',
    });
    expect(monitor.message).toContain('not evidence of cheating');
    expect(
      (await mutate(`/admin/assessments/${created.id}/cancel`, { revision: published.revision }))
        .status,
    ).toBe(200);
    expect(
      (await context.prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: started.id } }))
        .status,
    ).toBe('VOIDED');
    expect(
      (
        await context.request(
          `/attempts/${started.id}/drafts/${started.questions[0]!.id}/PYTHON`,
          'PUT',
          { sourceCode: 'late', expectedRevision: 0 },
        )
      ).status,
    ).toBe(410);
    expect((await mutate(`/admin/students/${other.id}`, { active: false }, 'PATCH')).status).toBe(
      200,
    );
    expect((await context.request('/auth/me')).status).toBe(401);
  });

  it('enforces bounded custom duration, difficulty and JAVA-only policy throughout drafts and finalization', async () => {
    const now = await context.prisma.now(),
      baseInput = await assessmentInput();
    const input: AssessmentInput = {
      ...baseInput,
      title: 'Bounded Java-only assessment',
      opensAt: new Date(now.getTime() - 60000).toISOString(),
      latestStartAt: new Date(now.getTime() + 600000).toISOString(),
      closesAt: new Date(now.getTime() + 1500000).toISOString(),
      resultsReleaseAt: new Date(now.getTime() + 1500000).toISOString(),
      rule: {
        ...baseInput.rule,
        durationSeconds: 900,
        easyCount: 1,
        mediumCount: 0,
        hardCount: 1,
        allowedLanguages: ['JAVA'],
        allowedTopics: ['Arrays', 'Dynamic programming'],
      },
    };
    const createdResponse = await mutate('/admin/assessments', input);
    expect(createdResponse.status).toBe(200);
    const created = (await envelope<{ id: string; revision: number }>(createdResponse)).data;
    const owner = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    expect(
      (
        await mutate(`/admin/assessments/${created.id}/assignments`, {
          studentIds: [owner.id],
          cohorts: [],
          revoke: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await mutate(`/admin/assessments/${created.id}/publish`, { revision: created.revision }))
        .status,
    ).toBe(200);
    await context.signIn('STEP4-OWNER');
    const response = await context.request(
      `/assessments/${created.id}/start`,
      'POST',
      {},
      randomUUID(),
    );
    expect(response.status).toBe(200);
    const dynamic = (await envelope<Attempt>(response)).data;
    expect(dynamic.questions).toHaveLength(2);
    expect(dynamic.questions.map((q) => q.difficulty).sort()).toEqual(['EASY', 'HARD']);
    expect(dynamic.questions.every((q) => q.selectedLanguage === 'JAVA')).toBe(true);
    expect(Date.parse(dynamic.expiresAt) - Date.parse(dynamic.startedAt)).toBe(900000);
    const first = dynamic.questions[0]!;
    const question = (
      await envelope<{ templates: { language: string }[] }>(
        await context.request(`/attempts/${dynamic.id}/questions/${first.id}`),
      )
    ).data;
    expect(question.templates.map((t) => t.language)).toEqual(['JAVA']);
    expect(
      (
        await context.request(`/attempts/${dynamic.id}/questions/${first.id}/language`, 'PATCH', {
          language: 'PYTHON',
          expectedStateVersion: dynamic.stateVersion,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await context.request(`/attempts/${dynamic.id}/drafts/${first.id}/PYTHON`, 'PUT', {
          sourceCode: 'print(0)',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await context.request(
          `/attempts/${dynamic.id}/run`,
          'POST',
          { attemptQuestionId: first.id, language: 'PYTHON', sourceCode: 'print(0)' },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    for (const q of dynamic.questions)
      expect(
        (
          await context.request(`/attempts/${dynamic.id}/drafts/${q.id}/JAVA`, 'PUT', {
            sourceCode:
              '// Java draft\npublic class Main { public static void main(String[] args) {} }',
            expectedRevision: 0,
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await context.request(
          `/attempts/${dynamic.id}/finalize`,
          'POST',
          { expectedStateVersion: dynamic.stateVersion },
          randomUUID(),
        )
      ).status,
    ).toBe(202);
    const final = await context.prisma.submission.findMany({
      where: { attemptId: dynamic.id, purpose: 'FINAL' },
      select: { language: true },
    });
    expect(final).toHaveLength(2);
    expect(final.every((job) => job.language === 'JAVA')).toBe(true);
  });

  it('revalidates administration actors and rejects account changes targeting legacy administrator student profiles', async () => {
    const reports = context.app.get(AdminReportingService);
    const owner = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    const forgedStudent: AuthIdentity = {
      ...adminIdentity,
      user: { id: owner.userId, role: 'STUDENT', authVersion: 1 },
      student: { id: owner.id, externalId: owner.externalId, displayName: owner.displayName },
      admin: null,
    };
    await expect(
      reports.studentUpdate(forgedStudent, owner.id, randomUUID(), { cohort: 'Forged admin' }),
    ).rejects.toMatchObject({ status: 403 });
    const currentAdmin = await context.prisma.user.findUniqueOrThrow({
      where: { id: adminIdentity.user.id },
    });
    await context.prisma.user.update({
      where: { id: currentAdmin.id },
      data: { authVersion: { increment: 1 } },
    });
    await expect(
      reports.studentUpdate(adminIdentity, owner.id, randomUUID(), { cohort: 'Stale actor' }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await request('/admin/dashboard')).status).toBe(401);
    await context.prisma.user.update({ where: { id: currentAdmin.id }, data: { isActive: false } });
    await expect(
      reports.studentUpdate(adminIdentity, owner.id, randomUUID(), { cohort: 'Disabled actor' }),
    ).rejects.toMatchObject({ status: 403 });
    await context.prisma.user.update({ where: { id: currentAdmin.id }, data: { isActive: true } });
    jar.clear();
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
    expect(
      (
        await request('/auth/login', 'POST', {
          identifier: 'step5-admin@test.invalid',
          password: 'Step4-test-password!',
          role: 'ADMIN',
        })
      ).status,
    ).toBe(200);
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
    const cookieName = context.app.get(ConfigService).get<string>('SESSION_COOKIE_NAME')!;
    adminIdentity = (await context.app
      .get(AuthService)
      .identify({ cookies: { [cookieName]: jar.get(cookieName) } } as AuthRequest))!;
    const legacy = await context.prisma.student.create({
      data: {
        userId: currentAdmin.id,
        externalId: 'LEGACY-ADMIN-PROFILE',
        displayName: 'Legacy profile',
      },
    });
    expect((await mutate(`/admin/students/${legacy.id}`, { active: false }, 'PATCH')).status).toBe(
      403,
    );
    expect(
      (await context.prisma.user.findUniqueOrThrow({ where: { id: currentAdmin.id } })).isActive,
    ).toBe(true);
    await context.prisma.student.delete({ where: { id: legacy.id } });
  });

  it('exercises administration permissions while denying password hashes and private judge diagnostics', async () => {
    await context.database.exec(
      readFileSync(resolve(__dirname, '../prisma/runtime-grants.sql'), 'utf8'),
    );
    await context.database.exec('SET ROLE assessment_admin');
    try {
      const reports = context.app.get(AdminReportingService);
      expect((await reports.students({ page: 1, pageSize: 2 })).items).toHaveLength(2);
      expect((await context.app.get(AssessmentManagementService).detail(assessmentId)).id).toBe(
        assessmentId,
      );
      const student = await context.prisma.student.findUniqueOrThrow({
        where: { externalId: 'STEP4-FAILURE' },
        select: { id: true },
      });
      expect(
        await reports.studentUpdate(adminIdentity, student.id, randomUUID(), { active: false }),
      ).toMatchObject({ updated: true });
      await expect(context.database.query('SELECT password_hash FROM users')).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        context.database.query('SELECT internal_diagnostics_ciphertext FROM submission_results'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await context.database.exec('RESET ROLE');
    }
    await context.database.exec('SET ROLE assessment_api');
    try {
      await expect(
        context.database.query('SELECT input_ciphertext FROM test_cases'),
      ).rejects.toThrow(/permission denied/i);
      expect(
        (await context.database.query('SELECT id,display_name FROM admins')).rows.length,
      ).toBeGreaterThan(0);
    } finally {
      await context.database.exec('RESET ROLE');
    }
  });
});
