import { assessmentEligibility, type EligibilityInput } from './assessment-eligibility';
const open = new Date('2026-10-11T10:00:00Z');
const input: EligibilityInput = {
  id: 'assessment',
  status: 'SCHEDULED',
  opensAt: open,
  latestStartAt: new Date('2026-10-11T10:30:00Z'),
  closesAt: new Date('2026-10-11T13:30:00Z'),
  attempt: null,
};
describe('server assessment admission', () => {
  it('opens at the exact scheduled boundary and never earlier', () => {
    expect(assessmentEligibility(input, new Date(open.getTime() - 1)).canStart).toBe(false);
    expect(assessmentEligibility(input, open).canStart).toBe(true);
  });
  it('allows the exact latest-start time, then closes admission', () => {
    expect(assessmentEligibility(input, input.latestStartAt!).canStart).toBe(true);
    expect(assessmentEligibility(input, new Date(input.latestStartAt!.getTime() + 1)).reason).toBe(
      'ADMISSION_CLOSED',
    );
  });
  it.each(['CLOSED', 'ARCHIVED', 'CANCELLED', 'DRAFT'] as const)(
    'does not admit %s assessments',
    (status) => {
      expect(assessmentEligibility({ ...input, status }, open).canStart).toBe(false);
    },
  );
  it('does not start twice and only resumes an unexpired attempt', () => {
    const attempt = { status: 'IN_PROGRESS' as const, expiresAt: new Date('2026-10-11T13:00:00Z') };
    expect(assessmentEligibility({ ...input, attempt }, open)).toMatchObject({
      canStart: false,
      canResume: true,
    });
    expect(assessmentEligibility({ ...input, attempt }, attempt.expiresAt)).toMatchObject({
      canStart: false,
      canResume: false,
      reason: 'EXPIRED',
    });
  });
});
