import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { envelope, step4Context } from './support/step4-context';

jest.setTimeout(30000);
describe('institution student entry over HTTP and PostgreSQL', () => {
  let context: Awaited<ReturnType<typeof step4Context>>;
  let base: string,
    csrf = '',
    institutionId: string,
    otherId: string;
  const jar = new Map<string, string>();
  const details = {
    institutionId: 'COLLEGE-001',
    name: 'Example College',
    mainFaculty: 'Dr Faculty',
    email: 'office@example.test',
    phone: '+91 1234567890',
    address: 'College Road',
  };
  const student = (externalId: string) => ({
    externalId,
    displayName: `Student ${externalId}`,
    email: `${externalId.toLowerCase()}@example.test`,
    password: 'Student-password-123!',
    cohort: '2026',
    course: 'B.Tech CSE',
  });
  async function request(path: string, method = 'GET', body?: unknown, key = randomUUID()) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: 'http://localhost:3001',
        Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(body !== undefined
          ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [name, value] = header.split(';')[0]!.split('=');
      if (value) jar.set(name!, value);
      else jar.delete(name!);
    }
    return response;
  }
  beforeAll(async () => {
    context = await step4Context(undefined, undefined, { admin: true });
    base = `${await context.app.getUrl()}/api/v1`;
    const owner = await context.prisma.user.findFirstOrThrow({ where: { role: 'STUDENT' } });
    await context.prisma.user.create({
      data: {
        email: 'institutions-admin@example.test',
        role: 'ADMIN',
        passwordHash: owner.passwordHash,
        admin: { create: { displayName: 'Admissions Admin' } },
      },
    });
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
    expect(
      (
        await request('/auth/login', 'POST', {
          identifier: 'institutions-admin@example.test',
          role: 'ADMIN',
          password: 'Step4-test-password!',
        })
      ).status,
    ).toBe(200);
    csrf = (await envelope<{ csrfToken: string }>(await request('/auth/csrf'))).data.csrfToken;
  }, 120000);
  afterAll(async () => {
    await context?.close();
  }, 30000);

  it('requires authentication and institution details and creates institutions idempotently', async () => {
    expect((await fetch(base + '/admin/institutions')).status).toBe(401);
    expect((await request('/admin/institutions', 'POST', { name: 'Incomplete' })).status).toBe(400);
    const key = randomUUID();
    const first = await envelope<{ id: string }>(
      await request('/admin/institutions', 'POST', details, key),
    );
    institutionId = first.data.id;
    expect(institutionId).toBeDefined();
    expect(
      (await envelope(await request('/admin/institutions', 'POST', details, key))).data,
    ).toEqual(first.data);
    expect((await request('/admin/institutions', 'POST', details)).status).toBe(409);
    otherId = (
      await envelope<{ id: string }>(
        await request('/admin/institutions', 'POST', {
          ...details,
          institutionId: 'COLLEGE-002',
          name: 'Other College',
        }),
      )
    ).data.id;
    const list = await envelope<{ total: number; items: { studentCount: number }[] }>(
      await request('/admin/institutions?search=COLLEGE-001'),
    );
    expect(list.data.total).toBe(1);
    expect(list.data.items[0]?.studentCount).toBe(0);
  });

  it('creates students only inside an existing institution and stores usable hashed credentials', async () => {
    expect((await request('/admin/students', 'POST', student('NO-INSTITUTION'))).status).toBe(404);
    expect(
      (await request(`/admin/institutions/${randomUUID()}/students`, 'POST', student('MISSING')))
        .status,
    ).toBe(404);
    expect(
      (
        await request(`/admin/institutions/${institutionId}/students`, 'POST', {
          ...student('BAD'),
          role: 'ADMIN',
        })
      ).status,
    ).toBe(400);
    const key = randomUUID();
    const response = await request(
      `/admin/institutions/${institutionId}/students`,
      'POST',
      student('NEW-001'),
      key,
    );
    expect(response.status).toBe(200);
    expect((await envelope<{ createdCount: number }>(response)).data.createdCount).toBe(1);
    expect(
      (
        await request(
          `/admin/institutions/${institutionId}/students`,
          'POST',
          student('NEW-001'),
          key,
        )
      ).status,
    ).toBe(200);
    const saved = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'NEW-001' },
      include: { user: true },
    });
    expect(saved.institutionId).toBe(institutionId);
    expect(saved.course).toBe('B.Tech CSE');
    expect(saved.user.role).toBe('STUDENT');
    expect(saved.user.passwordHash).not.toBe(student('NEW-001').password);
    expect(await argon2.verify(saved.user.passwordHash, student('NEW-001').password)).toBe(true);
    const preResponse = await fetch(base + '/auth/csrf');
    const studentCookie = preResponse.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    const pre = await envelope<{ csrfToken: string }>(preResponse);
    // Keep the test administrator's cookie jar independent of the new student's session.
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        Cookie: studentCookie,
        'X-CSRF-Token': pre.data.csrfToken,
      },
      body: JSON.stringify({
        identifier: 'NEW-001',
        password: student('NEW-001').password,
        role: 'STUDENT',
      }),
    });
    expect(login.status).toBe(200);
    const sessionCookie = login.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    expect((await fetch(base + '/student/me', { headers: { Cookie: sessionCookie } })).status).toBe(
      200,
    );
  });

  it('imports atomically, rejects invalid rows and conflicts, and never overwrites existing accounts', async () => {
    const path = `/admin/institutions/${institutionId}/students/import`;
    expect(
      (
        await request(path, 'POST', {
          students: [student('BULK-001'), { ...student('BULK-002'), password: 'short' }],
        })
      ).status,
    ).toBe(400);
    expect(await context.prisma.student.count({ where: { externalId: 'BULK-001' } })).toBe(0);
    expect(
      (await request(path, 'POST', { students: [student('BULK-001'), student('BULK-001')] }))
        .status,
    ).toBe(400);
    expect(
      (await request(path, 'POST', { students: [student('BULK-001'), student('NEW-001')] })).status,
    ).toBe(409);
    expect(await context.prisma.student.count({ where: { externalId: 'BULK-001' } })).toBe(0);
    expect(
      (
        await request(path, 'POST', {
          students: [
            student('BULK-001'),
            { ...student('BULK-002'), email: 'INSTITUTIONS-ADMIN@example.test' },
          ],
        })
      ).status,
    ).toBe(409);
    expect(await context.prisma.student.count({ where: { externalId: 'BULK-001' } })).toBe(0);
    const key = randomUUID(),
      body = { students: [student('BULK-001'), student('BULK-002')] };
    const imported = await request(path, 'POST', body, key);
    expect(imported.status).toBe(200);
    expect((await envelope<{ createdCount: number }>(imported)).data.createdCount).toBe(2);
    expect((await request(path, 'POST', body, key)).status).toBe(200);
    expect((await request(path, 'POST', { students: [student('CHANGED')] }, key)).status).toBe(409);
    const logs = await context.prisma.auditLog.findMany({ where: { entityId: institutionId } });
    expect(JSON.stringify(logs)).not.toContain(student('BULK-001').password);
    const record = await context.prisma.idempotencyRecord.findFirstOrThrow({ where: { key } });
    expect(JSON.stringify(record)).not.toContain(student('BULK-001').password);
  });

  it('filters by institution and preserves existing students, assignments and account controls', async () => {
    const rows = await envelope<{
      total: number;
      items: { id: string; institution: { id: string }; assignments: unknown[] }[];
    }>(await request(`/admin/students?institutionId=${institutionId}&pageSize=2`));
    expect(rows.data.total).toBe(3);
    expect(rows.data.items).toHaveLength(2);
    expect(
      rows.data.items.every(
        (s) => s.institution.id === institutionId && s.assignments.length === 0,
      ),
    ).toBe(true);
    expect(
      (await envelope<{ total: number }>(await request(`/admin/students?institutionId=${otherId}`)))
        .data.total,
    ).toBe(0);
    expect(
      (
        await envelope<{ studentCount: number }>(
          await request(`/admin/institutions/${institutionId}`),
        )
      ).data.studentCount,
    ).toBe(3);
    const legacy = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'STEP4-OWNER' },
    });
    expect(legacy.institutionId).toBeNull();
    expect(
      await context.prisma.assessmentAssignment.count({ where: { studentId: legacy.id } }),
    ).toBeGreaterThan(0);
    expect(
      (await request(`/admin/students/${rows.data.items[0]!.id}`, 'PATCH', { active: false }))
        .status,
    ).toBe(200);
    expect(
      (await request(`/admin/students/${rows.data.items[0]!.id}`, 'PATCH', { active: true }))
        .status,
    ).toBe(200);
  });

  it('targets courses within an institution, assigns atomically and handles retries and invalid audiences', async () => {
    await request(`/admin/institutions/${institutionId}/students`, 'POST', {
      ...student('OTHER-COURSE'),
      course: 'MBA',
    });
    await request(`/admin/institutions/${otherId}/students`, 'POST', student('OTHER-INSTITUTE'));
    const disabled = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'BULK-002' },
    });
    await request(`/admin/students/${disabled.id}`, 'PATCH', { active: false });
    const courses = (
      await envelope<{ items: { name: string; studentCount: number }[] }>(
        await request(`/admin/institutions/${institutionId}/courses`),
      )
    ).data.items;
    expect(courses).toEqual([
      { name: 'B.Tech CSE', studentCount: 3 },
      { name: 'MBA', studentCount: 1 },
    ]);
    const filtered = (
      await envelope<{ total: number }>(
        await request(
          `/admin/students?institutionId=${institutionId}&course=B.Tech%20CSE&active=true&pageSize=1`,
        ),
      )
    ).data;
    expect(filtered.total).toBe(2);
    const now = Date.now();
    const input = {
      title: 'Course assessment',
      description: '',
      opensAt: new Date(now - 60000).toISOString(),
      latestStartAt: new Date(now + 60000).toISOString(),
      closesAt: new Date(now + 3600000).toISOString(),
      resultsReleaseAt: null,
      rule: {
        durationSeconds: 900,
        easyCount: 1,
        mediumCount: 0,
        hardCount: 0,
        allowedLanguages: ['PYTHON'],
        allowedTopics: [],
        marks: { EASY: '10', MEDIUM: '20', HARD: '30' },
        submissionSelection: 'FINAL_SNAPSHOT',
        partialScoring: true,
        hiddenFeedbackImmediate: false,
      },
      questionVersionIds: [],
      poolSelection: 'ALL_PUBLISHED',
      audience: { institutionId, course: 'B.Tech CSE', allStudents: true },
    };
    const key = randomUUID();
    const response = await request('/admin/assessments', 'POST', input, key);
    expect(response.status).toBe(200);
    const created = (await envelope<{ id: string; assignedCount: number }>(response)).data;
    expect(created.assignedCount).toBe(2);
    expect((await envelope(await request('/admin/assessments', 'POST', input, key))).data).toEqual(
      created,
    );
    const assignments = await context.prisma.assessmentAssignment.findMany({
      where: { assessmentId: created.id },
      include: { student: true },
    });
    expect(assignments).toHaveLength(2);
    expect(
      assignments.every(
        (a) => a.student.institutionId === institutionId && a.student.course === 'B.Tech CSE',
      ),
    ).toBe(true);
    expect(
      (
        await context.prisma.assessment.findUniqueOrThrow({ where: { id: created.id } })
      ).resultsReleaseAt?.toISOString(),
    ).toBe(input.closesAt);
    expect(
      (await request(`/admin/assessments/${created.id}/publish`, 'POST', { revision: 1 })).status,
    ).toBe(200);
    const owner = await context.prisma.student.findUniqueOrThrow({
      where: { externalId: 'NEW-001' },
    });
    const assignmentPath = `/admin/assessments/${created.id}/assignments`;
    expect(
      (await request(assignmentPath, 'POST', { studentIds: [owner.id], institutionId: otherId }))
        .status,
    ).toBe(422);
    expect(
      (
        await request(assignmentPath, 'POST', {
          studentIds: [owner.id],
          institutionId,
          course: 'MBA',
        })
      ).status,
    ).toBe(422);
    expect(
      (await request(assignmentPath, 'POST', { studentIds: [disabled.id], institutionId })).status,
    ).toBe(422);
    expect(
      (await request(assignmentPath, 'POST', { course: 'B.Tech CSE', allStudents: true })).status,
    ).toBe(400);
    expect(
      (await request(assignmentPath, 'POST', { studentIds: [owner.id], allStudents: true })).status,
    ).toBe(400);
    expect((await request(assignmentPath, 'POST', {})).status).toBe(400);
    expect(
      (await request(assignmentPath, 'POST', { studentIds: [owner.id, owner.id] })).status,
    ).toBe(400);
    const before = await context.prisma.assessment.count();
    const empty = await request('/admin/assessments', 'POST', {
      ...input,
      audience: { institutionId, course: 'Missing course', allStudents: true },
    });
    expect(empty.status).toBe(422);
    expect(await context.prisma.assessment.count()).toBe(before);
    expect(
      (
        await request('/admin/assessments', 'POST', {
          ...input,
          audience: { institutionId: randomUUID(), allStudents: true },
        })
      ).status,
    ).toBe(404);
    const selected = await request('/admin/assessments', 'POST', {
      ...input,
      audience: { institutionId, studentIds: [owner.id] },
    });
    expect(selected.status).toBe(200);
    expect((await envelope<{ assignedCount: number }>(selected)).data.assignedCount).toBe(1);
    expect(
      (await request(assignmentPath, 'POST', { institutionId, allStudents: true })).status,
    ).toBe(200);
    expect(
      await context.prisma.assessmentAssignment.count({ where: { assessmentId: created.id } }),
    ).toBe(3);
    const global = await request('/admin/assessments', 'POST', {
      ...input,
      audience: { allStudents: true },
    });
    expect(global.status).toBe(200);
    expect((await envelope<{ assignedCount: number }>(global)).data.assignedCount).toBe(
      await context.prisma.student.count({ where: { user: { isActive: true } } }),
    );
    expect(
      (await request(`/admin/assessments/${created.id}/cancel`, 'POST', { revision: 2 })).status,
    ).toBe(200);
    expect((await request(assignmentPath, 'POST', { studentIds: [owner.id] })).status).toBe(409);
  });

  it('requires a course for admissions and explains schedule validation failures', async () => {
    const { course: _course, ...withoutCourse } = student('NO-COURSE');
    expect(_course).toBe('B.Tech CSE');
    const response = await request(
      `/admin/institutions/${institutionId}/students`,
      'POST',
      withoutCourse,
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('course');
    const invalid = await request('/admin/assessments', 'POST', { title: 'Incomplete assessment' });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(await invalid.json())).toContain('opensAt');
  });

  it('denies institution and student creation to student sessions', async () => {
    await context.signIn('STEP4-OWNER');
    expect((await context.request('/admin/institutions')).status).toBe(403);
    expect(
      (await context.request('/admin/institutions', 'POST', details, randomUUID())).status,
    ).toBe(403);
    expect(
      (
        await context.request(
          `/admin/institutions/${institutionId}/students`,
          'POST',
          student('FORBIDDEN'),
          randomUUID(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await context.request(
          `/admin/institutions/${institutionId}/students/import`,
          'POST',
          { students: [student('FORBIDDEN')] },
          randomUUID(),
        )
      ).status,
    ).toBe(403);
  });
});
