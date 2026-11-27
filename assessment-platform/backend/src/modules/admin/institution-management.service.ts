import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../database/generated/client';
import { ApiException } from '../../common/http/api-error';
import type { AuthIdentity } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import type { PageInput } from './dto/management-input';
import type { InstitutionInput, NewStudentInput } from './dto/institution-input';
import { ManagementRepository, missing } from './repositories/management.repository';

@Injectable()
export class InstitutionManagementService {
  constructor(
    private readonly repo: ManagementRepository,
    private readonly passwords: PasswordService,
  ) {}

  async list(query: PageInput) {
    await this.repo.now();
    const where: Prisma.InstitutionWhereInput = query.search
      ? {
          OR: [
            { institutionId: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { mainFaculty: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.repo.db.institution.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { students: true } } },
      }),
      this.repo.db.institution.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...institution }) => ({
        ...institution,
        studentCount: _count.students,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string) {
    await this.repo.now();
    const institution = await this.repo.db.institution.findUnique({
      where: { id },
      include: { _count: { select: { students: true } } },
    });
    if (!institution) throw missing();
    const { _count, ...details } = institution;
    return { ...details, studentCount: _count.students };
  }

  create(identity: AuthIdentity, key: string | undefined, input: InstitutionInput) {
    return this.repo.mutate(identity, 'admin:institution:create', key, input, async (tx) => {
      const institution = await tx.institution.create({
        data: { ...input, address: input.address || null },
      });
      await this.repo.audit(tx, identity, 'institution.created', 'Institution', institution.id);
      return { id: institution.id };
    });
  }

  async addStudents(
    identity: AuthIdentity,
    id: string,
    key: string | undefined,
    students: NewStudentInput[],
  ) {
    await this.detail(id);
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      throw new ApiException(400, 'VALIDATION_FAILED', 'A valid Idempotency-Key is required.');
    // Hash outside the write transaction; bound CPU/memory and keep SQL locks short.
    const prepared: { id: string; userId: string; input: NewStudentInput; passwordHash: string }[] =
      [];
    for (let offset = 0; offset < students.length; offset += 4) {
      prepared.push(
        ...(await Promise.all(
          students.slice(offset, offset + 4).map(async (input) => ({
            id: randomUUID(),
            userId: randomUUID(),
            input,
            passwordHash: await this.passwords.hash(input.password),
          })),
        )),
      );
    }
    return this.repo.mutate(
      identity,
      `admin:institution:students:${id}`,
      key,
      { students },
      async (tx) => {
        if (!(await tx.institution.findUnique({ where: { id }, select: { id: true } })))
          throw missing();
        const [users, existing] = await Promise.all([
          tx.user.findMany({
            where: { email: { in: students.map((s) => s.email), mode: 'insensitive' } },
            select: { email: true },
          }),
          tx.student.findMany({
            where: { externalId: { in: students.map((s) => s.externalId) } },
            select: { externalId: true },
          }),
        ]);
        if (users.length || existing.length) {
          const row = students.findIndex(
            (s) =>
              users.some((u) => u.email.toLowerCase() === s.email) ||
              existing.some((e) => e.externalId === s.externalId),
          );
          throw new ApiException(
            409,
            'STUDENT_EXISTS',
            `Student row ${row + 1}: email or student ID already exists. No students were added.`,
          );
        }
        await tx.user.createMany({
          data: prepared.map((s) => ({
            id: s.userId,
            email: s.input.email,
            role: 'STUDENT',
            passwordHash: s.passwordHash,
          })),
        });
        await tx.student.createMany({
          data: prepared.map((s) => ({
            id: s.id,
            userId: s.userId,
            externalId: s.input.externalId,
            displayName: s.input.displayName,
            cohort: s.input.cohort || null,
            institutionId: id,
          })),
        });
        await this.repo.audit(tx, identity, 'institution.students_added', 'Institution', id, {
          count: students.length,
        });
        return { id, createdCount: students.length };
      },
    );
  }
}
