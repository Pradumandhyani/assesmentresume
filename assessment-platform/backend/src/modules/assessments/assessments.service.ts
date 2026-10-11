import { Injectable } from '@nestjs/common';
import { AssessmentsRepository } from './assessments.repository';
import { assessmentEligibility } from './assessment-eligibility';
import { ApiException } from '../../common/http/api-error';
import type { ListAssessmentsDto } from './dto/list-assessments.dto';
type Assignment = Awaited<ReturnType<AssessmentsRepository['assigned']>>['rows'][number];
@Injectable()
export class AssessmentsService {
  constructor(private readonly repo: AssessmentsRepository) {}
  private summary(row: Assignment) {
    const assessment = row.assessment;
    return { id: assessment.id, title: assessment.title, status: assessment.status, opensAt: assessment.opensAt?.toISOString() ?? null, latestStartAt: assessment.latestStartAt?.toISOString() ?? null, closesAt: assessment.closesAt?.toISOString() ?? null, attemptId: row.attempt?.id ?? null, attemptStatus: row.attempt?.status ?? null };
  }
  private item(row: Assignment, now: Date) {
    const a = row.assessment;
    const rule = a.rule;
    if (!rule) throw new ApiException(503, 'SERVICE_UNAVAILABLE', 'Assessment configuration is unavailable.');
    const eligibility = assessmentEligibility({ ...a, attempt: row.attempt }, now);
    const category = a.status === 'CANCELLED' ? 'CANCELLED' as const : row.attempt?.status === 'FINALIZED' || row.attempt?.status === 'VOIDED' ? 'COMPLETED' as const : eligibility.reason === 'NOT_OPEN' ? 'UPCOMING' as const : ['READY', 'ALREADY_STARTED', 'COMPLETED'].includes(eligibility.reason) ? 'ACTIVE' as const : 'CLOSED' as const;
    const result = row.attempt?.result;
    const released = result?.status === 'COMPLETE' && a.resultsReleaseAt && a.resultsReleaseAt <= now && result.totalScore !== null;
    return { assessment: this.summary(row), description: a.description, rules: { durationSeconds: rule.durationSeconds, easyCount: rule.easyCount, mediumCount: rule.mediumCount, hardCount: rule.hardCount, allowedLanguages: rule.allowedLanguages, maxSourceBytes: rule.maxSourceBytes, gradingPolicyVersion: rule.gradingPolicyVersion, allocationPolicyVersion: rule.allocationPolicyVersion }, category, eligibility, result: released ? { totalScore: result.totalScore!.toString(), maximumScore: result.maximumScore.toString() } : null };
  }
  async list(studentId: string, query: ListAssessmentsDto, mode: 'all' | 'upcoming' | 'legacy' = 'all') {
    const { rows, now } = await this.repo.assigned(studentId);
    const mapped = rows.map((row) => ({ row, item: this.item(row, now) }));
    const summary = { upcoming: 0, active: 0, completed: 0, closed: 0, cancelled: 0 };
    for (const { item } of mapped) summary[item.category.toLowerCase() as keyof typeof summary]++;
    const filtered = mapped.filter(({ row, item }) => (mode !== 'upcoming' || item.category === 'UPCOMING') && (!query.cursor || row.id > query.cursor));
    const selected = filtered.slice(0, query.limit);
    const hasMore = filtered.length > selected.length;
    return { now, data: { items: selected.map(({ row, item }) => mode === 'legacy' ? this.summary(row) : item), ...(mode === 'all' ? { summary } : {}), pageInfo: { hasMore, nextCursor: hasMore ? selected.at(-1)!.row.id : null } } };
  }
  async own(studentId: string, id: string) {
    const { row, now } = await this.repo.own(studentId, id);
    if (!row || row.status !== 'ASSIGNED' || row.assessment.status === 'DRAFT') throw new ApiException(404, 'NOT_FOUND', 'Assessment not found.');
    return { row, item: this.item(row, now), now };
  }
}
