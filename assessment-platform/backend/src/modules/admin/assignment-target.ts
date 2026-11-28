import { randomUUID } from 'node:crypto';
import { ApiException } from '../../common/http/api-error';
import type { Prisma } from '../../database/generated/client';
import type { AssignmentInput } from './dto/management-input';
import { missing } from './repositories/management.repository';

export async function applyAssignments(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  input: AssignmentInput,
) {
  if (
    input.institutionId &&
    !(await tx.institution.findUnique({ where: { id: input.institutionId }, select: { id: true } }))
  )
    throw missing();
  const students = await tx.student.findMany({
    where: {
      ...(input.institutionId ? { institutionId: input.institutionId } : {}),
      ...(input.course ? { course: { equals: input.course, mode: 'insensitive' as const } } : {}),
      ...(input.allStudents
        ? {}
        : { OR: [{ id: { in: input.studentIds } }, { cohort: { in: input.cohorts } }] }),
      ...(input.revoke ? {} : { user: { isActive: true, role: 'STUDENT' as const } }),
    },
    select: { id: true },
    take: 5001,
  });
  if (students.length > 5000)
    throw new ApiException(
      422,
      'VALIDATION_FAILED',
      'Assign at most 5000 students per request. Narrow the institution or course.',
    );
  const studentIds = students.map((s) => s.id);
  if (input.studentIds.some((id) => !studentIds.includes(id)))
    throw new ApiException(
      422,
      'VALIDATION_FAILED',
      'One or more students are missing, disabled, or outside the selected institution and course.',
    );
  if (!studentIds.length)
    throw new ApiException(
      422,
      'VALIDATION_FAILED',
      'No eligible students match the selected institution, course or students.',
    );
  const where = { assessmentId, studentId: { in: studentIds } };
  if (
    !input.revoke &&
    (await tx.assessmentAssignment.findFirst({
      where: { ...where, status: 'REVOKED', attempt: { isNot: null } },
      select: { id: true },
    }))
  )
    throw new ApiException(
      409,
      'VERSION_IMMUTABLE',
      'A revoked started assignment cannot be restored.',
    );
  const status = input.revoke ? 'REVOKED' : 'ASSIGNED';
  await tx.assessmentAssignment.createMany({
    data: studentIds.map((studentId) => ({ id: randomUUID(), assessmentId, studentId, status })),
    skipDuplicates: true,
  });
  await tx.assessmentAssignment.updateMany({ where, data: { status } });
  if (input.revoke) {
    // Use the same assessment -> attempt lock order as cancellation and judge commits.
    await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE assessment_id=${assessmentId}::uuid AND student_id IN (SELECT student_id FROM assessment_assignments WHERE assessment_id=${assessmentId}::uuid AND status='REVOKED') AND status IN ('IN_PROGRESS','FINALIZING') ORDER BY id FOR UPDATE`;
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    await tx.assessmentAttempt.updateMany({
      where: {
        assessmentId,
        studentId: { in: studentIds },
        status: { in: ['IN_PROGRESS', 'FINALIZING'] },
      },
      data: {
        status: 'VOIDED',
        finalizedAt: now,
        finalizationReason: 'ADMIN_VOID',
        stateVersion: { increment: 1 },
      },
    });
  }
  return studentIds.length;
}
