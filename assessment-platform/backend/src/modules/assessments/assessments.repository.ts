import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
@Injectable()
export class AssessmentsRepository {
  constructor(private readonly db: PrismaService) {}
  async assigned(studentId: string) {
    const rows = await this.db.assessmentAssignment.findMany({
      where: { studentId, status: 'ASSIGNED', assessment: { status: { not: 'DRAFT' } } },
      orderBy: { id: 'asc' },
      include: { assessment: { include: { rule: true } }, attempt: { include: { result: true } } },
    });
    return { rows, now: await this.db.now() };
  }
  async own(studentId: string, assessmentId: string) {
    const row = await this.db.assessmentAssignment.findUnique({ where: { assessmentId_studentId: { assessmentId, studentId } }, include: { assessment: { include: { rule: true } }, attempt: { include: { result: true } } } });
    return { row, now: await this.db.now() };
  }
}
