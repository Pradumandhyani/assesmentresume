import { createHash, randomUUID } from 'node:crypto';
import type { PrismaService } from '../../database/prisma.service';
import type { Prisma, Verdict } from '../../database/generated/client';
import type { BrokerClient, BrokerResult } from '../sandbox/protocol';
import { ToolchainCatalog, toolchainDigest } from '../sandbox/toolchain-catalog';
import { TestcaseKeyring, caseAad, verifyCaseHash } from './testcase-crypto';
import { adaptSource } from './source-adapter';
import { executionRules, outputMatches, scoreCases } from '../../modules/execution/grading';
import { ResultsService } from '../../modules/results/results.service';
export class JudgeBusyError extends Error {}
export const terminalVerdict = (result: BrokerResult): Verdict => {
  if (result.termination === 'CPU_LIMIT' || result.termination === 'WALL_LIMIT')
    return 'TIME_LIMIT_EXCEEDED';
  if (result.termination === 'MEMORY_LIMIT') return 'MEMORY_LIMIT_EXCEEDED';
  if (result.termination === 'OUTPUT_LIMIT') return 'OUTPUT_LIMIT_EXCEEDED';
  if (result.termination === 'SANDBOX_ERROR' || result.exitCode === null) return 'INTERNAL_ERROR';
  return result.exitCode === 0 ? 'ACCEPTED' : 'RUNTIME_ERROR';
};
export class JudgeService {
  constructor(
    private readonly db: PrismaService,
    private readonly broker: BrokerClient,
    private readonly catalog: ToolchainCatalog,
    private readonly keys: TestcaseKeyring,
    private readonly results: ResultsService,
  ) {}
  async evaluate(submissionId: string, generation: number) {
    const lease = randomUUID();
    const claimed = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
      const row = await tx.submission.findUnique({
        where: { id: submissionId },
        include: {
          attemptQuestion: {
            include: { attempt: true, questionVersion: { include: { templates: true } } },
          },
        },
      });
      if (
        !row ||
        row.judgeGeneration !== generation ||
        ['COMPLETED', 'INFRASTRUCTURE_FAILED', 'CANCELLED'].includes(row.status)
      )
        return null;
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      if (row.status === 'RUNNING' && row.leaseExpiresAt && row.leaseExpiresAt > now)
        throw new JudgeBusyError('LEASE_BUSY');
      if (row.judgeAttempts >= 3) throw new Error('JUDGE_RETRY_LIMIT');
      if (row.attemptQuestion.attempt.status === 'VOIDED') {
        await tx.submission.update({
          where: { id: row.id },
          data: {
            status: 'CANCELLED',
            completedAt: now,
            judgeLeaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return null;
      }
      await tx.submission.update({
        where: { id: row.id },
        data: {
          status: 'RUNNING',
          judgeLeaseToken: lease,
          leaseExpiresAt: new Date(now.getTime() + 35000),
          judgeAttempts: { increment: 1 },
          stateVersion: { increment: 1 },
        },
      });
      return row;
    });
    if (!claimed) return;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 120000);
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void (async () => {
        const now = await this.db.now();
        const updated = await this.db.submission.updateMany({
          where: {
            id: submissionId,
            status: 'RUNNING',
            judgeLeaseToken: lease,
            judgeGeneration: generation,
          },
          data: { leaseExpiresAt: new Date(now.getTime() + 35000) },
        });
        if (!updated.count) controller.abort();
      })()
        .catch(() => controller.abort())
        .finally(() => {
          heartbeatBusy = false;
        });
    }, 5000);
    let artifactId: string | null = null;
    try {
      const version = claimed.attemptQuestion.questionVersion;
      const template = version.templates.find((t) => t.language === claimed.language);
      if (!template || this.catalog.get(template.toolchainId).language !== claimed.language)
        throw new Error('TOOLCHAIN_UNAVAILABLE');
      if (createHash('sha256').update(claimed.sourceCode).digest('hex') !== claimed.sourceHash)
        throw new Error('SOURCE_INTEGRITY');
      // This query never fetches HIDDEN rows for Run Code.
      const visibility = claimed.purpose === 'RUN_PUBLIC' ? 'PUBLIC' : 'HIDDEN';
      const stored = await this.db.testCase.findMany({
        where: { questionVersionId: version.id, visibility },
        orderBy: { ordinal: 'asc' },
        take: 33,
      });
      if (!stored.length || stored.length > 32) throw new Error('TEST_CONFIGURATION');
      const cases = stored.map((test) => {
        const input = this.keys.decrypt(
          test.inputCiphertext,
          test.encryptionKeyId,
          visibility,
          caseAad(version.id, test.ordinal, visibility, 'input'),
        );
        const expected = this.keys.decrypt(
          test.expectedOutputCiphertext,
          test.encryptionKeyId,
          visibility,
          caseAad(version.id, test.ordinal, visibility, 'expected'),
        );
        if (Buffer.byteLength(expected) > 65536) throw new Error('TEST_CONFIGURATION');
        verifyCaseHash(input, expected, test.integrityHash);
        return { ordinal: test.ordinal, input, expected, weight: test.weight.toString() };
      });
      const compilation = await this.broker.compile(
        {
          executionId: randomUUID(),
          toolchainId: template.toolchainId,
          sourceCode: adaptSource(claimed.sourceCode, template.executionAdapter),
        },
        controller.signal,
      );
      const expectedDigest = toolchainDigest(this.catalog.get(template.toolchainId).image);
      if (compilation.toolchainDigest !== expectedDigest) throw new Error('TOOLCHAIN_MISMATCH');
      artifactId = compilation.artifactId;
      if (compilation.result.termination === 'SANDBOX_ERROR')
        throw new Error('SANDBOX_UNAVAILABLE');
      const compileError =
        !artifactId ||
        compilation.result.exitCode !== 0 ||
        compilation.result.termination !== 'EXITED';
      const evaluated: {
        ordinal: number;
        input: string;
        expectedOutput: string;
        verdict: Verdict;
        stdout: string;
        stderr: string;
        cpuTimeMs: number | null;
        wallTimeMs: number | null;
        memoryKiB: number | null;
        weight: string;
      }[] = [];
      for (const test of cases) {
        let verdict: Verdict, result: BrokerResult;
        if (compileError) {
          result = compilation.result;
          verdict = 'COMPILATION_ERROR';
        } else {
          result = await this.broker.run(
            {
              artifactId: artifactId!,
              stdinBase64: Buffer.from(test.input).toString('base64'),
              limits: {
                cpuTimeMs: version.cpuTimeMs,
                wallTimeMs: version.wallTimeMs,
                memoryKiB: version.memoryLimitKiB,
                outputBytes: version.outputLimitBytes,
                processCount: version.processLimit,
                workspaceBytes: 67108864,
              },
            },
            controller.signal,
          );
          verdict = terminalVerdict(result);
          if (verdict === 'INTERNAL_ERROR') throw new Error('SANDBOX_UNAVAILABLE');
          if (
            verdict === 'ACCEPTED' &&
            !outputMatches(result.stdout, test.expected, version.outputComparison)
          )
            verdict = 'WRONG_ANSWER';
        }
        evaluated.push({
          ordinal: test.ordinal,
          input: test.input,
          expectedOutput: test.expected,
          weight: test.weight,
          verdict,
          stdout: result.stdout,
          stderr: result.stderr,
          // Compilation failure means no testcase process ran; do not duplicate compiler
          // usage across cases or present it as measured testcase execution.
          cpuTimeMs: compileError ? null : result.cpuTimeMs,
          wallTimeMs: compileError ? null : result.wallTimeMs,
          memoryKiB: compileError ? null : result.memoryKiB,
        });
      }
      const passedCount = evaluated.filter((c) => c.verdict === 'ACCEPTED').length;
      const overall = evaluated.find((c) => c.verdict !== 'ACCEPTED')?.verdict ?? 'ACCEPTED';
      const score =
        visibility === 'PUBLIC'
          ? '0.00'
          : scoreCases(
              version.maxScore.toString(),
              evaluated.map((c) => ({ weight: c.weight, passed: c.verdict === 'ACCEPTED' })),
              executionRules(claimed.attemptQuestion.attempt.ruleSnapshot).partialScoring,
            );
      const diagnosticsId = this.keys.id('DIAGNOSTICS');
      const diagnostics =
        visibility === 'HIDDEN'
          ? this.keys.encrypt(
              JSON.stringify(
                evaluated.map((c) => ({
                  ordinal: c.ordinal,
                  verdict: c.verdict,
                  stdout: c.stdout.slice(0, 2048),
                  stderr: c.stderr.slice(0, 1024),
                  cpuTimeMs: c.cpuTimeMs,
                  wallTimeMs: c.wallTimeMs,
                  memoryKiB: c.memoryKiB,
                })),
              ),
              diagnosticsId,
              'DIAGNOSTICS',
              `diagnostics-v1:${submissionId}:g${generation}`,
            )
          : null;
      await this.db.$transaction(async (tx) => {
        // Same lock ordering as acceptance/finalization; no stale lease can overwrite a result.
        await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${claimed.attemptQuestion.attempt.assessmentId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id = ${claimed.attemptId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
        const current = await tx.submission.findUnique({ where: { id: submissionId } });
        if (
          !current ||
          current.status !== 'RUNNING' ||
          current.judgeLeaseToken !== lease ||
          current.judgeGeneration !== generation
        )
          return;
        const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
        const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
          where: { id: claimed.attemptId },
          select: { gradingDeadlineAt: true },
        });
        if (
          claimed.purpose !== 'RUN_PUBLIC' &&
          attempt.gradingDeadlineAt &&
          attempt.gradingDeadlineAt <= now
        ) {
          await tx.submission.update({
            where: { id: submissionId },
            data: {
              status: 'INFRASTRUCTURE_FAILED',
              completedAt: now,
              judgeLeaseToken: null,
              leaseExpiresAt: null,
              lastJudgeErrorCode: 'GRADING_CUTOFF',
              stateVersion: { increment: 1 },
            },
          });
          return;
        }
        await tx.submissionResult.create({
          data: {
            submissionId,
            verdict: overall,
            passedCount,
            totalCount: evaluated.length,
            score,
            cpuTimeMs: evaluated.every((c) => c.cpuTimeMs !== null)
              ? evaluated.reduce((n, c) => n + c.cpuTimeMs!, 0)
              : null,
            memoryKiB: evaluated.some((c) => c.memoryKiB !== null)
              ? Math.max(...evaluated.map((c) => c.memoryKiB ?? 0))
              : null,
            ...(visibility === 'PUBLIC'
              ? {
                  publicCaseResults: evaluated.map((c) => ({
                    ordinal: c.ordinal,
                    input: c.input,
                    expectedOutput: c.expectedOutput,
                    verdict: c.verdict,
                    stdout: c.stdout,
                    stderr: c.stderr,
                    cpuTimeMs: c.cpuTimeMs,
                    wallTimeMs: c.wallTimeMs,
                    memoryKiB: c.memoryKiB,
                  })) as Prisma.InputJsonValue,
                }
              : {}),
            internalDiagnosticsCiphertext: diagnostics,
            diagnosticsKeyId: visibility === 'HIDDEN' ? diagnosticsId : null,
            judgeGeneration: generation,
            toolchainDigest: expectedDigest,
          },
        });
        await tx.submission.update({
          where: { id: submissionId },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            judgeLeaseToken: null,
            leaseExpiresAt: null,
            lastJudgeErrorCode: null,
            stateVersion: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'submission.evaluated',
            entityType: 'Submission',
            entityId: submissionId,
            requestId: randomUUID(),
            metadata: { generation, purpose: claimed.purpose },
          },
        });
      });
      await this.results.settle(claimed.attemptId);
    } catch (error) {
      const busy = error instanceof Error && error.message === 'BROKER_BUSY';
      await this.db.submission.updateMany({
        where: { id: submissionId, status: 'RUNNING', judgeLeaseToken: lease },
        data: {
          status: 'QUEUED',
          judgeLeaseToken: null,
          leaseExpiresAt: null,
          lastJudgeErrorCode: busy ? 'BROKER_BUSY' : 'JUDGE_TRANSIENT_FAILURE',
          ...(busy ? { judgeAttempts: { decrement: 1 } } : {}),
          stateVersion: { increment: 1 },
        },
      });
      if (busy) throw new JudgeBusyError('BROKER_BUSY');
      // eslint-disable-next-line preserve-caught-error -- an attached cause can leak hidden output through BullMQ failedReason/stacktrace
      throw new Error('JUDGE_TRANSIENT_FAILURE'); // raw compiler/test/system logs never enter BullMQ or logging
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      if (artifactId) await this.broker.cleanup(artifactId).catch(() => {}); // broker janitor is independent of worker survival
    }
  }
  async exhaust(submissionId: string, generation: number) {
    const now = await this.db.now();
    const row = await this.db.submission.findUnique({
      where: { id: submissionId },
      select: { attemptId: true },
    });
    if (!row) return;
    await this.db.submission.updateMany({
      where: {
        id: submissionId,
        judgeGeneration: generation,
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      },
      data: {
        status: 'INFRASTRUCTURE_FAILED',
        completedAt: now,
        judgeLeaseToken: null,
        leaseExpiresAt: null,
        lastJudgeErrorCode: 'JUDGE_RETRY_EXHAUSTED',
        stateVersion: { increment: 1 },
      },
    });
    await this.results.settle(row.attemptId);
  }
}
