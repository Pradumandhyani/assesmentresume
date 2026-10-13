import { envelope, step4Context } from './support/step4-context';
import type { Prisma } from '../src/database/generated/client';

describe('attempt monitoring heartbeat ownership and server-authoritative expiry', () => {
  let context: Awaited<ReturnType<typeof step4Context>>;
  let attemptId: string;
  beforeAll(async () => {
    context = await step4Context();
    attemptId = (await context.start()).id;
  }, 120000);
  afterAll(async () => {
    await context?.close();
  }, 30000);
  it('records only the database clock and coalesces repeated requests without revising exam state', async () => {
    const before = await context.prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(before.lastHeartbeatAt).toBeNull();
    const response = await context.request(`/attempts/${attemptId}/heartbeat`, 'POST', {});
    expect(response.status).toBe(200);
    const result = await envelope<{
      attemptId: string;
      lastHeartbeatAt: string;
      expiresAt: string;
    }>(response);
    expect(result.data.attemptId).toBe(attemptId);
    expect(result.data.lastHeartbeatAt).toBe(result.meta.serverNow);
    const again = await context.request(`/attempts/${attemptId}/heartbeat`, 'POST', {});
    expect((await envelope<{ lastHeartbeatAt: string }>(again)).data.lastHeartbeatAt).toBe(
      result.data.lastHeartbeatAt,
    );
    const after = await context.prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(after.startedAt).toEqual(before.startedAt);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.stateVersion).toEqual(before.stateVersion);
  });
  it('rejects foreign attempts and requests without a CSRF-protected JSON body', async () => {
    await context.signIn('STEP4-OTHER');
    expect((await context.request(`/attempts/${attemptId}/heartbeat`, 'POST', {})).status).toBe(
      404,
    );
    await context.signIn('STEP4-OWNER');
    expect((await context.request(`/attempts/${attemptId}/heartbeat`, 'POST')).status).toBe(403);
  });
  it('finalizes an expired attempt and does not advance its heartbeat', async () => {
    const source = await context.prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { questions: true },
    });
    const now = await context.prisma.now();
    const student = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-EXPIRED' },
    });
    const assignment = await context.prisma.assessmentAssignment.findUniqueOrThrow({
      where: {
        assessmentId_studentId: { assessmentId: source.assessmentId, studentId: student.id },
      },
    });
    // Insert an already elapsed fixture; persisted exam deadlines are immutable.
    const before = await context.prisma.$transaction(async (tx) => {
      const attempt = await tx.assessmentAttempt.create({
        data: {
          assignmentId: assignment.id,
          studentId: student.id,
          assessmentId: source.assessmentId,
          startedAt: new Date(now.getTime() - 1000 - 10800000),
          expiresAt: new Date(now.getTime() - 1000),
          ruleSnapshot: source.ruleSnapshot as Prisma.InputJsonValue,
          allocationManifestHash: 'a'.repeat(64),
          lastHeartbeatAt: new Date(now.getTime() - 300000),
        },
      });
      await tx.attemptQuestion.createMany({
        data: source.questions.map((q) => ({
          attemptId: attempt.id,
          assessmentId: q.assessmentId,
          questionId: q.questionId,
          questionVersionId: q.questionVersionId,
          position: q.position,
        })),
      });
      return attempt;
    });
    await context.signIn('STEP4-EXPIRED');
    expect((await context.request(`/attempts/${before.id}/heartbeat`, 'POST', {})).status).toBe(
      410,
    );
    const after = await context.prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.status).toBe('FINALIZING');
    expect(after.finalizationReason).toBe('EXPIRED');
    expect(after.lastHeartbeatAt).toEqual(before.lastHeartbeatAt);
  });
});
