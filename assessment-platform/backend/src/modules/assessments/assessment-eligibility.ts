import type { AssessmentStatus, AttemptStatus } from '../../database/generated/enums';
export interface EligibilityInput {
  id: string;
  status: AssessmentStatus;
  opensAt: Date | null;
  latestStartAt: Date | null;
  closesAt: Date | null;
  attempt: { status: AttemptStatus; expiresAt: Date } | null;
}
export function assessmentEligibility(input: EligibilityInput, now: Date) {
  let reason:
    | 'READY'
    | 'NOT_OPEN'
    | 'ADMISSION_CLOSED'
    | 'CANCELLED'
    | 'ALREADY_STARTED'
    | 'COMPLETED'
    | 'EXPIRED';
  if (input.status === 'CANCELLED') reason = 'CANCELLED';
  else if (
    input.attempt?.status === 'FINALIZED' ||
    input.attempt?.status === 'VOIDED' ||
    input.attempt?.status === 'FINALIZING'
  )
    reason = 'COMPLETED';
  else if (input.attempt) reason = input.attempt.expiresAt <= now ? 'EXPIRED' : 'ALREADY_STARTED';
  else if (input.status === 'CLOSED' || input.status === 'ARCHIVED') reason = 'ADMISSION_CLOSED';
  else if (
    !['SCHEDULED', 'OPEN'].includes(input.status) ||
    !input.opensAt ||
    !input.latestStartAt ||
    !input.closesAt ||
    now < input.opensAt
  )
    reason = 'NOT_OPEN';
  else if (now > input.latestStartAt || now >= input.closesAt) reason = 'ADMISSION_CLOSED';
  else reason = 'READY';
  const messages = {
    READY: 'Your assessment is open. You are eligible to start.',
    NOT_OPEN: 'Available at the scheduled start time.',
    ADMISSION_CLOSED: 'The entry window has closed.',
    CANCELLED: 'This assessment has been cancelled.',
    ALREADY_STARTED: 'You have already started this assessment.',
    COMPLETED: 'Your attempt has been submitted.',
    EXPIRED: 'Your assessment time has ended.',
  };
  return {
    assessmentId: input.id,
    canStart: reason === 'READY',
    canResume: reason === 'ALREADY_STARTED',
    reason,
    message: messages[reason],
    checkedAt: now.toISOString(),
  };
}
